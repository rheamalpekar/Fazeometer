import { useState } from "react";
import type { EventRow, StreamRow, Video } from "../api";
import { Button, Icon } from "./ui";

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
export const fmtViews = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
export const gameLabel = (g: string) => (g === "cod" ? "Call of Duty" : g === "fortnite" ? "Fortnite" : "Gaming");

/** The viewer's time zone, named once per section ("Eastern Standard Time"), so rows can show just the time. */
export function tzLabel(): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "your local time";
  }
}

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 0) return "Now";
  if (diff < 3600e3) return `in ${Math.max(1, Math.round(diff / 60e3))} min`;
  const sameDay = d.toDateString() === new Date().toDateString();
  const tomorrow = d.toDateString() === new Date(Date.now() + 86400e3).toDateString();
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

/** Splits a start time into a day and a clock time, so schedule rows line up in two aligned lines. */
export function whenParts(iso: string | null | undefined): { day: string; time: string; iso: string } {
  if (!iso) return { day: "", time: "", iso: "" };
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 0) return { day: "Starting now", time: "", iso };
  if (diff < 3600e3) return { day: "Soon", time: `in ${Math.max(1, Math.round(diff / 60e3))} min`, iso };
  if (d.toDateString() === new Date().toDateString()) return { day: "Today", time, iso };
  if (d.toDateString() === new Date(Date.now() + 86400e3).toDateString()) return { day: "Tomorrow", time, iso };
  return { day: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }), time, iso };
}

/** A flat sponsored offer. Only shown to people who do not hold the ad-free entitlement. */
export function SponsoredCard() {
  return (
    <aside className="sponsored" aria-label="Sponsored offer">
      <span className="sponsored-label">Sponsored</span>
      <p className="sponsored-text"><strong>FaZe Gear:</strong> 20% off the Odyssey drop hoodie.</p>
      <a className="textlink" href="#/premium">Go Premium to hide sponsored offers</a>
    </aside>
  );
}
export const AdBanner = SponsoredCard;

/** Stand-in artwork for small cards that have no thumbnail. */
export function Poster({ color, label }: { color: string; label: string }) {
  return (
    <div className="poster" style={{ ["--c" as string]: color }}>
      <span>{label.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

/** Branded fallback for the featured card when a stream has no artwork. */
export function ArtFallback({ streamer, game }: { streamer?: string; game?: string }) {
  return (
    <div className="art-fallback">
      <div className="mark">Odyssey<span>.</span></div>
      {(streamer || game) && <div className="sub">{[streamer, game && gameLabel(game)].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

export function VideoCard({ v, reason, onOpen }: { v: Video; reason?: string; onOpen: (id: string) => void }) {
  const pct = Math.round((v.coverage ?? 0) * 100);
  return (
    <button className="vcard" onClick={() => onOpen(v.id)}>
      <div className="thumb">
        {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" loading="lazy" decoding="async" width="320" height="180" /> : <Poster color="#1f6f8b" label={v.title} />}
        <span className="dur"><span className="sr-only">Duration </span>{fmtDur(v.duration_sec)}</span>
        {v.completed && <span className="done-badge"><Icon.check /> Done</span>}
        {!v.completed && pct > 2 && <div className="prog" aria-hidden><div style={{ width: `${Math.min(100, pct)}%` }} /></div>}
      </div>
      <div className="vmeta">
        <strong className="vtitle">{v.title}</strong>
        <span className="muted small">{v.channel_title} · {fmtViews(v.views)} views{!v.completed && pct > 2 ? ` · ${pct}% watched` : ""}</span>
        {reason && <span className="why">{reason}</span>}
      </div>
    </button>
  );
}

export function StreamCard({ s, onOpen }: { s: StreamRow; onOpen: (id: string) => void }) {
  const live = s.status === "live";
  return (
    <button className="vcard" onClick={() => live && onOpen(s.id)} aria-disabled={!live || undefined}>
      <div className="thumb">
        {s.thumbnail_url ? <img src={s.thumbnail_url} alt="" loading="lazy" decoding="async" width="320" height="180" /> : <Poster color={s.color} label={s.streamer} />}
        {live ? <span className="badge-live">Live</span> : <span className="badge-soon">{fmtWhen(s.scheduled_for)}</span>}
      </div>
      <div className="vmeta">
        <strong className="vtitle">{s.title}</strong>
        <span className="muted small">{s.streamer} · {gameLabel(s.game)}{s.is_partner ? " · Partner" : ""}</span>
      </div>
    </button>
  );
}

/** The wide card at the top of Home. One live badge, the title, who and what, and the single main action. */
export function FeaturedStream({ s, onWatch }: { s: StreamRow; onWatch: (id: string) => void }) {
  const [broken, setBroken] = useState(false);
  const titleId = `featured-${s.id}`;
  return (
    <article className="featured" aria-labelledby={titleId}>
      <div className="featured-art">
        {s.thumbnail_url && !broken ? (
          <img src={s.thumbnail_url} alt="" width="640" height="360" onError={() => setBroken(true)} />
        ) : (
          <ArtFallback />
        )}
        <span className="badge-live">Live</span>
      </div>
      <div className="featured-body">
        <h2 className="featured-title" id={titleId}>{s.title}</h2>
        <p className="meta">{s.streamer} · {gameLabel(s.game)}{s.is_partner ? " · Partner" : ""}</p>
        <div className="featured-actions">
          <Button onClick={() => onWatch(s.id)} aria-label={`Watch live: ${s.title}`}>Watch live</Button>
        </div>
      </div>
    </article>
  );
}

/** One aligned row for both "Coming up" and "Events": when, what, and an optional action. */
export function ScheduleRow({ when, title, meta, action, accent }: { when: { day: string; time: string; iso: string }; title: string; meta: string; action?: React.ReactNode; accent?: string }) {
  return (
    <li className="srow" style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      <div className="when">
        <strong>{when.day}</strong>
        {when.time && <time dateTime={when.iso}>{when.time}</time>}
      </div>
      <div>
        <div className="stitle">{title}</div>
        <div className="smeta">{meta}</div>
      </div>
      {action && <div className="srow-actions">{action}</div>}
    </li>
  );
}

export function EventRowItem({ e, onRsvp, busy }: { e: EventRow; onRsvp: (id: string) => void; busy?: boolean }) {
  return (
    <ScheduleRow
      accent={e.accent}
      when={whenParts(e.starts_at)}
      title={e.title}
      meta={`${e.location} · ${e.kind.replace("_", " ")}`}
      action={
        e.going ? (
          <Button variant="outline" className="confirmed" aria-pressed="true" aria-label={`Going to ${e.title}. Remove reminder`} loading={busy} onClick={() => onRsvp(e.id)}>
            <Icon.check /> Going
          </Button>
        ) : (
          <Button variant="outline" aria-pressed="false" aria-label={`Remind me about ${e.title}`} loading={busy} onClick={() => onRsvp(e.id)}>
            Remind me
          </Button>
        )
      }
    />
  );
}
