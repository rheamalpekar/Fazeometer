import crypto from "node:crypto";
import { cfg } from "./config.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export const hashCode = (code: string) =>
  crypto.createHmac("sha256", cfg.codeSecret).update(normalizeCode(code)).digest("hex");

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const WORDS = [
  "TROY","LOTUS","SIREN","CYCLOPS","CIRCE","ITHACA","AEGEAN","TRIDENT","ORACLE","HELIOS","ATHENA","HERMES",
  "CHARYBDIS","SCYLLA","NOSTOS","PENELOPE","ARGOS","EUMAEUS","AEOLUS","CALYPSO","MENTOR","TELEMACHUS","ELYSIUM","STYX",
  "ZEPHYR","AMBER","BRONZE","LAUREL","OLIVE","MARBLE","SPARTAN","HOPLITE","PHALANX","TITAN","NEREID","KRAKEN",
  "MEDUSA","PEGASUS","ATLAS","ARES","APOLLO","ARTEMIS","HADES","POSEIDON","ZEUS","HERA","DEMETER","HESTIA",
  "ODYSSEY","VOYAGE","HARBOR","ANCHOR","COMPASS","SAIL","OAR","STORM","TIDE","REEF","SHORE","BEACON",
  "EMBER","FALCON","GLADIUS","QUIVER",
];

export function makeCode() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${String(crypto.randomInt(10000)).padStart(4, "0")}`;
}

export const ageOf = (birthdate: string | Date) => {
  const b = new Date(birthdate);
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
};

/** Runs fire-and-forget work and logs a failure instead of swallowing it. */
export function safe(label: string, work: Promise<unknown>): void {
  work.catch((err) => console.warn(`[${label}] ${(err as Error).message}`));
}
