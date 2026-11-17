import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { pool, q, redis, audit } from "../db.js";
import { cfg } from "../config.js";
import { requireAuth, hasEntitlement } from "../auth.js";
import { HttpError, hashCode, safeEqual, safe } from "../util.js";
import { keys, getStreamStart, eligibility } from "../watch.js";
import { emitUser } from "../realtime.js";
import { notify } from "../notifications.js";

export const router = Router();

router.get("/streams", async (_req, res) => {
  const { rows } = await q(
    `SELECT s.id, s.title, s.game, s.platform, s.embed_id, s.status, s.scheduled_for, s.started_at,
            coalesce(s.thumbnail_url, CASE WHEN s.platform = 'youtube' AND s.embed_id IS NOT NULL THEN 'https://i.ytimg.com/vi/' || s.embed_id || '/mqdefault.jpg' END) AS thumbnail_url,
            st.id AS streamer_id, st.display_name AS streamer, st.country, st.followers, st.is_partner, st.color
     FROM streams s JOIN streamers st ON st.id = s.streamer_id
     WHERE s.status IN ('live','scheduled')
     ORDER BY (s.status='live') DESC, s.scheduled_for NULLS LAST`,
  );
  res.json(rows);
});

// Start (or replace) the single active watch session for this user.
router.post("/watch/sessions", requireAuth, async (req, res) => {
  const { streamId } = z.object({ streamId: z.string().uuid() }).parse(req.body);
  const startMs = await getStreamStart(streamId);
  if (!startMs) throw new HttpError(409, "This stream is not live", "not_live");
  const userId = req.user!.id;
  const sessionId = crypto.randomUUID();

  const previous = await redis.get(keys.active(userId));
  await redis.hset(keys.sess(sessionId), { userId, streamId, lastTs: "0", lastSeq: "-1" });
  await redis.expire(keys.sess(sessionId), 6 * 3600);
  await redis.set(keys.active(userId), sessionId, "PX", cfg.hbMs * 3);
  if (previous && previous !== sessionId) emitUser(userId, "kicked", { sessionId: previous });

  res.json({ sessionId, startedAt: startMs, minuteMs: cfg.minuteMs, hbMs: cfg.hbMs });
});

// The open drop for a stream, and whether this viewer qualifies. The code is never returned.
router.get("/drops/active", requireAuth, async (req, res) => {
  const { streamId } = z.object({ streamId: z.string().uuid() }).parse(req.query);
  const d = (
    await q(
      `SELECT id, closes_at, tier, parts_awarded, elapsed_minutes FROM drops WHERE stream_id=$1 AND closes_at > now() ORDER BY opens_at DESC LIMIT 1`,
      [streamId],
    )
  ).rows[0];
  if (!d) return res.json({ drop: null });
  const [elig, redeemed, premium] = await Promise.all([
    eligibility(streamId, req.user!.id, d.elapsed_minutes),
    q(`SELECT 1 FROM drop_redemptions WHERE drop_id=$1 AND user_id=$2`, [d.id, req.user!.id]),
    hasEntitlement(req.user!.id, "premium"),
  ]);
  const tierOk = d.tier === "free" || premium;
  res.json({
    drop: { id: d.id, closesAt: d.closes_at, tier: d.tier, partsAwarded: d.parts_awarded },
    eligible: elig.eligible && tierOk,
    coverage: elig.coverage,
    redeemed: redeemed.rowCount! > 0,
  });
});

router.post("/drops/:id/redeem", requireAuth, async (req, res) => {
  const dropId = z.string().uuid().parse(req.params.id);
  const { code } = z.object({ code: z.string().min(3).max(40) }).parse(req.body);
  const user = req.user!;

  const drop = (await q(`SELECT * FROM drops WHERE id=$1`, [dropId])).rows[0];
  if (!drop) throw new HttpError(404, "Unknown drop");
  if (new Date(drop.closes_at).getTime() < Date.now()) throw new HttpError(410, "This drop has closed", "closed");

  const done = await q(`SELECT 1 FROM drop_redemptions WHERE drop_id=$1 AND user_id=$2`, [dropId, user.id]);
  if (done.rowCount) throw new HttpError(409, "You already claimed this drop", "already_redeemed");

  const premium = await hasEntitlement(user.id, "premium");
  if (drop.tier === "premium" && !premium) throw new HttpError(402, "This drop is for premium members", "premium_required");

  const elig = await eligibility(drop.stream_id, user.id, drop.elapsed_minutes);
  if (!elig.eligible) {
    void audit("redeem_ineligible", { userId: user.id, dropId, coverage: elig.coverage, finalOk: elig.finalOk });
    throw new HttpError(403, `You did not watch enough of this stream (${Math.round(elig.coverage * 100)}% of ${drop.elapsed_minutes} minutes)`, "not_eligible");
  }

  const attKey = keys.attempts(dropId, user.id);
  const attempts = Number((await redis.get(attKey)) ?? 0);
  if (attempts >= cfg.maxRedeemAttempts) throw new HttpError(429, "Too many wrong codes for this drop", "too_many_attempts");

  if (!safeEqual(hashCode(code), drop.code_hash)) {
    await redis.incr(attKey);
    await redis.expire(attKey, cfg.dropWindowMin * 60 * 5);
    void audit("redeem_wrong_code", { userId: user.id, dropId });
    throw new HttpError(400, `That code is not right (${cfg.maxRedeemAttempts - attempts - 1} tries left)`, "wrong_code");
  }

  // Which character receives the parts: the one still being built at this drop's tier.
  const ch = (
    await q(
      `SELECT uc.id, uc.template_id, t.total_parts FROM user_characters uc JOIN character_templates t ON t.id=uc.template_id
       WHERE uc.user_id=$1 AND uc.status='building' AND t.tier=$2 LIMIT 1`,
      [user.id, drop.tier],
    )
  ).rows[0];
  if (!ch) throw new HttpError(409, "Start a character first", "no_character");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(`INSERT INTO drop_redemptions (drop_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [dropId, user.id]);
    if (!ins.rowCount) {
      await client.query("ROLLBACK");
      throw new HttpError(409, "You already claimed this drop", "already_redeemed");
    }
    const pick = await client.query(
      `SELECT id, position, slot, rarity FROM parts WHERE template_id=$1
       AND id NOT IN (SELECT part_id FROM user_parts WHERE user_character_id=$2) ORDER BY random() LIMIT $3`,
      [ch.template_id, ch.id, drop.parts_awarded],
    );
    const streamRow = (await client.query(`SELECT id, title FROM streams WHERE id=$1`, [drop.stream_id])).rows[0];
    for (const p of pick.rows) {
      await client.query(
        `INSERT INTO user_parts (user_character_id, part_id, drop_id, source_kind, source_id, source_title) VALUES ($1,$2,$3,'stream',$4,$5)`,
        [ch.id, p.id, dropId, streamRow?.id ?? null, streamRow?.title ?? "Live stream"],
      );
    }
    await redis.del(`feed:${user.id}`);
    await client.query(`UPDATE users SET credits = credits + $1 WHERE id=$2`, [cfg.creditsPerDrop, user.id]);
    const owned = (await client.query(`SELECT count(*)::int AS n FROM user_parts WHERE user_character_id=$1`, [ch.id])).rows[0].n as number;
    const complete = owned >= ch.total_parts;
    if (complete) await client.query(`UPDATE user_characters SET status='complete', completed_at=now() WHERE id=$1`, [ch.id]);
    await client.query("COMMIT");

    const payload = { characterId: ch.id, parts: pick.rows, owned, total: ch.total_parts, complete, source: { kind: "stream", title: streamRow?.title } };
    emitUser(user.id, "part:unlocked", payload);
    safe("notify-relic", notify(user.id, { type: "relic", title: `Relic unlocked: ${pick.rows.map((p) => p.slot).join(", ")}`, body: `For finishing "${streamRow?.title ?? "a live stream"}"`, data: { characterId: ch.id } }));
    if (complete) emitUser(user.id, "character:complete", { characterId: ch.id });
    res.json(payload);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
