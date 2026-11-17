import { Router } from "express";
import { q, redis, mdb } from "../db.js";
import { requireAuth } from "../auth.js";
import { geminiJson } from "../gemini.js";
import { keys } from "../watch.js";
import { rateLimit } from "../ratelimit.js";

export const router = Router();

interface StreamCand {
  id: string; title: string; game: string; status: string; streamer: string; streamer_id: string;
  country: string; followers: number; is_partner: boolean;
}
interface Pick { id: string; reason: string }

const SCHEMA = {
  type: "OBJECT",
  properties: {
    streams: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, reason: { type: "STRING" } }, required: ["id", "reason"] } },
    streamers: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, reason: { type: "STRING" } }, required: ["id", "reason"] } },
  },
  required: ["streams", "streamers"],
};

router.get("/recommendations", requireAuth, rateLimit("recs", 20, 60, true), async (req, res) => {
  const u = req.user!;
  const cached = await redis.get(keys.recs(u.id));
  if (cached && req.query.fresh !== "1") return res.json(JSON.parse(cached));

  // 1. Candidates from SQL. Gemini may only choose from these.
  const [streamsQ, watchedQ, progressQ] = await Promise.all([
    q<StreamCand>(
      `SELECT s.id, s.title, s.game, s.status, st.display_name AS streamer, st.id AS streamer_id, st.country, st.followers, st.is_partner
       FROM streams s JOIN streamers st ON st.id = s.streamer_id WHERE s.status IN ('live','scheduled') LIMIT 12`,
    ),
    q(`SELECT st.id, count(*)::int AS n FROM watch_sessions w JOIN streams s ON s.id=w.stream_id JOIN streamers st ON st.id=s.streamer_id WHERE w.user_id=$1 GROUP BY st.id`, [u.id]),
    q(`SELECT t.game, t.name, t.total_parts - (SELECT count(*) FROM user_parts up WHERE up.user_character_id=uc.id) AS parts_left
       FROM user_characters uc JOIN character_templates t ON t.id=uc.template_id WHERE uc.user_id=$1 AND uc.status='building'`, [u.id]),
  ]);
  const watched = new Map(watchedQ.rows.map((r) => [r.id as string, r.n as number]));
  const game = u.game_pref ?? progressQ.rows[0]?.game ?? null;

  const score = (s: StreamCand) =>
    (s.game === game ? 3 : 0) + (s.country === u.country ? 2 : 0) + Math.min(watched.get(s.streamer_id) ?? 0, 3) + (s.status === "live" ? 1 : 0);
  const sqlStreams = [...streamsQ.rows].sort((a, b) => score(b) - score(a)).slice(0, 5);
  const partners = streamsQ.rows.filter((s) => s.is_partner);
  const uniquePartners = [...new Map(partners.map((s) => [s.streamer_id, s])).values()];
  const sqlStreamers = [...uniquePartners].sort((a, b) => (b.country === u.country ? 1 : 0) - (a.country === u.country ? 1 : 0) || b.followers - a.followers).slice(0, 4);

  const sqlReason = (s: StreamCand) => {
    const bits = [];
    if (s.game === game) bits.push(`same game (${s.game === "cod" ? "COD" : "Fortnite"})`);
    if (s.country === u.country) bits.push("same country");
    if ((watched.get(s.streamer_id) ?? 0) > 0) bits.push("you have watched them before");
    if (s.status === "live") bits.push("live now");
    return bits.length ? bits.join(", ") : "popular partner stream";
  };

  let source: "gemini" | "sql" = "sql";
  let streams: Pick[] = sqlStreams.map((s) => ({ id: s.id, reason: sqlReason(s) }));
  let streamers: Pick[] = sqlStreamers.map((s) => ({ id: s.streamer_id, reason: s.country === u.country ? "Partner from your country" : "Partner streamer" }));

  // 2. Gemini ranks the candidates. Anything it returns outside the candidate list is dropped.
  const prompt = JSON.stringify({
    task: "Rank streams and call-partner streamers for this fan. Pick up to 5 streams and up to 4 streamers. Give each a reason under 14 words that cites a real fact from the data. Only use ids from the candidate lists.",
    fan: { game, country: u.country, characters_in_progress: progressQ.rows, streamers_watched_before: Object.fromEntries(watched) },
    stream_candidates: streamsQ.rows.map((s) => ({ id: s.id, title: s.title, game: s.game, status: s.status, streamer: s.streamer, country: s.country })),
    streamer_candidates: uniquePartners.map((s) => ({ id: s.streamer_id, name: s.streamer, country: s.country, followers: s.followers })),
  });
  const g = await geminiJson<{ streams: Pick[]; streamers: Pick[] }>(prompt, SCHEMA);
  if (g) {
    const sIds = new Set(streamsQ.rows.map((s) => s.id));
    const pIds = new Set(uniquePartners.map((s) => s.streamer_id));
    const gs = (g.streams ?? []).filter((p) => sIds.has(p.id)).slice(0, 5);
    const gp = (g.streamers ?? []).filter((p) => pIds.has(p.id)).slice(0, 4);
    if (gs.length) {
      streams = gs;
      streamers = gp.length ? gp : streamers;
      source = "gemini";
    }
  }

  const byId = new Map(streamsQ.rows.map((s) => [s.id, s]));
  const byStreamer = new Map(streamsQ.rows.map((s) => [s.streamer_id, s]));
  const out = {
    source,
    streams: streams.map((p) => ({ ...p, stream: byId.get(p.id) })),
    streamers: streamers.map((p) => ({ ...p, streamer: byStreamer.get(p.id) })),
  };
  await redis.set(keys.recs(u.id), JSON.stringify(out), "EX", 600);
  void mdb.collection("recommendations").insertOne({ userId: u.id, source, streams, streamers, at: new Date() }).catch(() => {});
  res.json(out);
});
