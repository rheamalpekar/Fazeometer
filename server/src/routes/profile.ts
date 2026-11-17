import { Router } from "express";
import { q } from "../db.js";
import { requireAuth } from "../auth.js";
import { computeStreak } from "./auth.js";
import { VIDEO_SELECT, VIDEO_FROM } from "./videos.js";
import { cfg } from "../config.js";

export const router = Router();

// One call for the whole profile page: stats, every character with where each relic came from, history.
router.get("/profile", requireAuth, async (req, res) => {
  const u = req.user!;
  const [user, vStats, sStats, relicCount, chars, parts, history, streams, streak] = await Promise.all([
    q(`SELECT display_name, country, created_at, interests, game_pref, credits FROM users WHERE id=$1`, [u.id]),
    q(`SELECT count(*) FILTER (WHERE completed)::int AS completed, coalesce(sum(seconds_watched),0)::int AS seconds FROM video_progress WHERE user_id=$1`, [u.id]),
    q(`SELECT count(*) FILTER (WHERE coverage >= $2)::int AS completed, coalesce(sum(minutes_watched),0)::int AS minutes FROM watch_sessions WHERE user_id=$1`, [u.id, cfg.minCoverage]),
    q(`SELECT count(*)::int AS n FROM user_parts up JOIN user_characters uc ON uc.id=up.user_character_id WHERE uc.user_id=$1`, [u.id]),
    q(
      `SELECT uc.id, uc.status, uc.completed_at, t.id AS template_id, t.name, t.game, t.kind, t.slot_number, t.tier, t.color, t.total_parts,
              (SELECT count(*)::int FROM user_parts up WHERE up.user_character_id = uc.id) AS owned
       FROM user_characters uc JOIN character_templates t ON t.id = uc.template_id WHERE uc.user_id=$1 ORDER BY t.slot_number`,
      [u.id],
    ),
    q(
      `SELECT up.user_character_id, p.id, p.position, p.slot, p.rarity, up.unlocked_at, up.source_kind, up.source_id, up.source_title
       FROM user_parts up JOIN parts p ON p.id = up.part_id JOIN user_characters uc ON uc.id = up.user_character_id
       WHERE uc.user_id=$1 ORDER BY up.unlocked_at DESC`,
      [u.id],
    ),
    q(`SELECT ${VIDEO_SELECT} ${VIDEO_FROM} WHERE vp.user_id IS NOT NULL ORDER BY vp.updated_at DESC LIMIT 12`, [u.id]),
    q(
      `SELECT s.id, s.title, s.game, w.minutes_watched, w.coverage FROM watch_sessions w JOIN streams s ON s.id = w.stream_id
       WHERE w.user_id=$1 ORDER BY s.ended_at DESC NULLS LAST LIMIT 12`,
      [u.id],
    ),
    computeStreak(u.id),
  ]);

  // Every character with the full 30-slot picture, so the profile can draw owned and locked relics.
  const charIds = chars.rows.map((c) => c.id);
  const templateParts = chars.rows.length
    ? (await q(`SELECT id, template_id, position, slot, rarity FROM parts WHERE template_id = ANY($1) ORDER BY position`, [chars.rows.map((c) => c.template_id)])).rows
    : [];
  const owned = new Map(parts.rows.map((p) => [`${p.user_character_id}:${p.id}`, p]));
  const characters = chars.rows.map((c) => ({
    ...c,
    parts: templateParts
      .filter((p) => p.template_id === c.template_id)
      .map((p) => {
        const o = owned.get(`${c.id}:${p.id}`);
        return { id: p.id, position: p.position, slot: p.slot, rarity: p.rarity, owned: Boolean(o), unlocked_at: o?.unlocked_at ?? null, source_kind: o?.source_kind ?? null, source_title: o?.source_title ?? null };
      }),
  }));

  const charName = new Map(chars.rows.map((c) => [c.id, c.name]));
  const achievements = parts.rows.slice(0, 60).map((p) => ({
    at: p.unlocked_at, relic: p.slot, rarity: p.rarity, position: p.position, kind: p.source_kind, title: p.source_title, character: charName.get(p.user_character_id),
  }));

  res.json({
    user: user.rows[0],
    stats: {
      videosCompleted: vStats.rows[0].completed,
      streamsCompleted: sStats.rows[0].completed,
      relics: relicCount.rows[0].n,
      hoursWatched: Math.round(((vStats.rows[0].seconds + sStats.rows[0].minutes * 60) / 3600) * 10) / 10,
      streak,
      credits: user.rows[0].credits,
      charactersCompleted: chars.rows.filter((c) => c.status === "complete").length,
    },
    characters,
    achievements,
    history: history.rows,
    streams: streams.rows,
  });
  void charIds;
});
