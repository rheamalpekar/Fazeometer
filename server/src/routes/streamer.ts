import { Router } from "express";
import { z } from "zod";
import { q, redis, hasTimescale } from "../db.js";
import { cfg } from "../config.js";
import { requireStreamer } from "../auth.js";
import { HttpError, makeCode, hashCode, safe } from "../util.js";
import { keys, viewersOf, eligibility, getStreamStart } from "../watch.js";
import { finishStream } from "../lifecycle.js";
import { notifyStreamLive } from "../notifications.js";
import { emitAll, emitUser } from "../realtime.js";
import { hasEntitlement } from "../auth.js";

export const router = Router();
router.use("/streamer", requireStreamer);

async function ownStream(streamId: string, streamerId: string) {
  const s = (await q(`SELECT * FROM streams WHERE id=$1 AND streamer_id=$2`, [streamId, streamerId])).rows[0];
  if (!s) throw new HttpError(404, "Stream not found");
  return s;
}

router.get("/streamer/me", async (req, res) => {
  const sid = req.user!.streamer_id!;
  const [st, streams, slots] = await Promise.all([
    q(`SELECT * FROM streamers WHERE id=$1`, [sid]),
    q(`SELECT * FROM streams WHERE streamer_id=$1 ORDER BY coalesce(started_at, scheduled_for) DESC LIMIT 10`, [sid]),
    q(`SELECT cs.*, u.display_name AS booked_by_name FROM call_slots cs LEFT JOIN users u ON u.id=cs.booked_by
       WHERE cs.streamer_id=$1 ORDER BY starts_at LIMIT 20`, [sid]),
  ]);
  res.json({ streamer: st.rows[0], streams: streams.rows, slots: slots.rows });
});

router.post("/streamer/streams", async (req, res) => {
  const b = z
    .object({
      title: z.string().min(3).max(80),
      game: z.enum(["cod", "fortnite"]),
      platform: z.enum(["demo", "twitch", "youtube"]).default("demo"),
      embedId: z.string().max(60).optional(),
      thumbnailUrl: z.string().url().max(400).refine((u) => u.startsWith("https://"), "Cover art must be an https link").optional(),
    })
    .parse(req.body);
  const r = await q(
    `INSERT INTO streams (streamer_id, title, game, platform, embed_id, thumbnail_url, scheduled_for) VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *`,
    [req.user!.streamer_id, b.title, b.game, b.platform, b.embedId ?? null, b.thumbnailUrl ?? null],
  );
  res.json(r.rows[0]);
});

router.post("/streamer/streams/:id/start", async (req, res) => {
  const s = await ownStream(z.string().uuid().parse(req.params.id), req.user!.streamer_id!);
  if (s.status !== "scheduled") throw new HttpError(409, "Stream already started");
  const r = await q(`UPDATE streams SET status='live', started_at=now(), last_ping_at=now() WHERE id=$1 AND status='scheduled' RETURNING *`, [s.id]);
  if (!r.rows[0]) throw new HttpError(409, "Stream already started");
  await redis.set(keys.live(s.id), String(new Date(r.rows[0].started_at).getTime()));
  emitAll("stream:live", { streamId: s.id, title: s.title });
  const streamer = (await q(`SELECT display_name FROM streamers WHERE id=$1`, [s.streamer_id])).rows[0]?.display_name ?? "A streamer";
  safe("notify-live", notifyStreamLive({ streamId: s.id, title: s.title, game: s.game, streamer, excludeUserId: req.user!.id }));
  res.json(r.rows[0]);
});

// The Studio pings every 30 seconds while a stream is live. If the pings stop, the reaper ends the stream.
router.post("/streamer/streams/:id/ping", async (req, res) => {
  const r = await q(`UPDATE streams SET last_ping_at=now() WHERE id=$1 AND streamer_id=$2 AND status='live'`, [z.string().uuid().parse(req.params.id), req.user!.streamer_id]);
  res.json({ ok: r.rowCount === 1 });
});

// The end-of-stream moment: create the secret code, tell eligible viewers a drop is open.
router.post("/streamer/streams/:id/drop", async (req, res) => {
  const s = await ownStream(z.string().uuid().parse(req.params.id), req.user!.streamer_id!);
  const { tier } = z.object({ tier: z.enum(["free", "premium"]).default("free") }).parse(req.body ?? {});
  if (s.status !== "live") throw new HttpError(409, "Drops can only be created while the stream is live");
  const startMs = await getStreamStart(s.id);
  const elapsed = Math.floor((Date.now() - (startMs ?? Date.now())) / cfg.minuteMs);
  if (elapsed < 1) throw new HttpError(409, "Wait for at least one full stream minute before dropping the code");

  const code = makeCode();
  const parts = elapsed >= cfg.longStreamMinutes ? 2 : 1;
  const closesAt = new Date(Date.now() + cfg.dropWindowMin * cfg.minuteMs);
  const d = (
    await q(
      `INSERT INTO drops (stream_id, code_hash, opens_at, closes_at, tier, parts_awarded, elapsed_minutes)
       VALUES ($1,$2,now(),$3,$4,$5,$6) RETURNING id`,
      [s.id, hashCode(code), closesAt, tier, parts, elapsed],
    )
  ).rows[0];

  // Push drop:open only to viewers who qualify. The code is not in the payload.
  let eligibleCount = 0;
  for (const userId of await viewersOf(s.id)) {
    const e = await eligibility(s.id, userId, elapsed);
    if (!e.eligible) continue;
    if (tier === "premium" && !(await hasEntitlement(userId, "premium"))) continue;
    eligibleCount++;
    emitUser(userId, "drop:open", { dropId: d.id, streamId: s.id, closesAt, tier, partsAwarded: parts });
  }
  res.json({ dropId: d.id, code, closesAt, partsAwarded: parts, eligibleCount });
});

router.post("/streamer/streams/:id/end", async (req, res) => {
  const s = await ownStream(z.string().uuid().parse(req.params.id), req.user!.streamer_id!);
  const done = await finishStream(s.id);
  if (!done) throw new HttpError(409, "Stream is not live");
  res.json({ ended: true, ...done });
});

// Viewers over time, read straight from the Tiger Data hypertable with time_bucket.
router.get("/streamer/streams/:id/analytics", async (req, res) => {
  const s = await ownStream(z.string().uuid().parse(req.params.id), req.user!.streamer_id!);
  const secs = Math.max(1, cfg.minuteMs / 1000);
  const bucket = hasTimescale ? "time_bucket(make_interval(secs => $2::double precision), time)" : "to_timestamp(floor(extract(epoch FROM time) / $2::double precision) * $2::double precision)";
  const [series, totals, redeemed] = await Promise.all([
    q(
      `SELECT ${bucket} AS t, count(DISTINCT user_id)::int AS viewers
       FROM heartbeats WHERE stream_id=$1 AND player_state='playing' GROUP BY 1 ORDER BY 1`,
      [s.id, secs],
    ),
    q(`SELECT count(DISTINCT user_id)::int AS unique_viewers FROM heartbeats WHERE stream_id=$1 AND player_state='playing'`, [s.id]),
    q(`SELECT count(*)::int AS n FROM drop_redemptions r JOIN drops d ON d.id = r.drop_id WHERE d.stream_id=$1`, [s.id]),
  ]);
  const points = series.rows.map((r) => ({ t: r.t, viewers: r.viewers }));
  res.json({
    series: points,
    peak: points.reduce((m, p) => Math.max(m, p.viewers), 0),
    uniqueViewers: totals.rows[0].unique_viewers,
    relicsClaimed: redeemed.rows[0].n,
  });
});

router.post("/streamer/slots", async (req, res) => {
  const b = z.object({ startsAt: z.string().datetime(), durationMin: z.number().int().min(5).max(60).default(15) }).parse(req.body);
  const st = (await q(`SELECT is_partner FROM streamers WHERE id=$1`, [req.user!.streamer_id])).rows[0];
  if (!st?.is_partner) throw new HttpError(403, "Only partner streamers (30,000+ followers) can offer calls", "not_partner");
  const r = await q(`INSERT INTO call_slots (streamer_id, starts_at, duration_min) VALUES ($1,$2,$3) RETURNING *`, [req.user!.streamer_id, b.startsAt, b.durationMin]);
  res.json(r.rows[0]);
});

// ---- posting videos and events ----
import { extractVideoId, fetchVideos, insertVideo } from "../youtube.js";

router.post("/streamer/videos", async (req, res) => {
  const b = z.object({ url: z.string().min(11).max(300), game: z.enum(["cod", "fortnite", "other"]).optional() }).parse(req.body);
  const id = extractVideoId(b.url);
  if (!id) throw new HttpError(400, "That does not look like a YouTube link");
  if (!cfg.youtubeKey) throw new HttpError(400, "YOUTUBE_API_KEY is not set on the server");
  const [v] = await fetchVideos([id]);
  if (!v) throw new HttpError(404, "YouTube has no public video with that id");
  if (!v.embeddable) throw new HttpError(400, "The owner has turned off embedding for this video");
  if (v.durationSec < cfg.videoMinSec || v.durationSec > cfg.videoMaxSec) {
    throw new HttpError(400, `Videos must be between ${cfg.videoMinSec} seconds and ${Math.round(cfg.videoMaxSec / 60)} minutes so viewers can finish them`);
  }
  const row = await insertVideo(v, req.user!.streamer_id, b.game);
  res.json(row);
});

router.get("/streamer/videos", async (req, res) => {
  const { rows } = await q(
    `SELECT v.*, (SELECT count(*)::int FROM video_progress p WHERE p.video_id=v.id AND p.completed) AS completions,
            (SELECT count(*)::int FROM video_progress p WHERE p.video_id=v.id) AS viewers
     FROM videos v WHERE v.streamer_id=$1 ORDER BY v.created_at DESC LIMIT 30`,
    [req.user!.streamer_id],
  );
  res.json(rows);
});

router.post("/streamer/events", async (req, res) => {
  const b = z
    .object({
      title: z.string().min(3).max(80),
      kind: z.enum(["tournament", "watch_party", "meetup", "drop"]),
      game: z.enum(["cod", "fortnite", "other"]).default("other"),
      startsAt: z.string().datetime(),
      location: z.string().max(80).default("Online"),
      description: z.string().max(400).default(""),
    })
    .parse(req.body);
  const r = await q(
    `INSERT INTO events (title, kind, game, starts_at, location, description, streamer_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.title, b.kind, b.game, b.startsAt, b.location, b.description, req.user!.streamer_id],
  );
  res.json(r.rows[0]);
});
