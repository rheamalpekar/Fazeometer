import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { q } from "../db.js";
import { cfg } from "../config.js";
import { requireAuth } from "../auth.js";
import { HttpError } from "../util.js";
import { syncYoutube } from "../youtube.js";
import { rateLimit } from "../ratelimit.js";
import { reapStaleStreams } from "../lifecycle.js";

export const router = Router();

// List rows are kept small: a 320x180 thumbnail (about 19 kB instead of 130 kB) and no long description.
export const VIDEO_SELECT = `
  v.id, v.youtube_id, v.title,
  CASE WHEN v.thumbnail_url = '' THEN '' ELSE 'https://i.ytimg.com/vi/' || v.youtube_id || '/mqdefault.jpg' END AS thumbnail_url,
  v.duration_sec, v.views::float AS views, v.channel_title, v.game, v.topics, v.published_at,
  st.display_name AS streamer,
  vp.coverage, vp.last_position, vp.completed`;

export const VIDEO_FROM = `
  FROM videos v
  LEFT JOIN streamers st ON st.id = v.streamer_id
  LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.user_id = $1`;

router.get("/videos", requireAuth, rateLimit("videos", 120, 60, true), async (req, res) => {
  const f = z
    .object({
      game: z.enum(["cod", "fortnite", "other"]).optional(),
      topic: z.string().max(30).optional(),
      search: z.string().max(80).optional(),
      sort: z.enum(["new", "popular"]).default("new"),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    })
    .parse(req.query);
  const { rows } = await q(
    `SELECT ${VIDEO_SELECT} ${VIDEO_FROM}
     WHERE ($2::text IS NULL OR v.game = $2) AND ($3::text IS NULL OR $3 = ANY(v.topics)) AND ($4::text IS NULL OR v.title ILIKE '%' || $4 || '%')
     ORDER BY ${f.sort === "popular" ? "v.views DESC" : "v.published_at DESC NULLS LAST"} LIMIT $5`,
    [req.user!.id, f.game ?? null, f.topic ?? null, f.search ?? null, f.limit],
  );
  res.json(rows);
});

router.get("/videos/:id", requireAuth, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const v = (await q(`SELECT ${VIDEO_SELECT}, v.description ${VIDEO_FROM} WHERE v.id = $2`, [req.user!.id, id])).rows[0];
  if (!v) throw new HttpError(404, "Video not found");
  const related = await q(
    `SELECT ${VIDEO_SELECT} ${VIDEO_FROM}
     WHERE v.id <> $2 AND (v.game = $3 OR v.topics && $4::text[])
     ORDER BY (v.game = $3)::int + cardinality(ARRAY(SELECT unnest(v.topics) INTERSECT SELECT unnest($4::text[]))) DESC, v.views DESC LIMIT 8`,
    [req.user!.id, id, v.game, v.topics],
  );
  res.json({ video: v, related: related.rows });
});

// Re-pull videos from YouTube. Streamer accounts only, three times a day at most.
router.post("/admin/sync-youtube", requireAuth, rateLimit("yt-sync", 3, 86400, true), async (req, res) => {
  if (req.user!.role !== "streamer") throw new HttpError(403, "Streamers only"); // each run costs about 600 YouTube quota units
  if (!cfg.youtubeKey) throw new HttpError(400, "YOUTUBE_API_KEY is not set on the server");
  res.json(await syncYoutube());
});

// Test helper: a video row with no YouTube behind it, so watch proof can be tested without network access.
router.post("/demo/fake-video", requireAuth, async (req, res) => {
  if (!cfg.demoMode) throw new HttpError(404, "Demo mode is off");
  const b = z.object({ title: z.string().default("Test video"), durationSec: z.number().int().min(10).max(1800).default(20) }).parse(req.body ?? {});
  const r = await q(
    `INSERT INTO videos (youtube_id, title, thumbnail_url, duration_sec, channel_title, game, topics, published_at)
     VALUES ($1,$2,'',$3,'Test channel','cod','{highlights}', now()) RETURNING id`,
    [`demo_${crypto.randomBytes(5).toString("hex")}`, b.title, b.durationSec],
  );
  res.json({ id: r.rows[0].id });
});

// Test helper: removes the fake videos (and anyone's progress on them) created by the e2e script.
router.post("/demo/cleanup-fake-videos", requireAuth, async (_req, res) => {
  if (!cfg.demoMode) throw new HttpError(404, "Demo mode is off");
  await q(`DELETE FROM video_progress WHERE video_id IN (SELECT id FROM videos WHERE left(youtube_id, 5) = 'demo_')`);
  const r = await q(`DELETE FROM videos WHERE left(youtube_id, 5) = 'demo_'`);
  res.json({ removed: r.rowCount });
});

// Test helper: run the abandoned-stream reaper now instead of waiting for its minute timer.
router.post("/demo/reap", requireAuth, async (_req, res) => {
  if (!cfg.demoMode) throw new HttpError(404, "Demo mode is off");
  res.json({ reaped: await reapStaleStreams() });
});
