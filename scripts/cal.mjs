// Kal's server tool (adapted from the Lingo project's server tool). Runs inside the app container,
// wrapped by a PowerShell script on the server:
//
//   node dist/cal.mjs <command> ...          (in the container)
//   node scripts/cal.mjs <command> ...       (development, with DATABASE_URL set)
//
// Codes are made the same way as lib/auth/codes.ts: only their SHA-256 is stored.
import crypto from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

const HELP = `Kal server tool

  invite [--note NAME] [--admin] [--days N]   single-use sign-up code (default: valid 7 days)
  reset USERNAME [--days N]                   single-use code to choose a new password (default 2 days)
  users                                       list accounts
  unlock USERNAME                             clear a lock after too many wrong passwords
  admin USERNAME on|off                       give or take the admin role
  disable USERNAME | enable USERNAME          block or allow an account (ends its sign-ins)
  invites                                     list codes that are still unused
  import-fdc [--only foundation,sr_legacy,fndds] [--zip SET=FILE] [--dir SET=FOLDER] [--prune]
                                              import USDA FoodData Central (downloads into
                                              FDC_CACHE_DIR, checks each file's SHA-256)
  seed-dishes [--file FILE]                   add or update the seeded dishes (run import-fdc first)
  vapid --out FILE [--subject mailto:ADDRESS] write a new Web Push key pair as an env file (mode 600,
                                              never overwritten); prints only the public key`;

/** A Web Push (VAPID) key pair: P-256, both halves base64url (lib/push/webpush.ts reads them). */
export const newVapidKeys = () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  // getPrivateKey() drops leading zero bytes (about one key in 256); the scalar is 32 bytes.
  const scalar = ecdh.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(Math.max(0, 32 - scalar.length)), scalar]);
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: padded.toString("base64url"),
  };
};

// 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown in groups of four.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normalizeCode = (code) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashCode = (code) =>
  crypto.createHash("sha256").update(normalizeCode(code)).digest("hex");
export const newCode = () => {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(
    "",
  );
  return { plain: chars.match(/.{4}/g).join("-"), hash: hashCode(chars) };
};

class ToolError extends Error {}
const fail = (message) => {
  throw new ToolError(message);
};

const parseArgs = (argv) => {
  const flags = new Set();
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--admin") flags.add("admin");
    else if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options[name] = next;
        i++;
      } else flags.add(name);
    } else positional.push(arg);
  }
  return { flags, options, positional };
};

const daysFrom = (options, fallback) => {
  const n = Number(options.days ?? fallback);
  if (!Number.isFinite(n) || n <= 0 || n > 90) fail("--days must be between 1 and 90.");
  return n;
};

const link = (page, code) =>
  `${(process.env.BASE_URL ?? "").replace(/\/$/, "")}/${page}?code=${encodeURIComponent(code)}`;

/** Runs one command. out receives lines of output. Exported for tests. */
export const runCommand = async (pool, argv, out = console.log) => {
  const [command, ...rest] = argv;
  const { flags, options, positional } = parseArgs(rest);
  const q = (text, values) => pool.query(text, values);
  const findUser = async (username) => {
    if (!username) fail("Give the username.");
    const { rows } = await q("select * from users where username = lower($1)", [username]);
    if (!rows.length) fail(`No account with username "${username}". See: cal users`);
    return rows[0];
  };
  const audit = (action, targetType, targetId, details = {}) =>
    q(
      "insert into audit_log (user_id, action, target_type, target_id, details) values (null, $1, $2, $3, $4)",
      [action, targetType, targetId, JSON.stringify({ ...details, via: "server tool" })],
    );

  switch (command) {
    case "invite": {
      const code = newCode();
      const note = String(options.note ?? "").slice(0, 80);
      const role = flags.has("admin") ? "admin" : "member";
      const days = daysFrom(options, 7);
      const { rows } = await q(
        "insert into invites (code_hash, note, role, expires_at) values ($1, $2, $3, now() + make_interval(days => $4)) returning id",
        [code.hash, note, role, days],
      );
      await audit("invite.create", "invite", String(rows[0].id), { role });
      out(
        `Invite code${note ? ` for ${note}` : ""}${role === "admin" ? " (ADMIN)" : ""}: ${code.plain}`,
      );
      out(`Link: ${link("invite", code.plain)}`);
      out(`Works once, for ${days} days. Only its fingerprint is stored, so copy it now.`);
      return { code: code.plain };
    }
    case "reset": {
      const user = await findUser(positional[0]);
      const code = newCode();
      const days = daysFrom(options, 2);
      await q(
        "insert into reset_codes (code_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))",
        [code.hash, user.id, days],
      );
      await audit("reset.create", "user", user.id);
      out(`Reset code for ${user.username}: ${code.plain}`);
      out(`Link: ${link("reset", code.plain)}`);
      out("The old password keeps working until the code is used.");
      return { code: code.plain };
    }
    case "users": {
      const { rows } = await q(
        `select u.username, u.display_name, u.role, u.disabled, u.locked_until, u.created_at,
                (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now())::int as sessions,
                (select count(*) from meals m where m.user_id = u.id and m.deleted_at is null)::int as meals
           from users u order by u.created_at`,
      );
      if (!rows.length)
        out("No accounts yet. Make the first one with: cal invite --note NAME --admin");
      for (const r of rows) {
        const marks = [
          r.role === "admin" && "admin",
          r.disabled && "DISABLED",
          r.locked_until > new Date() && "LOCKED",
        ].filter(Boolean);
        out(
          `${r.username.padEnd(20)} ${r.display_name.padEnd(20)} ${String(r.meals).padStart(6)} meals  ${r.sessions} sign-in(s)  joined ${r.created_at.toISOString().slice(0, 10)}  ${marks.join(" ")}`.trimEnd(),
        );
      }
      return { users: rows.length };
    }
    case "unlock": {
      const user = await findUser(positional[0]);
      await q("update users set failed_logins = 0, locked_until = null where id = $1", [user.id]);
      out(`${user.username} unlocked.`);
      return {};
    }
    case "admin": {
      const user = await findUser(positional[0]);
      const on = positional[1];
      if (on !== "on" && on !== "off") fail('Say "on" or "off" after the username.');
      await q("update users set role = $2 where id = $1", [
        user.id,
        on === "on" ? "admin" : "member",
      ]);
      await audit("user.role", "user", user.id, { role: on === "on" ? "admin" : "member" });
      out(`${user.username} admin: ${on}.`);
      return {};
    }
    case "disable":
    case "enable": {
      const user = await findUser(positional[0]);
      await q("update users set disabled = $2 where id = $1", [user.id, command === "disable"]);
      if (command === "disable") await q("delete from sessions where user_id = $1", [user.id]);
      await audit(`user.${command}`, "user", user.id);
      out(`${user.username} ${command}d.`);
      return {};
    }
    case "invites": {
      const { rows } = await q(
        "select note, role, created_at, expires_at from invites where used_at is null and expires_at > now() order by created_at",
      );
      if (!rows.length) out("No unused codes.");
      for (const r of rows)
        out(
          `${(r.note || "(no note)").padEnd(32)} ${r.role.padEnd(6)}  made ${r.created_at.toISOString().slice(0, 10)}  expires ${r.expires_at.toISOString().slice(0, 10)}`,
        );
      return { invites: rows.length };
    }
    case "vapid": {
      const file = options.out;
      if (!file) fail("Give the env file to write: vapid --out FILE.");
      if (existsSync(file)) fail(`${file} exists already; Kal never overwrites keys.`);
      const subject = options.subject ?? "mailto:admin@example.org";
      if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject))
        fail("The subject is a mailto: address or an https URL.");
      const keys = newVapidKeys();
      writeFileSync(
        file,
        `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${subject}\n`,
        { mode: 0o600, flag: "wx" },
      );
      out(`Wrote ${file}. Public key: ${keys.publicKey}`);
      return { publicKey: keys.publicKey };
    }
    case "import-fdc":
    case "seed-dishes": {
      // scripts/fdc-import.mjs and scripts/seed-dishes.mjs (dist/*.mjs in the image) each export
      // run(pool, argv, out).
      const file = command === "import-fdc" ? "fdc-import.mjs" : "seed-dishes.mjs";
      const here = path.dirname(fileURLToPath(import.meta.url));
      const full = path.join(here, file);
      if (!existsSync(full)) fail(`${command} is not part of this build yet.`);
      const mod = await import(pathToFileURL(full).href);
      return mod.run(pool, rest, out);
    }
    default:
      out(HELP);
      if (command && command !== "help") fail(`Unknown command "${command}".`);
      return {};
  }
};

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || undefined, max: 1 });
  try {
    await runCommand(pool, process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
