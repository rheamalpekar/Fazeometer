import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { cfg } from "./config.js";
import { q } from "./db.js";
import { HttpError } from "./util.js";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  country: string;
  birthdate: string;
  role: string;
  streamer_id: string | null;
  game_pref: string | null;
  credits: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signToken = (uid: string) => jwt.sign({ uid }, cfg.jwtSecret, { expiresIn: "7d" });

export const verifyToken = (token: string): string | null => {
  try {
    return (jwt.verify(token, cfg.jwtSecret) as { uid: string }).uid;
  } catch {
    return null;
  }
};

export async function loadUser(id: string): Promise<AuthUser | null> {
  const { rows } = await q<AuthUser>(
    `SELECT id, email, display_name, country, to_char(birthdate,'YYYY-MM-DD') AS birthdate, role, streamer_id, game_pref, credits
     FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export const attachUser: RequestHandler = async (req, _res, next) => {
  const uid = req.cookies?.token ? verifyToken(req.cookies.token) : null;
  if (uid) req.user = (await loadUser(uid)) ?? undefined;
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "Sign in first", "unauthenticated");
  next();
};

export const requireStreamer: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "Sign in first", "unauthenticated");
  if (req.user.role !== "streamer" || !req.user.streamer_id) throw new HttpError(403, "Streamer account required", "not_streamer");
  next();
};

export async function hasEntitlement(userId: string, kind: string) {
  const { rows } = await q(
    `SELECT 1 FROM entitlements WHERE user_id=$1 AND kind=$2 AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now()) LIMIT 1`,
    [userId, kind],
  );
  return rows.length > 0;
}
