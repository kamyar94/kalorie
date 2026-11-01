// Invite and reset codes: 16 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
// shown in groups of four. Only the SHA-256 of the normalised code is stored.
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Case, spaces and dashes do not matter when a code is typed. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const hashCode = (code: string) =>
  crypto.createHash("sha256").update(normalizeCode(code)).digest("hex");

export const newCode = () => {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(
    "",
  );
  return { plain: chars.match(/.{4}/g)!.join("-"), hash: hashCode(chars) };
};

export const CODE_DAYS_DEFAULT = 7;
export const CODE_DAYS_MAX = 90;
