import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEYLEN = 64;

/** Format: scrypt$<salt hex>$<hash hex>. Slow on purpose, so stolen hashes are expensive to crack. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // Always do the same work, so a missing account is not distinguishable by response time.
  const parts = (stored ?? "").split("$");
  const ok = parts.length === 3 && parts[0] === "scrypt";
  const salt = Buffer.from(ok ? parts[1] : "00".repeat(16), "hex");
  const expected = Buffer.from(ok ? parts[2] : "00".repeat(KEYLEN), "hex");
  const actual = await scrypt(password, salt, KEYLEN);
  return ok && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** At least 10 characters, and not one of the passwords everyone tries first. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters";
  if (pw.length > 128) return "Use at most 128 characters";
  if (/^(password|12345|qwerty|letmein|faze|odyssey)/i.test(pw)) return "That password is too easy to guess";
  if (new Set(pw).size < 4) return "Use a mix of different characters";
  return null;
}
