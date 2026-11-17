import { pool, q, redis, audit } from "./db.js";
import { cfg } from "./config.js";
import { countBits } from "./watch.js";
import { emitUser } from "./realtime.js";
import { notify } from "./notifications.js";
import { safe } from "./util.js";

/**
 * Video watch proof. The YouTube player reports its position every few seconds. Playback only counts when the
 * position moved forward about as fast as the wall clock did, so seeking ahead earns nothing. Each 5-second
 * bucket of the video that was genuinely played is set in a Redis bitmap. At 85% coverage the video is complete.
 *
 * Cost control: a beat touches Redis only. Progress is saved to Postgres at most every videoDbWriteMs,
 * and once more when the video completes.
 */
export interface VideoBeat {
  videoId: string;
  seq: number;
  position: number;
  state: string; // 'playing' | 'paused' | 'buffering' ...
  visible: boolean;
  rate?: number;
}

export type VideoBeatResult =
  | { ok: true; coverage: number; completed: boolean; counted: boolean; award?: AwardResult }
  | { ok: false; reason: string };

export interface AwardResult {
  awarded: boolean;
  reason?: string;
  part?: { id: string; slot: string; rarity: string; position: number };
  characterId?: string;
  owned?: number;
  total?: number;
  complete?: boolean;
}

const vKey = (u: string, v: string) => `vw:${u}:${v}`;
const covKey = (u: string, v: string) => `vcov:${u}:${v}`;
const doneKey = (u: string, v: string) => `vdone:${u}:${v}`;
const activeKey = (u: string) => `vactive:${u}`;
const durationCache = new Map<string, { duration: number; title: string }>();

async function getVideo(id: string) {
  const hit = durationCache.get(id);
  if (hit) return hit;
  const r = (await q(`SELECT duration_sec, title FROM videos WHERE id=$1`, [id])).rows[0];
  if (!r) return null;
  const v = { duration: r.duration_sec as number, title: r.title as string };
  if (durationCache.size > 5000) durationCache.clear(); // bounded, so it cannot grow forever
  durationCache.set(id, v);
  return v;
}

export async function handleVideoBeat(userId: string, b: VideoBeat): Promise<VideoBeatResult> {
  if (!b || typeof b.videoId !== "string" || !Number.isInteger(b.seq) || typeof b.position !== "number" || !Number.isFinite(b.position)) return { ok: false, reason: "bad_payload" };
  const video = await getVideo(b.videoId);
  if (!video) return { ok: false, reason: "unknown_video" };

  if (await redis.get(doneKey(userId, b.videoId))) return { ok: true, coverage: 1, completed: true, counted: false };
  const done = await q(`SELECT completed FROM video_progress WHERE user_id=$1 AND video_id=$2`, [userId, b.videoId]);
  if (done.rows[0]?.completed) {
    await redis.set(doneKey(userId, b.videoId), "1", "EX", 30 * 24 * 3600);
    return { ok: true, coverage: 1, completed: true, counted: false };
  }

  // One video at a time per account, so a script cannot work through many videos in parallel on one login.
  const active = await redis.get(activeKey(userId));
  if (active && active !== b.videoId) return { ok: false, reason: "another_video_active" };
  await redis.set(activeKey(userId), b.videoId, "PX", Math.round(cfg.videoHbMs * 3));

  const B = cfg.videoBucketSec;
  const total = Math.max(1, Math.ceil(video.duration / B));
  const key = vKey(userId, b.videoId);
  const st = await redis.hgetall(key);
  const now = Date.now();
  const lastTs = Number(st.lastTs || 0);
  const lastPos = st.lastPos === undefined ? -1 : Number(st.lastPos);
  const lastSeq = st.lastSeq === undefined ? -1 : Number(st.lastSeq);

  if (b.seq <= lastSeq) return { ok: false, reason: "bad_seq" };
  if (lastTs && now - lastTs < cfg.videoHbMs * 0.6) {
    safe("audit", audit("vhb_too_fast", { userId, videoId: b.videoId, gapMs: now - lastTs }));
    return { ok: false, reason: "too_fast" };
  }

  const pos = Math.min(Math.max(0, b.position), video.duration);
  let counted = false;
  if (b.state === "playing" && b.visible === true && lastTs && lastPos >= 0) {
    const wall = (now - lastTs) / 1000;
    const delta = pos - lastPos;
    const rate = Math.min(Math.max(b.rate ?? 1, 0.25), 2);
    // Forward progress no faster than the playback rate allows. Anything bigger is a seek and earns nothing.
    if (delta >= 0 && delta <= wall * rate * 1.15 + 1) {
      const k = covKey(userId, b.videoId);
      const from = Math.floor(lastPos / B);
      const to = Math.min(total - 1, Math.floor(pos / B));
      const pl = redis.pipeline();
      for (let i = from; i <= to; i++) pl.setbit(k, i, 1);
      pl.expire(k, 30 * 24 * 3600);
      await pl.exec();
      counted = true;
    } else {
      safe("audit", audit("vhb_seek", { userId, videoId: b.videoId, delta, wall }));
    }
  }
  await redis
    .pipeline()
    .hset(key, { lastTs: String(now), lastPos: String(pos), lastSeq: String(b.seq) })
    .expire(key, 7 * 24 * 3600)
    .exec();

  const buf = await redis.getBuffer(covKey(userId, b.videoId));
  const marked = countBits(buf, 0, total);
  const coverage = marked / total;
  const finishing = coverage >= cfg.videoMinCoverage;

  // Save to Postgres at most every videoDbWriteMs, and always when finishing.
  const mayWrite = finishing || (await redis.set(`vwrite:${userId}:${b.videoId}`, "1", "PX", cfg.videoDbWriteMs, "NX")) === "OK";
  if (mayWrite) {
    await q(
      `INSERT INTO video_progress (user_id, video_id, seconds_watched, coverage, last_position)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, video_id) DO UPDATE SET seconds_watched=EXCLUDED.seconds_watched, coverage=EXCLUDED.coverage, last_position=EXCLUDED.last_position, updated_at=now()`,
      [userId, b.videoId, marked * B, coverage, Math.floor(pos)],
    );
  }

  if (finishing) {
    const award = await completeVideo(userId, b.videoId, video.title);
    await redis.set(doneKey(userId, b.videoId), "1", "EX", 30 * 24 * 3600);
    return { ok: true, coverage, completed: true, counted, award };
  }
  return { ok: true, coverage, completed: false, counted };
}

/** Marks the video complete once, then grants one relic unless today's video relic limit is reached. */
async function completeVideo(userId: string, videoId: string, title: string): Promise<AwardResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mark = await client.query(
      `UPDATE video_progress SET completed=true, completed_at=now() WHERE user_id=$1 AND video_id=$2 AND completed=false RETURNING 1`,
      [userId, videoId],
    );
    if (!mark.rowCount) {
      await client.query("ROLLBACK");
      return { awarded: false, reason: "already_completed" };
    }
    const today = (
      await client.query(
        `SELECT count(*)::int AS n FROM user_parts up JOIN user_characters uc ON uc.id=up.user_character_id
         WHERE uc.user_id=$1 AND up.source_kind='video' AND up.unlocked_at >= date_trunc('day', now())`,
        [userId],
      )
    ).rows[0].n as number;
    if (today >= cfg.videoPartsPerDay) {
      await client.query("COMMIT");
      return { awarded: false, reason: `Daily relic limit reached (${cfg.videoPartsPerDay} from videos). Come back tomorrow, or join a live stream.` };
    }
    const ch = (
      await client.query(
        `SELECT uc.id, uc.template_id, t.total_parts FROM user_characters uc JOIN character_templates t ON t.id=uc.template_id
         WHERE uc.user_id=$1 AND uc.status='building' ORDER BY t.slot_number LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!ch) {
      await client.query("COMMIT");
      return { awarded: false, reason: "Launch your ship on your profile to collect relics." };
    }
    const part = (
      await client.query(
        `SELECT id, position, slot, rarity FROM parts WHERE template_id=$1
         AND id NOT IN (SELECT part_id FROM user_parts WHERE user_character_id=$2) ORDER BY random() LIMIT 1`,
        [ch.template_id, ch.id],
      )
    ).rows[0];
    if (!part) {
      await client.query("COMMIT");
      return { awarded: false, reason: "This build is already complete." };
    }
    await client.query(
      `INSERT INTO user_parts (user_character_id, part_id, source_kind, source_id, source_title) VALUES ($1,$2,'video',$3,$4)`,
      [ch.id, part.id, videoId, title],
    );
    await client.query(`UPDATE users SET credits = credits + 5 WHERE id=$1`, [userId]);
    const owned = (await client.query(`SELECT count(*)::int AS n FROM user_parts WHERE user_character_id=$1`, [ch.id])).rows[0].n as number;
    const complete = owned >= ch.total_parts;
    if (complete) await client.query(`UPDATE user_characters SET status='complete', completed_at=now() WHERE id=$1`, [ch.id]);
    await client.query("COMMIT");

    await redis.del(`feed:${userId}`);
    const result: AwardResult = { awarded: true, part, characterId: ch.id, owned, total: ch.total_parts, complete };
    emitUser(userId, "part:unlocked", { characterId: ch.id, parts: [part], owned, total: ch.total_parts, complete, source: { kind: "video", title } });
    if (complete) emitUser(userId, "character:complete", { characterId: ch.id });
    safe("notify-relic", notify(userId, { type: "relic", title: `Relic unlocked: ${part.slot}`, body: `For finishing "${title}"`, data: { characterId: ch.id, owned, total: ch.total_parts } }));
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
