import type { Request, RequestHandler } from "express";
import { redis } from "./db.js";
import { HttpError } from "./util.js";
import { cfg } from "./config.js";

/**
 * Fixed-window counter in Redis. Returns the remaining allowance, or throws 429.
 * If Redis is unreachable it fails open, because a Redis blip should not lock everyone out.
 */
export async function hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  try {
    const k = `rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    if (n <= max) return { allowed: true, remaining: max - n, retryAfter: 0 };
    const ttl = await redis.ttl(k);
    return { allowed: false, remaining: 0, retryAfter: ttl > 0 ? ttl : windowSec };
  } catch {
    return { allowed: true, remaining: max, retryAfter: 0 };
  }
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";

/** Middleware: at most `max` requests per `windowSec`, keyed by IP (or by user when signed in and perUser is set). */
export function rateLimit(name: string, max: number, windowSec: number, perUser = false): RequestHandler {
  return async (req, res, next) => {
    if (cfg.demoMode && process.env.DISABLE_RATE_LIMITS === "1") return next(); // used only by automated tests
    const who = perUser && req.user ? `u:${req.user.id}` : `ip:${clientIp(req)}`;
    const r = await hit(`${name}:${who}`, max, windowSec);
    res.setHeader("RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      res.setHeader("Retry-After", String(r.retryAfter));
      throw new HttpError(429, `Too many requests. Try again in ${r.retryAfter} seconds.`, "rate_limited");
    }
    next();
  };
}

/** For handlers that need a limit keyed on something other than IP, such as a login email. */
export async function enforce(key: string, max: number, windowSec: number, message = "Too many attempts. Please wait and try again.") {
  if (cfg.demoMode && process.env.DISABLE_RATE_LIMITS === "1") return;
  const r = await hit(key, max, windowSec);
  if (!r.allowed) throw new HttpError(429, `${message} (${r.retryAfter}s)`, "rate_limited");
}
