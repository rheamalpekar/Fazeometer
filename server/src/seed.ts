import { q, mdb, redis } from "./db.js";
import { TEMPLATES, STREAMERS, rarityOf } from "./catalogData.js";

export { SHIP_SLOTS, HERO_SLOTS } from "./catalogData.js";

async function seedTemplates() {
  const { rows } = await q("SELECT count(*)::int AS n FROM character_templates");
  if (rows[0].n > 0) return;
  const partIds: { id: string; position: number; slot: string; template: string }[] = [];
  for (const t of TEMPLATES) {
    const r = await q(
      `INSERT INTO character_templates (game, slot_number, tier, kind, name, theme, color) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [t.game, t.slot, t.tier, t.kind, t.name, t.theme, t.color],
    );
    const tid = r.rows[0].id as string;
    for (let i = 0; i < t.parts.length; i++) {
      const pos = i + 1;
      const p = await q(
        `INSERT INTO parts (template_id, position, slot, rarity, glb_key) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tid, pos, t.parts[i], rarityOf(pos), `parts/${t.kind}/${pos}.glb`],
      );
      partIds.push({ id: p.rows[0].id, position: pos, slot: t.parts[i], template: t.name });
    }
  }
  // MongoDB holds the flexible part metadata. Lore text is placeholder copy.
  await mdb.collection("part_meta").insertMany(
    partIds.map((p) => ({
      partId: p.id,
      lore: `${p.slot} of the ${p.template}, carried home across the wine-dark sea.`,
      model: { format: "procedural", note: "Swap for a .glb at glb_key when real art exists." },
    })),
  );
  console.log("[seed] inserted the ship and Agamemnon, 60 relics");
}

/**
 * Streamer channels exist everywhere. A login account for each exists ONLY in demo mode, so a production
 * database never contains accounts anyone can guess. Real streamers are promoted with `npm run make-streamer`.
 */
async function seedStreamers(demoMode: boolean) {
  const have = (await q(`SELECT count(*)::int AS n FROM streamers WHERE display_name = 'NovaStrike'`)).rows[0].n as number;
  if (have === 0) {
    for (const s of STREAMERS) {
      const sr = await q(
        `INSERT INTO streamers (display_name, platform, channel_id, country, followers, is_partner, game, color)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [s.name, s.platform, s.channel, s.country, s.followers, s.partner, s.game, s.color],
      );
      await mdb.collection("streamer_profiles").insertOne({ streamerId: sr.rows[0].id, bio: s.bio, tags: s.tags });
      await q(
        `INSERT INTO streams (streamer_id, title, game, platform, embed_id, status, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,'scheduled', now() + interval '1 day')`,
        [sr.rows[0].id, `${s.name}: Odyssey night`, s.game, "demo", null],
      );
      if (s.partner) {
        for (const h of [24, 26]) {
          await q(`INSERT INTO call_slots (streamer_id, starts_at) VALUES ($1, now() + ($2 || ' hours')::interval)`, [sr.rows[0].id, String(h)]);
        }
      }
    }
    console.log("[seed] inserted 4 streamer channels");
  }
  if (demoMode) {
    for (const s of STREAMERS) {
      await q(
        `INSERT INTO users (email, display_name, country, birthdate, role, streamer_id)
         SELECT $1,$2,$3,'1999-01-01','streamer', st.id FROM streamers st WHERE st.display_name=$2
         ON CONFLICT (email) DO NOTHING`,
        [s.email, s.name, s.country],
      );
    }
  }
}

export async function seed(demoMode: boolean) {
  await seedTemplates();
  await seedStreamers(demoMode);
}

// ---- extras: run on every start, each step only fills what is missing ----
const STREAM_IDEAS = ["Ranked grind", "Subscriber lobbies", "Tournament practice", "Q&A and viewer games", "Odyssey night", "Zero build sweat"];

export async function seedExtras(demoMode: boolean) {
  // FaZe Clan's official account owns the catalog videos pulled from YouTube.
  await q(
    `INSERT INTO streamers (display_name, platform, channel_id, country, followers, is_partner, game, color)
     SELECT 'FaZe Clan','youtube','fazeclan','US',5000000,true,'cod','#c4313f'
     WHERE NOT EXISTS (SELECT 1 FROM streamers WHERE display_name='FaZe Clan')`,
  );

  // More future streams so the schedule has a week of content.
  const upcoming = (await q(`SELECT count(*)::int AS n FROM streams WHERE status='scheduled' AND scheduled_for > now()`)).rows[0].n as number;
  if (upcoming < 8) {
    const streamers = (await q(`SELECT id, display_name, game FROM streamers WHERE display_name <> 'FaZe Clan'`)).rows;
    for (let i = 0; i < 6; i++) {
      const s = streamers[i % streamers.length];
      await q(
        `INSERT INTO streams (streamer_id, title, game, platform, status, scheduled_for)
         VALUES ($1,$2,$3,'demo','scheduled', now() + ($4 || ' hours')::interval)`,
        [s.id, `${s.display_name}: ${STREAM_IDEAS[i % STREAM_IDEAS.length]}`, s.game, String(6 + i * 14)],
      );
    }
  }

  const events = (await q(`SELECT count(*)::int AS n FROM events`)).rows[0].n as number;
  if (events === 0) {
    const rows: [string, string, string, number, string, string, string][] = [
      ["Season Watch Party with NovaStrike", "watch_party", "cod", 30, "Online", "Watch the season finale together with live chat and relic drops for everyone who stays to the end.", "#c4313f"],
      ["Odyssey Cup: COD 2v2 Showdown", "tournament", "cod", 52, "Online", "Duo bracket for FaZe Odyssey members. Top teams win a live call slot.", "#d9a441"],
      ["Relic Drop Night", "drop", "other", 76, "Online", "Every partner streamer drops a secret word. Double relics for premium members.", "#1f6f8b"],
      ["Fortnite Zero Build Finals", "tournament", "fortnite", 100, "Online", "The community finals, streamed live with caster commentary.", "#7b4dff"],
      ["Community Scrims", "tournament", "fortnite", 148, "Online", "Open scrims, all skill levels. Practice for the finals.", "#00b3a4"],
      ["Creator Meetup: Los Angeles", "meetup", "other", 240, "Los Angeles, CA", "Meet FaZe creators and fellow voyagers in person.", "#d9a441"],
    ];
    for (const r of rows) {
      await q(`INSERT INTO events (title, kind, game, starts_at, location, description, accent) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval, $5,$6,$7)`, [r[0], r[1], r[2], String(r[3]), r[4], r[5], r[6]]);
    }
  }

  // In demo mode keep one live stream running so the "Live now" row is never empty.
  if (demoMode) {
    const live = (await q(`SELECT count(*)::int AS n FROM streams WHERE status='live'`)).rows[0].n as number;
    if (live === 0) {
      const nova = (await q(`SELECT id FROM streamers WHERE display_name='NovaStrike' LIMIT 1`)).rows[0];
      if (nova) {
        const s = (
          await q(
            `INSERT INTO streams (streamer_id, title, game, platform, status, started_at, keepalive)
             VALUES ($1,'Odyssey Night: live demo','cod','demo','live', now(), true) RETURNING id, started_at`,
            [nova.id],
          )
        ).rows[0];
        await redis.set(`live:${s.id}`, String(new Date(s.started_at).getTime()));
      }
    }
  }
}
