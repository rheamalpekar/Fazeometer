import { cfg } from "./config.js";
import { q } from "./db.js";

export interface YtVideo {
  youtubeId: string;
  title: string;
  description: string;
  thumbnail: string;
  durationSec: number;
  views: number;
  channelTitle: string;
  tags: string[];
  publishedAt: string;
  embeddable: boolean;
}

const API = "https://www.googleapis.com/youtube/v3";

// The key goes in a header, never in a URL, so it cannot end up in logs or error messages.
async function yt(path: string, params: Record<string, string>) {
  if (!cfg.youtubeKey) throw new Error("YOUTUBE_API_KEY is not set");
  const r = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { "x-goog-api-key": cfg.youtubeKey } });
  if (!r.ok) throw new Error(`YouTube API ${path} failed with HTTP ${r.status}`);
  return (await r.json()) as any;
}

export const parseDuration = (iso: string) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
};

/** Accepts a full YouTube URL (watch, youtu.be, embed, shorts, live) or a bare 11-character id. */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export async function fetchVideos(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics,status", id: ids.slice(i, i + 50).join(",") });
    for (const it of data.items ?? []) {
      const sn = it.snippet ?? {};
      const th = sn.thumbnails ?? {};
      out.push({
        youtubeId: it.id,
        title: sn.title ?? "Untitled",
        description: (sn.description ?? "").slice(0, 1200),
        thumbnail: th.maxres?.url ?? th.high?.url ?? th.medium?.url ?? `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`,
        durationSec: parseDuration(it.contentDetails?.duration),
        views: Number(it.statistics?.viewCount ?? 0),
        channelTitle: sn.channelTitle ?? "",
        tags: sn.tags ?? [],
        publishedAt: sn.publishedAt ?? new Date().toISOString(),
        embeddable: it.status?.embeddable !== false,
      });
    }
  }
  return out;
}

export async function searchVideoIds(query: string, max = 12): Promise<string[]> {
  const data = await yt("search", {
    part: "snippet", type: "video", maxResults: String(max), q: query,
    videoEmbeddable: "true", videoDuration: "medium", safeSearch: "moderate", relevanceLanguage: "en", order: "relevance",
  });
  return (data.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
}

const GAME_RES: [string, RegExp][] = [
  ["cod", /call of duty|warzone|\bcod\b|black ops|modern warfare|\bmw[23]\b|\bcdl\b/i],
  ["fortnite", /fortnite|zero build|\bfncs\b|battle royale/i],
];
const TOPIC_RES: [string, RegExp][] = [
  ["highlights", /highlight|clip|best of|montage|\bplays\b|insane/i],
  ["tournaments", /tournament|final|scrim|champion|\bcup\b|\bcdl\b|\bfncs\b|major|bracket/i],
  ["tutorials", /tutorial|guide|how to|tips|tricks|learn|settings|\bpro\b/i],
  ["funny", /funny|fail|moments|bloopers|meme|rage|hilarious/i],
  ["vlogs", /vlog|day in|behind the|house|\birl\b|story/i],
  ["challenges", /challenge|\b1v1\b|\bvs\b|\bbet\b|speedrun|only/i],
];

export function classify(title: string, tags: string[], description = "") {
  const text = `${title} ${tags.join(" ")} ${description.slice(0, 300)}`;
  const game = GAME_RES.find(([, re]) => re.test(text))?.[0] ?? "other";
  const topics = TOPIC_RES.filter(([, re]) => re.test(text)).map(([t]) => t);
  return { game, topics };
}

export async function insertVideo(v: YtVideo, streamerId: string | null, gameOverride?: string) {
  const c = classify(v.title, v.tags, v.description);
  const r = await q(
    `INSERT INTO videos (youtube_id, streamer_id, title, description, thumbnail_url, duration_sec, views, channel_title, game, topics, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (youtube_id) DO UPDATE SET views = EXCLUDED.views RETURNING *`,
    [v.youtubeId, streamerId, v.title, v.description, v.thumbnail, v.durationSec, v.views, v.channelTitle, gameOverride ?? c.game, c.topics, v.publishedAt],
  );
  return r.rows[0];
}

const SYNC_QUERIES = [
  "FaZe Clan Call of Duty highlights",
  "FaZe Clan Fortnite highlights",
  "FaZe Clan tournament finals",
  "FaZe Clan funny moments",
  "FaZe Clan challenge",
  "FaZe Clan tips and tricks",
];

/** Pulls real FaZe videos (title, thumbnail, length, views) from YouTube into the catalog. */
export async function syncYoutube(): Promise<{ added: number; skipped: number }> {
  const official = (await q(`SELECT id FROM streamers WHERE display_name='FaZe Clan' LIMIT 1`)).rows[0]?.id ?? null;
  const ids = new Set<string>();
  for (const query of SYNC_QUERIES) {
    try {
      for (const id of await searchVideoIds(query, 10)) ids.add(id);
    } catch (err) {
      console.warn(`[youtube] search skipped: ${(err as Error).message}`);
    }
  }
  const vids = await fetchVideos([...ids]);
  let added = 0;
  let skipped = 0;
  for (const v of vids) {
    if (!v.embeddable || v.durationSec < cfg.videoMinSec || v.durationSec > cfg.videoMaxSec) { skipped++; continue; }
    await insertVideo(v, official);
    added++;
  }
  console.log(`[youtube] synced ${added} videos (${skipped} skipped)`);
  return { added, skipped };
}
