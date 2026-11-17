import { redis, q, audit } from "./db.js";
import { cfg } from "./config.js";

export const keys = {
  live: (streamId: string) => `live:${streamId}`,
  cov: (streamId: string, userId: string) => `cov:${streamId}:${userId}`,
  active: (userId: string) => `active:${userId}`,
  sess: (sessionId: string) => `ws:${sessionId}`,
  attempts: (dropId: string, userId: string) => `att:${dropId}:${userId}`,
  recs: (userId: string) => `recs:${userId}`,
};

const COV_TTL_SEC = 48 * 3600;

export async function getStreamStart(streamId: string): Promise<number | null> {
  const cached = await redis.get(keys.live(streamId));
  if (cached) return Number(cached);
  const { rows } = await q(`SELECT started_at FROM streams WHERE id=$1 AND status='live'`, [streamId]);
  if (!rows[0]?.started_at) return null;
  const ms = new Date(rows[0].started_at).getTime();
  await redis.set(keys.live(streamId), String(ms));
  return ms;
}

// ---- heartbeat buffer: batched into the Tiger Data hypertable (the "heartbeat writer" worker) ----
type Row = [Date, string, string, string, number, number, string];
let buffer: Row[] = [];

const MAX_BUFFER = 50_000;
let droppedRows = 0;

/** Batch-inserts buffered heartbeats. A failed batch goes back in the buffer and is retried on the next tick. */
export async function flushHeartbeats() {
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  const failed: Row[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: any[] = [];
    const values = chunk.map((r, j) => {
      params.push(...r);
      const b = j * 7;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    try {
      await q(
        `INSERT INTO heartbeats (time,user_id,stream_id,session_id,seq,minute_index,player_state) VALUES ${values.join(",")}`,
        params,
      );
    } catch (err) {
      console.error(`[heartbeat writer] insert failed, will retry ${chunk.length} rows:`, (err as Error).message);
      failed.push(...chunk);
    }
  }
  if (failed.length) {
    buffer = failed.concat(buffer);
    if (buffer.length > MAX_BUFFER) {
      droppedRows += buffer.length - MAX_BUFFER;
      buffer = buffer.slice(buffer.length - MAX_BUFFER); // keep the newest, and say so loudly
      console.error(`[heartbeat writer] buffer full, dropped ${droppedRows} oldest rows in total`);
    }
  }
}

export const startWorkers = () => setInterval(() => void flushHeartbeats(), 2000);

// ---- heartbeat handling ----
export interface HeartbeatIn {
  sessionId: string;
  seq: number;
  state: string; // 'playing' | 'paused' | 'buffering' ...
  visible: boolean;
}
export type HeartbeatResult = { ok: true; counted: boolean; minute: number } | { ok: false; reason: string };

export async function handleHeartbeat(userId: string, p: HeartbeatIn): Promise<HeartbeatResult> {
  if (!p || typeof p.sessionId !== "string" || !Number.isInteger(p.seq)) return { ok: false, reason: "bad_payload" };
  const s = await redis.hgetall(keys.sess(p.sessionId));
  if (!s.userId || s.userId !== userId) return { ok: false, reason: "bad_session" };
  if ((await redis.get(keys.active(userId))) !== p.sessionId) return { ok: false, reason: "replaced" };

  const startMs = await getStreamStart(s.streamId);
  if (!startMs) return { ok: false, reason: "not_live" };

  const now = Date.now();
  const lastTs = Number(s.lastTs || 0);
  const lastSeq = Number(s.lastSeq ?? -1);
  if (p.seq <= lastSeq) return { ok: false, reason: "bad_seq" };
  if (lastTs && now - lastTs < cfg.hbMs * 0.6) {
    void audit("hb_too_fast", { userId, streamId: s.streamId, gapMs: now - lastTs });
    return { ok: false, reason: "too_fast" };
  }

  await redis.hset(keys.sess(p.sessionId), { lastTs: String(now), lastSeq: String(p.seq) });
  await redis.set(keys.active(userId), p.sessionId, "PX", Math.round(cfg.hbMs * 2.5));

  const minute = Math.max(0, Math.floor((now - startMs) / cfg.minuteMs));
  const counted = p.state === "playing" && p.visible === true;
  if (counted) {
    const k = keys.cov(s.streamId, userId);
    await redis.setbit(k, minute, 1);
    await redis.expire(k, COV_TTL_SEC);
  }
  buffer.push([new Date(now), userId, s.streamId, p.sessionId, p.seq, minute, counted ? "playing" : "idle"]);
  return { ok: true, counted, minute };
}

// ---- coverage ----
export function countBits(buf: Buffer | null, from: number, to: number) {
  if (!buf) return 0;
  let c = 0;
  for (let i = from; i < to; i++) {
    const byte = buf[i >> 3];
    if (byte !== undefined && byte & (0x80 >> (i & 7))) c++;
  }
  return c;
}

export interface Eligibility {
  eligible: boolean;
  coverage: number;
  finalOk: boolean;
  watched: number;
  elapsed: number;
}

/** elapsed = completed stream minutes at the moment the drop opened. */
export async function eligibility(streamId: string, userId: string, elapsed: number): Promise<Eligibility> {
  if (elapsed < 1) return { eligible: false, coverage: 0, finalOk: false, watched: 0, elapsed };
  const b = await redis.getBuffer(keys.cov(streamId, userId));
  const watched = countBits(b, 0, elapsed);
  const coverage = watched / elapsed;
  const n = Math.min(cfg.finalWindowMin, elapsed);
  const finalOk = countBits(b, elapsed - n, elapsed) >= Math.ceil(n * cfg.finalWindowShare);
  return { eligible: coverage >= cfg.minCoverage && finalOk, coverage, finalOk, watched, elapsed };
}

/** Everyone with a coverage record for the stream. */
export async function viewersOf(streamId: string): Promise<string[]> {
  const prefix = `cov:${streamId}:`;
  const out: string[] = [];
  let cursor = "0";
  do {
    const [next, found] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    for (const k of found) out.push(k.slice(prefix.length));
  } while (cursor !== "0");
  return out;
}
