// Checks of the Docker stack, run by Test-Stack.ps1 after the browser test (needs the stack up and
// the secret files in deploy/ made by Start.ps1). Prints one PASS or FAIL line per check and exits
// with 1 when any failed. Secret values are read from the env files only to look for them
// elsewhere; they are never printed.
//
//   COMPOSE_PROJECT_NAME  the running project (default cal)
//   CAL_IMAGE             the app image (default cal-app:local)
//   CAL_STACK_PHOTOS      the host folder that holds the photos (for the "photos on disk" check)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deployDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(deployDir, "..");
const project = process.env.COMPOSE_PROJECT_NAME || "cal";
const image = process.env.CAL_IMAGE || "cal-app:local";
const photosDir = process.env.CAL_STACK_PHOTOS || "";
const SERVICES = ["db", "app", "worker", "egress", "tunnel"];

const docker = (args, input) =>
  spawnSync("docker", args, {
    cwd: deployDir,
    encoding: "utf8",
    input,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
const dockerOk = (args, input) => {
  const r = docker(args, input);
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const envValue = (file, name) => {
  const text = fs.readFileSync(path.join(deployDir, file), "utf8");
  const match = new RegExp(`^\\s*${name}\\s*=(.*)$`, "m").exec(text);
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
};
const secrets = {
  "database password": envValue("db.env", "PGPASSWORD"),
  "app secret key": envValue("app.env", "CAL_SECRET_KEY"),
  "VAPID private key": envValue("vapid.env", "VAPID_PRIVATE_KEY"),
  "tunnel token": envValue("cloudflared.env", "TUNNEL_TOKEN"),
};
for (const [name, value] of Object.entries(secrets))
  if (value.length < 20) throw new Error(`The ${name} is missing or too short in the env files.`);

// ---- 1. The real compose file (without the test override) ----------------------------------
const config = JSON.parse(
  dockerOk(["compose", "-f", "docker-compose.yml", "config", "--format", "json"]),
);
const svc = config.services;
check(
  "compose: exactly the five services",
  SERVICES.every((s) => svc[s]) && Object.keys(svc).length === 5,
);
check(
  "compose: no service publishes a port",
  SERVICES.every((s) => !svc[s].ports || svc[s].ports.length === 0),
);
check(
  "compose: no privileged, host network, docker socket or added capability",
  SERVICES.every((s) => {
    const x = svc[s];
    return (
      !x.privileged &&
      !x.network_mode &&
      !x.cap_add?.length &&
      !(x.volumes ?? []).some((v) => String(v.source ?? "").includes("docker.sock"))
    );
  }),
);
for (const s of SERVICES) {
  const x = svc[s];
  check(
    `compose: ${s} drops all capabilities, no-new-privileges, read-only root`,
    x.cap_drop?.includes("ALL") &&
      x.security_opt?.includes("no-new-privileges:true") &&
      x.read_only === true,
  );
  check(
    `compose: ${s} has memory, CPU and process limits, log rotation and a health check`,
    Number(x.mem_limit) > 0 &&
      Number(x.cpus) > 0 &&
      Number(x.pids_limit) > 0 &&
      x.logging?.options?.["max-size"] &&
      x.logging?.options?.["max-file"] &&
      x.healthcheck?.test,
  );
}
check(
  "compose: db, app, worker and tunnel name a non-root user",
  [
    ["db", "70"],
    ["app", "1000"],
    ["worker", "1000"],
    ["tunnel", "65532"],
  ].every(([s, uid]) => String(svc[s].user).split(":")[0] === uid),
);
check(
  "compose: images are pinned to a version (no latest)",
  ["db", "egress", "tunnel"].every(
    (s) => /:\d/.test(svc[s].image) && !svc[s].image.endsWith(":latest"),
  ),
);
check(
  "compose: tunnel and backend networks are internal, only egress-out and tunnel-out lead out",
  config.networks.tunnel.internal === true &&
    config.networks.backend.internal === true &&
    !config.networks["egress-out"].internal &&
    !config.networks["tunnel-out"].internal,
);
const nets = (s) =>
  Object.keys(svc[s].networks ?? {})
    .sort()
    .join(",");
check(
  "compose: networks per service as in the design",
  nets("app") === "backend,tunnel" &&
    nets("worker") === "backend" &&
    nets("db") === "backend" &&
    nets("egress") === "backend,egress-out" &&
    nets("tunnel") === "tunnel,tunnel-out",
  ["app", "worker", "db", "egress", "tunnel"].map((s) => `${s}=${nets(s)}`).join(" "),
);
const envNames = (s) => Object.keys(svc[s].environment ?? {});
check(
  "compose: the tunnel token reaches the tunnel only",
  envNames("tunnel").includes("TUNNEL_TOKEN") &&
    ["db", "app", "worker", "egress"].every((s) => !envNames(s).includes("TUNNEL_TOKEN")),
);
check(
  "compose: the app key and VAPID keys reach the app and the worker only",
  ["app", "worker"].every(
    (s) => envNames(s).includes("CAL_SECRET_KEY") && envNames(s).includes("VAPID_PRIVATE_KEY"),
  ) &&
    ["db", "egress", "tunnel"].every(
      (s) => !envNames(s).includes("CAL_SECRET_KEY") && !envNames(s).includes("VAPID_PRIVATE_KEY"),
    ),
);
check(
  "compose: the database password reaches the db, the app and the worker only",
  ["db", "app", "worker"].every((s) => envNames(s).includes("PGPASSWORD")) &&
    ["egress", "tunnel"].every((s) => !envNames(s).includes("PGPASSWORD")),
);
check(
  "compose: app and worker send every outbound call through the proxy",
  ["app", "worker"].every((s) => svc[s].environment.EGRESS_PROXY_URL === "http://egress:3128"),
);
check(
  "compose: the worker mounts the photos read-only, the app read-write",
  svc.worker.volumes.some((v) => v.target === "/data/photos" && v.read_only === true) &&
    svc.app.volumes.some((v) => v.target === "/data/photos" && !v.read_only),
);

// ---- 2. The running containers --------------------------------------------------------------
const ids = {};
const info = {};
for (const s of SERVICES) {
  ids[s] = dockerOk(["compose", "ps", "-aq", s]).trim();
  if (!ids[s]) throw new Error(`The ${s} container does not exist. Is the stack up?`);
  info[s] = JSON.parse(dockerOk(["inspect", ids[s]]))[0];
}
const networkInfo = {};
for (const n of ["tunnel", "backend", "egress-out", "tunnel-out"])
  networkInfo[n] = JSON.parse(dockerOk(["network", "inspect", `${project}_${n}`]))[0];

const published = (container) =>
  Object.values(container.NetworkSettings.Ports ?? {})
    .flat()
    .filter(Boolean);
check(
  "running: none of the five services publishes a port (requested or actual)",
  SERVICES.every(
    (s) =>
      Object.keys(info[s].HostConfig.PortBindings ?? {}).length === 0 &&
      published(info[s]).length === 0,
  ),
);
const gatewayId = dockerOk(["compose", "ps", "-aq", "gateway"]).trim();
const gateway = JSON.parse(dockerOk(["inspect", gatewayId]))[0];
check(
  "running: the only published port is the test gateway's, on 127.0.0.1:3206",
  published(gateway).length === 1 &&
    published(gateway)[0].HostIp === "127.0.0.1" &&
    published(gateway)[0].HostPort === "3206",
  JSON.stringify(published(gateway)),
);
check(
  "running: every container has a read-only root, no capabilities and no-new-privileges",
  SERVICES.every((s) => {
    const h = info[s].HostConfig;
    return (
      h.ReadonlyRootfs === true &&
      h.CapDrop?.includes("ALL") &&
      !h.CapAdd?.length &&
      !h.Privileged &&
      h.SecurityOpt?.includes("no-new-privileges:true")
    );
  }),
);
check(
  "running: every container has memory, CPU and process limits and log rotation",
  SERVICES.every((s) => {
    const h = info[s].HostConfig;
    return (
      h.Memory > 0 &&
      h.NanoCpus > 0 &&
      h.PidsLimit > 0 &&
      h.LogConfig?.Config?.["max-size"] &&
      h.LogConfig?.Config?.["max-file"]
    );
  }),
);
const imageUser = (s) => JSON.parse(dockerOk(["image", "inspect", info[s].Image]))[0].Config.User;
const users = Object.fromEntries(
  SERVICES.map((s) => [s, info[s].Config.User || imageUser(s) || "root"]),
);
check(
  "running: every container is configured with a non-root user",
  SERVICES.every((s) => !["root", "0", "0:0", "root:root"].includes(users[s])),
  SERVICES.map((s) => `${s}=${users[s]}`).join(" "),
);

// The user and the capabilities of a process that docker exec starts in the container (it gets
// the container's user and capability set). The cloudflared image has no shell tools at all.
const procStatus = (s) => {
  const r = docker(["exec", ids[s], "cat", "/proc/self/status"]);
  if (r.status !== 0) return null;
  const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(r.stdout)?.[1]?.trim() ?? "";
  return { uid: field("Uid").split(/\s+/)[0], capEff: field("CapEff"), capBnd: field("CapBnd") };
};
for (const s of ["db", "app", "worker", "egress"]) {
  const st = procStatus(s);
  check(
    `running: ${s} runs as a non-root user with zero capabilities`,
    st !== null && st.uid !== "0" && /^0+$/.test(st.capEff) && /^0+$/.test(st.capBnd),
    st ? `uid=${st.uid} capEff=${st.capEff} capBnd=${st.capBnd}` : "no /proc",
  );
}
check(
  "running: tunnel (distroless image, no shell) has a non-root user",
  users.tunnel === "65532:65532" || users.tunnel === "65532",
  users.tunnel,
);

const health = Object.fromEntries(
  SERVICES.map((s) => [s, info[s].State.Health?.Status ?? info[s].State.Status]),
);
check(
  "running: db, app, worker and egress are healthy",
  ["db", "app", "worker", "egress"].every((s) => health[s] === "healthy"),
  SERVICES.map((s) => `${s}=${health[s]}`).join(" "),
);
check(
  "running: the tunnel container runs under the same restrictions (dummy token: not connected)",
  info.tunnel.State.Status === "running" || info.tunnel.State.Status === "restarting",
  `status=${info.tunnel.State.Status} health=${health.tunnel}`,
);

// Networks: which ones each container joined, and whether they lead out.
const joined = (s) =>
  Object.keys(info[s].NetworkSettings.Networks).map((n) => n.replace(`${project}_`, ""));
const leadsOut = (s) => joined(s).filter((n) => !networkInfo[n].Internal);
check(
  "running: app, worker and db are only on internal networks (no route out)",
  ["app", "worker", "db"].every((s) => leadsOut(s).length === 0),
  ["app", "worker", "db"].map((s) => `${s}=${joined(s).join("+")}`).join(" "),
);
check(
  "running: only the proxy and the tunnel are on a network that leads out",
  leadsOut("egress").join() === "egress-out" && leadsOut("tunnel").join() === "tunnel-out",
);

// Direct and proxied connections from inside the app and the worker.
const PROBE = `
const net = require("net"), http = require("http"), dns = require("dns");
const out = { direct: {}, proxy: {} };
const direct = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 5000 });
  s.on("connect", () => { s.destroy(); resolve("CONNECTED"); });
  s.on("timeout", () => { s.destroy(); resolve("timeout"); });
  s.on("error", (e) => resolve("error:" + e.code));
});
const lookup = (name) => new Promise((resolve) => dns.lookup(name, (e) => resolve(e ? "error:" + e.code : "RESOLVED")));
const connectVia = (target) => new Promise((resolve) => {
  const req = http.request({ host: "egress", port: 3128, method: "CONNECT", path: target, timeout: 15000 });
  req.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
  req.on("timeout", () => { req.destroy(); resolve("timeout"); });
  req.on("error", (e) => resolve("error:" + e.code));
  req.end();
});
const plainVia = () => new Promise((resolve) => {
  const req = http.request({ host: "egress", port: 3128, method: "GET", path: "http://api.openai.com/", headers: { host: "api.openai.com" }, timeout: 15000 }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on("timeout", () => { req.destroy(); resolve("timeout"); });
  req.on("error", (e) => resolve("error:" + e.code));
  req.end();
});
(async () => {
  out.direct.ip = await direct("1.1.1.1", 443);
  out.direct.dns = await lookup("example.com");
  for (const t of JSON.parse(process.env.PROBE_TARGETS)) out.proxy[t] = await connectVia(t);
  out.proxy["GET http://api.openai.com/"] = await plainVia();
  console.log(JSON.stringify(out));
})();
`;
const ALLOWED = [
  "api.openai.com:443",
  "api.anthropic.com:443",
  "generativelanguage.googleapis.com:443",
  "world.openfoodfacts.org:443",
  "fdc.nal.usda.gov:443",
  "fcm.googleapis.com:443",
  "updates.push.services.mozilla.com:443",
  "web.push.apple.com:443",
  "db5.notify.windows.com:443",
];
const SITE_ALLOWED = ["mealie.caltest.example.org:443", "gym.caltest.example.org:443"];
const DENIED = [
  "example.com:443",
  "api.openai.com:8443",
  "api.openai.com.evil.example:443",
  "1.1.1.1:443",
  "github.com:443",
  "GET http://api.openai.com/",
];
const probe = (s) => {
  const r = docker(
    [
      "exec",
      "-i",
      "-e",
      `PROBE_TARGETS=${JSON.stringify([...ALLOWED, ...SITE_ALLOWED, ...DENIED.filter((d) => !d.startsWith("GET"))])}`,
      ids[s],
      "node",
      "-",
    ],
    PROBE,
  );
  if (r.status !== 0) throw new Error(`probe in ${s} failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
};
for (const s of ["app", "worker"]) {
  const result = probe(s);
  check(
    `${s}: no direct route to the internet (IP and name lookup both fail)`,
    result.direct.ip !== "CONNECTED" && result.direct.dns !== "RESOLVED",
    `ip=${result.direct.ip} dns=${result.direct.dns}`,
  );
  // 403 means the proxy refused; the allowed ones are not 403 (200, or 503 when the made-up site
  // host has no address).
  const allowedOk = ALLOWED.every((t) => result.proxy[t] === 200);
  check(
    `${s}: the proxy allows the AI hosts, Open Food Facts, FoodData Central and the push services`,
    allowedOk,
    ALLOWED.map((t) => `${t.replace(":443", "")}=${result.proxy[t]}`).join(" "),
  );
  check(
    `${s}: the proxy allows the Mealie and openGym hosts from site.env`,
    SITE_ALLOWED.every((t) => result.proxy[t] !== 403 && typeof result.proxy[t] === "number"),
    SITE_ALLOWED.map((t) => `${t}=${result.proxy[t]}`).join(" "),
  );
  check(
    `${s}: the proxy refuses other hosts, other ports, bare IPs and plain http`,
    DENIED.every((t) => result.proxy[t] === 403),
    DENIED.map((t) => `${t}=${result.proxy[t]}`).join(" "),
  );
}
const dbTry = docker([
  "exec",
  ids.db,
  "sh",
  "-c",
  "wget -T 5 -q -O /dev/null http://1.1.1.1/ ; echo exit=$?",
]);
check("db: no route to the internet", /exit=[1-9]/.test(dbTry.stdout), dbTry.stdout.trim());

// Read-only root file system, small writable tmpfs, photo folder rules.
const touch = (s, file) =>
  docker(["exec", ids[s], "sh", "-c", `touch ${file} && echo wrote`]).stdout.includes("wrote");
check(
  "app: cannot write to its program folder, can write to /tmp",
  !touch("app", "/app/x") && touch("app", "/tmp/x"),
);
check(
  "worker: cannot write the photo folder (read-only mount), can write /tmp",
  !touch("worker", "/data/photos/x") && touch("worker", "/tmp/x"),
);
check(
  "app: can write the photo folder as a non-root user",
  touch("app", "/data/photos/.write-test"),
);
docker(["exec", ids.app, "rm", "-f", "/data/photos/.write-test"]);
if (photosDir) {
  let files = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else files++;
  };
  walk(photosDir);
  check(
    "photos: the uploaded photo (three sizes) is on the host folder",
    files >= 3,
    `${files} files`,
  );
}

// ---- 3. Secrets -------------------------------------------------------------------------------
const patterns = Object.values(secrets).join("\n") + "\n";
const scan = docker(
  [
    "run",
    "--rm",
    "-i",
    "--name",
    `${project}-secret-scan`,
    "--network",
    "none",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "grep -rlF -f - /app /etc /home /root /usr/local/bin /usr/local/lib /var /opt 2>/dev/null; echo scan-done",
  ],
  patterns,
);
check(
  "image: none of the four secrets is in the app image's files",
  scan.status === 0 && scan.stdout.trim() === "scan-done",
  scan.stdout.trim().replace("scan-done", "").trim(),
);
const history = dockerOk(["history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
check(
  "image: none of the four secrets is in the image history",
  Object.values(secrets).every((v) => !history.includes(v)),
);
const imageEnv = JSON.parse(dockerOk(["image", "inspect", image]))[0].Config.Env.join("\n");
check(
  "image: no secret-like variable is baked into the image",
  !/SECRET|PASSWORD|TOKEN|PRIVATE/.test(imageEnv),
);
check(
  "image: no source maps, tests or package manager",
  (() => {
    const r = docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "find /app -name '*.map' -o -name '*.test.*' -o -name '*.spec.*' | head -3; ls /usr/local/bin | grep -E '^(npm|npx|corepack|yarn)$'; echo done",
    ]);
    return r.stdout.trim() === "done";
  })(),
);

// What each container's configuration (docker inspect) and logs contain.
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|PRIVATE|KEY/;
const secretVars = (s) =>
  info[s].Config.Env.map((e) => e.split("=")[0])
    .filter((n) => SECRET_NAME.test(n))
    .sort();
const allowedSecretVars = {
  app: [
    "CAL_SECRET_KEY",
    "PGPASSWORD",
    "POSTGRES_PASSWORD",
    "VAPID_PRIVATE_KEY",
    "VAPID_PUBLIC_KEY",
  ],
  worker: [
    "CAL_SECRET_KEY",
    "PGPASSWORD",
    "POSTGRES_PASSWORD",
    "VAPID_PRIVATE_KEY",
    "VAPID_PUBLIC_KEY",
  ],
  db: ["PGPASSWORD", "POSTGRES_PASSWORD"],
  egress: [],
  tunnel: ["TUNNEL_TOKEN"],
};
for (const s of SERVICES) {
  const got = secretVars(s);
  const extra = got.filter((n) => !allowedSecretVars[s].includes(n));
  check(
    `inspect: ${s} has only the secret variables it needs`,
    extra.length === 0,
    `has ${got.join(",") || "none"}`,
  );
}
const inspectText = (s) => JSON.stringify(info[s]);
check(
  "inspect: the tunnel token appears in the tunnel's configuration only",
  SERVICES.filter((s) => inspectText(s).includes(secrets["tunnel token"])).join() === "tunnel",
);
check(
  "inspect: the app secret key and VAPID private key appear in the app and worker only",
  ["db", "egress", "tunnel"].every(
    (s) =>
      !inspectText(s).includes(secrets["app secret key"]) &&
      !inspectText(s).includes(secrets["VAPID private key"]),
  ),
);
check(
  "inspect: the database password appears in the db, app and worker only",
  ["egress", "tunnel"].every((s) => !inspectText(s).includes(secrets["database password"])),
);
const logs = (id) => {
  const r = docker(["logs", id]);
  return `${r.stdout}\n${r.stderr}`;
};
const allLogs = SERVICES.map((s) => logs(ids[s])).join("\n");
check(
  "logs: no secret value and no saved AI key text in any container log",
  Object.values(secrets).every((v) => !allLogs.includes(v)) && !allLogs.includes("SECRETPART"),
);
const tracked = spawnSync("git", ["grep", "-I", "-l", "-F", "-f", "-"], {
  cwd: repoDir,
  encoding: "utf8",
  input: patterns,
});
check(
  "repository: none of the four secrets is in a tracked file",
  tracked.status === 1 && tracked.stdout.trim() === "",
  tracked.stdout.trim(),
);

// ---- 4. The traffic that the browser test caused --------------------------------------------
const egressLog = logs(ids.egress);
check(
  "proxy log: the AI call went through the proxy (CONNECT to the Google host, allowed)",
  /CONNECT generativelanguage\.googleapis\.com:443 200/.test(egressLog),
);
check(
  "proxy log: the refused hosts are in the log as denied (403)",
  /CONNECT example\.com:443 403/.test(egressLog),
);
const mockContainer = dockerOk([
  "compose",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.override.yml",
  "ps",
  "-aq",
  "mock",
]).trim();
const mockLog = mockContainer ? logs(mockContainer) : "";
check(
  "stand-in provider log: it received the analysis and the matching call from the worker",
  (mockLog.match(/mock-ai POST \/v1beta\/models\/[^\s]+:generateContent/g) ?? []).length >= 2,
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
