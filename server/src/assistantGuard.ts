/**
 * Guard rails for the Ask Odyssey assistant. Everything here is plain code, not an LLM,
 * so the outcomes that matter (refusals, access limits, citation checks) cannot be talked around.
 */

export type Outcome = "answered" | "clarify" | "off_topic" | "mixed" | "missing" | "unauthorized" | "injection" | "fallback" | "error";

/** The only facts the assistant may state about how the product works. Each has an id the model must cite. */
export const RULES: Record<string, { label: string; text: string }> = {
  R1: { label: "How video relics work", text: "Finish at least 85% of a video, watching in order (skipping ahead earns nothing), to complete it and earn a relic. Only one video can be watched at a time per account. Videos give at most 3 relics a day." },
  R2: { label: "How live stream relics work", text: "Watch at least 80% of a live stream including the final stretch, then enter the secret word the streamer shows near the end." },
  R3: { label: "Builds", text: "The free build is the Trireme of Ithaca (30 relics). The second build, Agamemnon, needs Premium." },
  R4: { label: "Premium", text: "Premium is $5 per month: no ads and the Agamemnon build. 24 paid months earns a free regional tournament ticket. Cancel any time; access lasts until the end of the paid month." },
  R5: { label: "Live call", text: "Finishing a ship unlocks a live video call with a partner streamer (fans 18 and older)." },
  R6: { label: "Event reminders", text: "Set a reminder with the Remind me button on an event on Home." },
};
export const CONTEXT_SOURCES: Record<string, string> = { LIVE: "Live now", UPCOMING: "Upcoming streams", EVENTS: "Events", VOYAGE: "Your voyage", VIDEOS: "Catalog" };

export const MESSAGES = {
  unauthorized: "I can only help with your own account and public FaZe Odyssey content. I can't share other people's information.",
  injection: "I can't change my rules or share how I work. I'm happy to help with videos, relics, live streams, events or Premium.",
  off_topic: "I can help with FaZe Odyssey: finding videos, relics, live streams, events and Premium.",
  missing: "I couldn't verify that in the information I have. Try the relevant page (Home, Profile, Premium or Live call).",
  mixedSuffix: " I can only help with FaZe Odyssey, so I skipped the other request.",
  busy: "The assistant is resting for a moment.",
} as const;

/** Trim, drop control and zero-width characters, collapse whitespace. */
export function cleanMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INJECTION = [
  /ignore (all |any |your |the )?(previous |prior |above )?(instructions|rules|prompt)/i,
  /disregard (all |any |your |the )?(previous |prior |above )?(instructions|rules|prompt)/i,
  /(reveal|show|print|repeat|tell me|leak) (me )?(your |the )?(system |hidden |initial )?(prompt|instructions|rules)/i,
  /\b(system prompt|developer message|jailbreak|dan mode)\b/i,
  /you are now\b|act as (an? )?(unrestricted|different)|pretend (you have|there are) no (rules|restrictions)/i,
  /(override|bypass|disable) (your |the )?(safety|rules|guard|restrictions|filters)/i,
];

export function injectionMatch(text: string): string | null {
  for (const re of INJECTION) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** True when removing the injection phrase leaves nothing worth answering. */
export function injectionOnly(text: string): boolean {
  const m = injectionMatch(text);
  if (!m) return false;
  const rest = text.replace(m, " ").replace(/[^a-z0-9]+/gi, " ").trim();
  // Words that belong to the attack itself do not count as a real question.
  const attack = new Set(["and", "then", "also", "please", "reveal", "show", "tell", "private", "secret", "hidden", "data", "all", "everything", "now", "just", "say", "print", "your", "the", "you", "are", "will", "can", "give", "info", "information"]);
  return rest.toLowerCase().split(" ").filter((w) => w.length > 2 && !attack.has(w)).length < 3;
}

// Requests for other people's private data or for the app's internals. The assistant has no access to either.
const UNAUTHORIZED = [
  /\b(another|other|someone'?s?|somebody'?s?|his|her|their|everyone'?s?|all)\b[^.?!]{0,30}\b(users?|fans?|accounts?|profiles?|emails?|passwords?|records?|data|payments?|cards?|addresses|phone)\b/i,
  /\b(list|dump|export|show) (me )?(all |every )?(the )?(users|accounts|emails|passwords|customers|members)\b/i,
  /\b(api[ -]?keys?|secret keys?|access tokens?|jwt|database (url|password|credentials)|\.env)\b/i,
  /\badmin(istrator)? (access|panel|rights|mode)\b/i,
];

export function wantsOthersData(text: string): boolean {
  return UNAUTHORIZED.some((re) => re.test(text));
}

/** Keeps only citations the model was actually given. */
export function verifyBasis(basis: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(basis)) return [];
  return [...new Set(basis.filter((b): b is string => typeof b === "string" && allowed.has(b)))];
}

export const sourceLabel = (id: string) => RULES[id]?.label ?? CONTEXT_SOURCES[id] ?? id;

/** Removes things an answer must never carry: links, markup, and anything that looks like prompt or key leakage. Returns null if it should be discarded. */
export function scrubAnswer(answer: unknown): string | null {
  if (typeof answer !== "string") return null;
  if (/\b(RULES|CONTEXT|USER_MESSAGE|HISTORY|candidateVideos|systemInstruction)\b/.test(answer)) return null;
  if (/AIza[0-9A-Za-z_-]{10,}|\bAQ\.[0-9A-Za-z_-]{10,}|sk_(live|test)_|whsec_/.test(answer)) return null;
  const out = answer.replace(/https?:\/\/\S+/gi, "").replace(/<[^>]*>/g, "").replace(/[`*_#>]+/g, "").replace(/\s+/g, " ").trim();
  return out.length ? out.slice(0, 600) : null;
}
