import { Router } from "express";
import { z } from "zod";
import { q, redis, mdb } from "../db.js";
import { cfg } from "../config.js";
import { requireAuth, type AuthUser } from "../auth.js";
import { HttpError, safe } from "../util.js";
import { rateLimit } from "../ratelimit.js";
import { sqlRecommend, geminiRefine, INTERESTS, type Pick } from "../recommend.js";
import { emitUser } from "../realtime.js";
import { VIDEO_SELECT, VIDEO_FROM } from "./videos.js";

export const router = Router();

const STREAM_SELECT = `
  s.id, s.title, s.game, s.platform, s.embed_id, s.status, s.scheduled_for, s.started_at, s.description,
  coalesce(s.thumbnail_url, CASE WHEN s.platform = 'youtube' AND s.embed_id IS NOT NULL THEN 'https://i.ytimg.com/vi/' || s.embed_id || '/mqdefault.jpg' END) AS thumbnail_url,
  st.id AS streamer_id, st.display_name AS streamer, st.country, st.followers, st.is_partner, st.color`;

type Recs = { source: "gemini" | "sql"; picks: Pick[] };

/**
 * Stale-while-revalidate. The page never waits on Gemini: it gets the fast SQL ranking right away.
 * Gemini refines it in the background, caches the result, and tells the page over the socket to reload.
 */
async function getRecs(u: AuthUser, interests: string[], fresh: boolean): Promise<Recs> {
  const key = `feed:${u.id}`;
  if (!fresh) {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as Recs;
  }
  const base = await sqlRecommend(u, interests);
  const recs: Recs = { source: "sql", picks: base.picks };
  await redis.set(key, JSON.stringify(recs), "EX", 60);
  if (cfg.geminiKey) {
    safe("feed-refine", (async () => {
      if (!(await redis.set(`feedlock:${u.id}`, "1", "EX", 30, "NX"))) return; // one refinement at a time per user
      const picks = await geminiRefine(u, interests, base);
      if (!picks) return;
      const refined: Recs = { source: "gemini", picks };
      await redis.set(key, JSON.stringify(refined), "EX", 300);
      emitUser(u.id, "feed:updated", {});
      await mdb.collection("recommendations").insertOne({ userId: u.id, source: "gemini", picks, at: new Date() });
    })());
  }
  return recs;
}

router.get("/feed", requireAuth, rateLimit("feed", 30, 60, true), async (req, res) => {
  const u = req.user!;
  const interests = ((await q(`SELECT interests FROM users WHERE id=$1`, [u.id])).rows[0]?.interests ?? []) as string[];

  const [live, upcoming, events, cont, recs] = await Promise.all([
    q(`SELECT ${STREAM_SELECT} FROM streams s JOIN streamers st ON st.id = s.streamer_id WHERE s.status='live' ORDER BY s.started_at DESC LIMIT 12`),
    q(
      `SELECT ${STREAM_SELECT} FROM streams s JOIN streamers st ON st.id = s.streamer_id
       WHERE s.status='scheduled' AND s.scheduled_for > now() ORDER BY s.scheduled_for LIMIT 12`,
    ),
    q(
      `SELECT e.*, (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id=e.id) AS rsvps,
              EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1) AS going
       FROM events e WHERE e.starts_at > now() - interval '3 hours' ORDER BY e.starts_at LIMIT 8`,
      [u.id],
    ),
    q(`SELECT ${VIDEO_SELECT} ${VIDEO_FROM} WHERE vp.completed = false AND vp.coverage > 0.02 ORDER BY vp.updated_at DESC LIMIT 8`, [u.id]),
    getRecs(u, interests, req.query.fresh === "1" && cfg.demoMode),
  ]);

  const ids = recs.picks.map((p) => p.id);
  const vids = ids.length ? (await q(`SELECT ${VIDEO_SELECT} ${VIDEO_FROM} WHERE v.id = ANY($2::uuid[])`, [u.id, ids])).rows : [];
  const byId = new Map(vids.map((v) => [v.id, v]));
  const forYou = recs.picks.filter((p) => byId.has(p.id)).map((p) => ({ video: byId.get(p.id), reason: p.reason }));

  res.json({ live: live.rows, upcoming: upcoming.rows, events: events.rows, forYou, continueWatching: cont.rows, source: recs.source, interests });
});

router.put("/me/interests", requireAuth, async (req, res) => {
  const { interests } = z.object({ interests: z.array(z.string()).max(12) }).parse(req.body);
  const clean = [...new Set(interests.filter((i) => INTERESTS.includes(i)))];
  await q(`UPDATE users SET interests=$1 WHERE id=$2`, [clean, req.user!.id]);
  await redis.del(`feed:${req.user!.id}`);
  res.json({ interests: clean });
});

router.get("/events", requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT e.*, (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id=e.id) AS rsvps,
            EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1) AS going
     FROM events e WHERE e.starts_at > now() - interval '3 hours' ORDER BY e.starts_at`,
    [req.user!.id],
  );
  res.json(rows);
});

router.post("/events/:id/rsvp", requireAuth, rateLimit("rsvp", 60, 60, true), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const e = await q(`SELECT 1 FROM events WHERE id=$1`, [id]);
  if (!e.rowCount) throw new HttpError(404, "Event not found");
  const del = await q(`DELETE FROM event_rsvps WHERE user_id=$1 AND event_id=$2`, [req.user!.id, id]);
  if (del.rowCount) return res.json({ going: false });
  await q(`INSERT INTO event_rsvps (user_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user!.id, id]);
  res.json({ going: true });
});
