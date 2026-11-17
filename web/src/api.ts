import { io, type Socket } from "socket.io-client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, data?.error ?? "Request failed", data?.code);
  return data as T;
}

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ withCredentials: true, transports: ["websocket"] });
  return socket;
}
export function closeSocket() {
  socket?.close();
  socket = null;
}

// ---- shared types ----
export interface Me {
  user: { id: string; email: string; display_name: string; country: string; role: string; streamer_id: string | null; game_pref: string | null; credits: number };
  premium: boolean;
  showAds: boolean;
  streak: number;
  adult: boolean;
  characters: { id: string; status: string; template_id: string; name: string; game: string; kind?: string; slot_number: number; tier: string; color: string; total_parts: number; owned: number }[];
  subscription: { status: string; active: boolean; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; monthsPaid: number } | null;
  tenure: { months: number; targetMonths: number; ticketReady: boolean; ticketCode: string | null };
}
export interface AppConfig { minuteMs: number; hbMs: number; videoHbMs: number; videoMinCoverage: number; videoPartsPerDay: number; priceCents: number; tenureMonths: number; demoMode: boolean; stripe: boolean; gemini: boolean; livekit: boolean; youtube: boolean }
export interface StreamRow {
  id: string; title: string; game: string; platform: string; embed_id: string | null; status: string;
  thumbnail_url?: string | null; scheduled_for?: string | null; started_at?: string | null; description?: string;
  streamer_id: string; streamer: string; country: string; followers: number; is_partner: boolean; color: string;
}
export interface Template { id: string; game: string; slot_number: number; tier: string; name: string; theme: string; color: string; parts: { id: string; position: number; slot: string; rarity: string; lore: string }[] }
export interface CharacterView { id: string; name: string; game: string; kind?: string; tier: string; color: string; total_parts: number; owned: number; status: string; parts: { id: string; position: number; slot: string; rarity: string; owned: boolean }[] }

export interface Video {
  id: string; youtube_id: string; title: string; description?: string; thumbnail_url: string; duration_sec: number; views: number;
  channel_title: string; game: string; topics: string[]; published_at: string | null; streamer: string | null;
  coverage: number | null; last_position: number | null; completed: boolean | null;
}
export interface EventRow { id: string; title: string; kind: string; game: string; starts_at: string; location: string; description: string; accent: string; rsvps: number; going: boolean }
export interface Feed {
  live: StreamRow[]; upcoming: StreamRow[]; events: EventRow[]; forYou: { video: Video; reason: string }[];
  continueWatching: Video[]; latest: Video[]; source: "gemini" | "sql"; interests: string[];
}
export interface ProfileData {
  user: { display_name: string; country: string; created_at: string; interests: string[]; game_pref: string | null; credits: number };
  stats: { videosCompleted: number; streamsCompleted: number; relics: number; hoursWatched: number; streak: number; credits: number; charactersCompleted: number };
  characters: ProfileCharacter[];
  achievements: { at: string; relic: string; rarity: string; position: number; kind: string | null; title: string | null; character: string }[];
  history: Video[];
  streams: { id: string; title: string; game: string; minutes_watched: number; coverage: number }[];
}
export interface ProfilePart { id: string; position: number; slot: string; rarity: string; owned: boolean; unlocked_at: string | null; source_kind: string | null; source_title: string | null }
export interface ProfileCharacter { id: string; name: string; game: string; kind?: string; tier: string; color: string; total_parts: number; owned: number; status: string; template_id: string; slot_number: number; parts: ProfilePart[] }
