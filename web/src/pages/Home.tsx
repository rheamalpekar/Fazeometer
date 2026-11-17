import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getSocket, type EventRow, type Feed, type Video } from "../api";
import type { Ctx } from "../App";
import { ArtFallback, EventRowItem, FeaturedStream, ScheduleRow, SponsoredCard, StreamCard, VideoCard, gameLabel, tzLabel, whenParts } from "../components/cards";
import { Button, ProgressBar, Skeleton, VideoGridSkeleton } from "../components/ui";

const CHIPS: { key: string; label: string; param: string }[] = [
  { key: "all", label: "All", param: "" },
  { key: "cod", label: "Call of Duty", param: "game=cod" },
  { key: "fortnite", label: "Fortnite", param: "game=fortnite" },
  { key: "highlights", label: "Highlights", param: "topic=highlights" },
  { key: "tournaments", label: "Tournaments", param: "topic=tournaments" },
  { key: "tutorials", label: "Tutorials", param: "topic=tutorials" },
  { key: "funny", label: "Funny", param: "topic=funny" },
  { key: "challenges", label: "Challenges", param: "topic=challenges" },
];
const INTEREST_CHIPS = ["cod", "fortnite", "highlights", "tournaments", "tutorials", "funny", "vlogs", "challenges"];
const interestLabel = (k: string) => (k === "cod" ? "Call of Duty" : k === "fortnite" ? "Fortnite" : k[0].toUpperCase() + k.slice(1));

function Section({ id, title, sub, hint, children }: { id: string; title: string; sub?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="row-sec" aria-labelledby={id}>
      <div className="between">
        <div className="heading-block">
          <h2 id={id}>{title}</h2>
          {sub && <p className="section-sub">{sub}</p>}
        </div>
        {hint}
      </div>
      {children}
    </section>
  );
}

export function Home({ ctx }: { ctx: Ctx }) {
  const { me } = ctx;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [chip, setChip] = useState("all");
  const [browse, setBrowse] = useState<Video[]>([]);
  const search = ctx.query.get("q") ?? "";
  const clearSearch = () => { location.hash = "#/"; };
  const [results, setResults] = useState<Video[] | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const tz = useMemo(() => tzLabel(), []);

  const load = useCallback(
    () => api<Feed>("GET", "/feed").then((f) => { setFeed(f); setFeedError(null); }).catch((e) => setFeedError(e?.message ?? "Something went wrong")),
    [],
  );
  useEffect(() => { void load(); }, [load, ctx.streamTick, me.characters.reduce((n, c) => n + c.owned, 0)]);

  // Gemini refines the feed in the background. When it finishes, the server tells us to reload.
  useEffect(() => {
    const s = getSocket();
    const on = () => void load();
    s.on("feed:updated", on);
    return () => { s.off("feed:updated", on); };
  }, [load]);

  // Search, with a short delay so we do not fire a request on every keystroke. Press "/" to jump to the box.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(() => { api<Video[]>("GET", `/videos?limit=24&search=${encodeURIComponent(term)}`).then(setResults).catch(() => setResults([])); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const param = CHIPS.find((c) => c.key === chip)?.param ?? "";
    api<Video[]>("GET", `/videos?limit=24&${param}`).then(setBrowse).catch(() => setBrowse([]));
  }, [chip]);

  const rsvp = async (id: string) => {
    const title = feed?.events.find((e) => e.id === id)?.title ?? "the event";
    setBusyEvent(id);
    try {
      const r = await api<{ going: boolean }>("POST", `/events/${id}/rsvp`);
      setFeed((f) => f && { ...f, events: f.events.map((e: EventRow) => (e.id === id ? { ...e, going: r.going, rsvps: e.rsvps + (r.going ? 1 : -1) } : e)) });
      ctx.toast(r.going ? `Reminder set for ${title}. We will remind you before it starts.` : `Reminder removed for ${title}.`); // also read out by the live region
    } catch (e: any) {
      ctx.toast(`Could not update the reminder: ${e.message}`);
    } finally {
      setBusyEvent(null);
    }
  };
  const setInterests = async (list: string[]) => {
    const r = await api<{ interests: string[] }>("PUT", "/me/interests", { interests: list });
    setFeed((f) => f && { ...f, interests: r.interests });
    await load();
  };
  const scrollToBrowse = () => document.getElementById("browse-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const pickCategory = (key: string) => { if (search) clearSearch(); setChip(key); window.setTimeout(scrollToBrowse, 0); };

  const active = me.characters.find((c) => c.status === "building") ?? me.characters[0];
  const pct = active ? Math.round((active.owned / active.total_parts) * 100) : 0;
  const featured = feed?.live[0];
  const otherLive = feed?.live.slice(1) ?? [];
  const next = feed?.upcoming[0];

  return (
    <div className="home-grid">
      <h1 className="sr-only">Home</h1>

      <nav className="side" aria-label="Categories">
        <h2 className="side-h">Browse</h2>
        <ul>
          {CHIPS.map((c) => (
            <li key={c.key}>
              <button className="side-item" aria-pressed={chip === c.key} onClick={() => pickCategory(c.key)}>{c.label}</button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="home-top" hidden={search.trim().length >= 2}>
      {/* Hero: the featured stream with the voyage band under it */}
      <div className="hero">
        {feed ? (
          featured ? (
            <FeaturedStream s={featured} onWatch={ctx.watchStream} />
          ) : (
            <article className="featured" aria-labelledby="nolive-h">
              <div className="featured-art"><ArtFallback /></div>
              <div className="featured-body">
                <h2 className="featured-title" id="nolive-h">No one is live right now</h2>
                <p className="meta">
                  {next ? `Next up: ${next.streamer}, ${next.title}. ${(() => { const w = whenParts(next.scheduled_for); return `${w.day}${w.time ? ` at ${w.time}` : ""}.`; })()}` : "New streams appear here the moment a creator goes live."}
                </p>
                <div className="featured-actions"><Button onClick={scrollToBrowse}>Browse videos</Button></div>
              </div>
            </article>
          )
        ) : feedError ? (
          <div className="state-box" role="alert">
            <h2>We could not load your feed</h2>
            <p className="muted">{feedError}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading featured stream"><Skeleton h={340} r={14} /></div>
        )}

        <section className="voyage" aria-labelledby="voyage-h">
          <h2 id="voyage-h">Your voyage</h2>
          {active ? (
            <>
              <div className="voyage-name">{active.name}</div>
              <ProgressBar value={active.owned} max={active.total_parts} label={`${active.name} relic progress`} valueText={`${active.owned} of ${active.total_parts} relics`} />
              <div className="progress-label"><span>{active.owned} of {active.total_parts} relics</span><span>{pct}%</span></div>
              <a className="textlink" href="#/profile">View voyage</a>
            </>
          ) : (
            <>
              <p className="muted">Launch your ship to start collecting relics from videos and live streams.</p>
              <a className="btn" href="#/profile">Launch your ship</a>
            </>
          )}
        </section>
      </div>

      {me.showAds && <SponsoredCard />}
      </div>

      {feed && (
        <aside className="rail" aria-label="Schedule">
          <Section id="up-h" title="Coming up" sub={`Times shown in ${tz}`}>
            {feed.upcoming.length > 0 ? (
              <ul className="sched">
                {feed.upcoming.slice(0, 5).map((s) => (
                  <ScheduleRow key={s.id} when={whenParts(s.scheduled_for)} title={s.title} meta={`${s.streamer} · ${gameLabel(s.game)}`} />
                ))}
              </ul>
            ) : (
              <p className="muted">No streams scheduled yet.</p>
            )}
          </Section>
          <Section id="ev-h" title="Events" sub={`Times shown in ${tz}`}>
            {feed.events.length > 0 ? (
              <ul className="sched">
                {feed.events.slice(0, 5).map((e) => <EventRowItem key={e.id} e={e} onRsvp={rsvp} busy={busyEvent === e.id} />)}
              </ul>
            ) : (
              <p className="muted">No events yet.</p>
            )}
          </Section>
        </aside>
      )}

      <div className="home-rest">
      {otherLive.length > 0 && (
        <Section id="alsolive-h" title="Also live">
          <div className="hrow">{otherLive.map((s) => <StreamCard key={s.id} s={s} onOpen={ctx.watchStream} />)}</div>
        </Section>
      )}

      {feed && feed.continueWatching.length > 0 && (
        <Section id="cont-h" title="Continue watching">
          <div className="hrow">{feed.continueWatching.map((v) => <VideoCard key={v.id} v={v} onOpen={ctx.watchVideo} />)}</div>
        </Section>
      )}

      {results && (
        <Section id="results-h" title={`Results for "${search.trim()}"`} hint={<button className="link" onClick={clearSearch}>Clear search</button>}>
          <div className="vgrid">{results.map((v) => <VideoCard key={v.id} v={v} onOpen={ctx.watchVideo} />)}</div>
          {results.length === 0 && <p className="muted">No videos match that search.</p>}
        </Section>
      )}

      {!feed && !feedError && <VideoGridSkeleton n={8} />}

      {feed && feed.interests.length === 0 && (
        <section className="state-box" aria-labelledby="tune-h">
          <h2 id="tune-h">Tune your feed</h2>
          <p className="muted">Pick what you like and we will recommend more of it.</p>
          <div className="chips" role="group" aria-label="Interests">
            {INTEREST_CHIPS.map((i) => <button key={i} className="chip-btn" aria-pressed="false" onClick={() => setInterests([...feed.interests, i])}>{interestLabel(i)}</button>)}
          </div>
        </section>
      )}

      {feed && feed.forYou.length > 0 && (
        <Section
          id="foryou-h"
          title="For you"
          hint={<span className="tag" title={feed.source === "gemini" ? "Ranked by Gemini from your interests and what you watched" : "Ranked by rules from your interests and what you watched"}>{feed.source === "gemini" ? "Picked by Gemini" : "Picked by rules"}</span>}
        >
          <div className="vgrid">{feed.forYou.map((r) => <VideoCard key={r.video.id} v={r.video} reason={r.reason} onOpen={ctx.watchVideo} />)}</div>
        </Section>
      )}

      <Section id="browse-h" title="Browse videos">
        <div className="chips" role="group" aria-label="Filter videos">
          {CHIPS.map((c) => <button key={c.key} className={chip === c.key ? "chip-btn on" : "chip-btn"} aria-pressed={chip === c.key} onClick={() => setChip(c.key)}>{c.label}</button>)}
        </div>
        <div className="vgrid">{browse.map((v) => <VideoCard key={v.id} v={v} onOpen={ctx.watchVideo} />)}</div>
        {browse.length === 0 && <p className="muted">{ctx.cfg.youtube ? "No videos match that filter." : "No videos yet. Add a YOUTUBE_API_KEY to load the catalog."}</p>}
      </Section>

      {me.subscription && <Tenure ctx={ctx} />}
      </div>
    </div>
  );
}

function Tenure({ ctx }: { ctx: Ctx }) {
  const { tenure } = ctx.me;
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    try {
      const r = await api<{ code: string }>("POST", "/me/ticket/claim");
      ctx.toast(`Ticket voucher: ${r.code}`);
      await ctx.refresh();
    } catch (e: any) { ctx.toast(e.message); } finally { setBusy(false); }
  };
  const ff = async () => { await api("POST", "/demo/advance-subscription", { months: 12 }); await ctx.refresh(); };
  return (
    <Section id="ticket-h" title="Free regional ticket">
      <div className="voyage">
        <ProgressBar value={tenure.months} max={tenure.targetMonths} label="Paid months toward a free regional ticket" valueText={`${tenure.months} of ${tenure.targetMonths} paid months`} />
        <div className="progress-label"><span>{tenure.months} of {tenure.targetMonths} paid months</span></div>
        <div className="row wrap">
          {tenure.ticketCode ? <span>Voucher: <code>{tenure.ticketCode}</code></span> : <Button loading={busy} disabled={!tenure.ticketReady} onClick={claim}>Claim ticket</Button>}
          {ctx.cfg.demoMode && <Button variant="outline" onClick={ff}>Demo: add 12 months</Button>}
        </div>
      </div>
    </Section>
  );
}
