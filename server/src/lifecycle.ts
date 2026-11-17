import { pool, q, redis } from "./db.js";
import { cfg } from "./config.js";
import { keys, flushHeartbeats } from "./watch.js";
import { emitAll } from "./realtime.js";

/**
 * Ends a live stream and writes the permanent watch record from the Tiger Data hypertable.
 * Safe to call twice: only the call that flips the stream from live to ended does the work.
 * Used by the streamer's End button and by the reaper for streams that were abandoned.
 */
export async function finishStream(streamId: string): Promise<{ viewers: number; totalMinutes: number } | null> {
  await flushHeartbeats();
  const ended = (await q(`UPDATE streams SET status='ended', ended_at=now() WHERE id=$1 AND status='live' RETURNING started_at, ended_at`, [streamId])).rows[0];
  if (!ended) return null;

  const total = Math.max(1, Math.ceil((new Date(ended.ended_at).getTime() - new Date(ended.started_at).getTime()) / cfg.minuteMs));
  const n = Math.min(cfg.finalWindowMin, total);
  const agg = await q(
    `SELECT user_id, count(DISTINCT minute_index)::int AS minutes,
            count(DISTINCT minute_index) FILTER (WHERE minute_index >= $2)::int AS final_minutes
     FROM heartbeats WHERE stream_id=$1 AND player_state='playing' GROUP BY user_id`,
    [streamId, total - n],
  );

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const r of agg.rows) {
      const minutes = Math.min(r.minutes, total);
      await c.query(
        `INSERT INTO watch_sessions (user_id, stream_id, minutes_watched, coverage, in_final_window) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, stream_id) DO UPDATE SET minutes_watched=EXCLUDED.minutes_watched, coverage=EXCLUDED.coverage, in_final_window=EXCLUDED.in_final_window`,
        [r.user_id, streamId, minutes, minutes / total, r.final_minutes >= Math.ceil(n * cfg.finalWindowShare)],
      );
      await c.query(`UPDATE users SET credits = credits + $1 WHERE id=$2`, [Math.min(minutes, 120), r.user_id]);
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }

  await redis.del(keys.live(streamId));
  emitAll("stream:ended", { streamId });
  return { viewers: agg.rows.length, totalMinutes: total };
}

/** Ends streams whose Studio stopped pinging (closed laptop, crash) and streams that ran past the maximum length. */
export async function reapStaleStreams(): Promise<number> {
  const stale = await q(
    `SELECT id FROM streams
     WHERE status='live' AND keepalive=false
       AND (coalesce(last_ping_at, started_at) < now() - ($1 || ' milliseconds')::interval
            OR started_at < now() - ($2 || ' hours')::interval)`,
    [String(cfg.streamPingTimeoutMs), String(cfg.streamMaxHours)],
  );
  for (const s of stale.rows) {
    try {
      await finishStream(s.id);
      console.log(`[reaper] ended abandoned stream ${s.id}`);
    } catch (err) {
      console.warn(`[reaper] could not end ${s.id}: ${(err as Error).message}`);
    }
  }
  return stale.rows.length;
}

export const startReaper = () => setInterval(() => void reapStaleStreams().catch((e) => console.warn("[reaper]", e.message)), 60_000);
