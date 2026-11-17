import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { q, mdb } from "../db.js";
import { cfg } from "../config.js";
import { requireAuth } from "../auth.js";
import { HttpError, ageOf } from "../util.js";

export const router = Router();

async function callStatus(userId: string, birthdate: string) {
  const done = (await q(`SELECT count(*)::int AS n FROM user_characters WHERE user_id=$1 AND status='complete'`, [userId])).rows[0].n as number;
  const booked = (
    await q(
      `SELECT cs.*, st.display_name AS streamer FROM call_slots cs JOIN streamers st ON st.id=cs.streamer_id
       WHERE cs.booked_by=$1 AND cs.status='booked' ORDER BY cs.starts_at LIMIT 1`,
      [userId],
    )
  ).rows[0];
  const survey = await mdb.collection("surveys").findOne({ userId }, { sort: { at: -1 } });
  const adult = ageOf(birthdate) >= 18;
  const completedCalls = (await q(`SELECT count(*)::int AS n FROM call_slots WHERE booked_by=$1 AND status='completed'`, [userId])).rows[0].n as number;
  let reason: string | null = null;
  if (!adult) reason = "Live calls are for fans 18 and older.";
  else if (done === 0) reason = "Complete your ship (all 30 relics) to unlock your call.";
  else if (done <= completedCalls) reason = "You used the call for your completed character. Complete another to earn the next one.";
  return { eligible: reason === null, reason, booked: booked ?? null, survey: survey ? { nation: survey.nation, game: survey.game } : null };
}

router.get("/call/status", requireAuth, async (req, res) => {
  res.json(await callStatus(req.user!.id, req.user!.birthdate));
});

router.post("/survey", requireAuth, async (req, res) => {
  const b = z.object({ nation: z.string().length(2).transform((s) => s.toUpperCase()), game: z.enum(["cod", "fortnite"]) }).parse(req.body);
  await mdb.collection("surveys").insertOne({ userId: req.user!.id, ...b, at: new Date() });
  res.json({ ok: true });
});

// Partner streamers for the fan's surveyed nation first, then the rest.
router.get("/call/streamers", requireAuth, async (req, res) => {
  const survey = await mdb.collection("surveys").findOne({ userId: req.user!.id }, { sort: { at: -1 } });
  const nation = (survey?.nation as string) ?? req.user!.country;
  const { rows } = await q(
    `SELECT st.id, st.display_name, st.country, st.followers, st.game, st.color,
            (SELECT count(*)::int FROM call_slots cs WHERE cs.streamer_id=st.id AND cs.status='open' AND cs.starts_at > now()) AS open_slots
     FROM streamers st WHERE st.is_partner = true
     ORDER BY (st.country = $1) DESC, st.followers DESC`,
    [nation],
  );
  const ids = rows.map((r) => r.id);
  const profiles = await mdb.collection("streamer_profiles").find({ streamerId: { $in: ids } }).toArray();
  const pm = new Map(profiles.map((p) => [p.streamerId as string, p]));
  res.json({ nation, streamers: rows.map((r) => ({ ...r, bio: pm.get(r.id)?.bio ?? "", tags: pm.get(r.id)?.tags ?? [] })) });
});

router.get("/call/slots", requireAuth, async (req, res) => {
  const { streamerId } = z.object({ streamerId: z.string().uuid() }).parse(req.query);
  const { rows } = await q(`SELECT id, starts_at, duration_min FROM call_slots WHERE streamer_id=$1 AND status='open' AND starts_at > now() ORDER BY starts_at`, [streamerId]);
  res.json(rows);
});

// Atomic claim: only one fan can flip the slot from open to booked.
router.post("/call/slots/:id/book", requireAuth, async (req, res) => {
  const slotId = z.string().uuid().parse(req.params.id);
  const status = await callStatus(req.user!.id, req.user!.birthdate);
  if (!status.eligible) throw new HttpError(403, status.reason ?? "Not eligible", "not_eligible");
  if (status.booked) throw new HttpError(409, "You already have a booked call", "already_booked");
  const r = await q(
    `UPDATE call_slots SET status='booked', booked_by=$2, booked_at=now() WHERE id=$1 AND status='open' AND starts_at > now() RETURNING *`,
    [slotId, req.user!.id],
  );
  if (!r.rowCount) throw new HttpError(409, "That slot was just taken", "slot_taken");
  res.json(r.rows[0]);
});

router.get("/call/join/:slotId", requireAuth, async (req, res) => {
  const u = req.user!;
  const slot = (await q(`SELECT * FROM call_slots WHERE id=$1`, [z.string().uuid().parse(req.params.slotId)])).rows[0];
  if (!slot) throw new HttpError(404, "Unknown call");
  const isFan = slot.booked_by === u.id;
  const isStreamer = u.streamer_id === slot.streamer_id;
  if (!isFan && !isStreamer) throw new HttpError(403, "This call is not yours");

  const start = new Date(slot.starts_at).getTime();
  const end = start + slot.duration_min * 60000;
  const early = start - 10 * 60000;
  if (!cfg.demoMode && (Date.now() < early || Date.now() > end)) {
    throw new HttpError(403, "The room opens 10 minutes before the call", "outside_window");
  }

  if (cfg.livekitKey && cfg.livekitSecret && cfg.livekitUrl) {
    // LiveKit access tokens are HS256 JWTs with a video grant.
    const token = jwt.sign(
      { video: { room: slot.room, roomJoin: true, canPublish: true, canSubscribe: true }, name: u.display_name },
      cfg.livekitSecret,
      { issuer: cfg.livekitKey, subject: u.id, expiresIn: "1h", algorithm: "HS256" },
    );
    return res.json({ mode: "livekit", url: cfg.livekitUrl, token, room: slot.room });
  }
  res.json({ mode: "mock", room: slot.room, startsAt: slot.starts_at, durationMin: slot.duration_min });
});
