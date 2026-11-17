import { useEffect, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../App";

interface SRow { id: string; title: string; game: string; platform: string; status: string }
interface Slot { id: string; starts_at: string; duration_min: number; status: string; booked_by_name: string | null }
interface Data { streamer: { display_name: string; followers: number; is_partner: boolean }; streams: SRow[]; slots: Slot[] }
interface Analytics { series: { t: string; viewers: number }[]; peak: number; uniqueViewers: number; relicsClaimed: number }
interface PostedVideo { id: string; title: string; thumbnail_url: string; duration_sec: number; completions: number; viewers: number }
interface Dropped { code: string; closesAt: string; eligibleCount: number; partsAwarded: number }

export function Streamer({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ title: "", game: "cod", platform: "demo", embedId: "", thumbnailUrl: "" });
  const [dropped, setDropped] = useState<Record<string, Dropped>>({});
  const [tier, setTier] = useState<"free" | "premium">("free");
  const [slotAt, setSlotAt] = useState("");
  const [openStats, setOpenStats] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, Analytics>>({});
  const [videos, setVideos] = useState<PostedVideo[]>([]);
  const [ytUrl, setYtUrl] = useState("");
  const [vGame, setVGame] = useState("other");
  const [ev, setEv] = useState({ title: "", kind: "watch_party", game: "other", startsAt: "", location: "Online", description: "" });

  const load = () => api<Data>("GET", "/streamer/me").then(setData);
  const loadVideos = () => api<PostedVideo[]>("GET", "/streamer/videos").then(setVideos).catch(() => {});
  useEffect(() => { void load(); void loadVideos(); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e: any) { ctx.toast(e.message); }
  };

  // While a stream is live the Studio pings the server. If the tab closes, the pings stop and the stream ends on its own.
  const liveIds = (data?.streams ?? []).filter((x) => x.status === "live").map((x) => x.id).join(",");
  useEffect(() => {
    if (!liveIds) return;
    const ping = () => liveIds.split(",").forEach((id) => api("POST", `/streamer/streams/${id}/ping`).catch(() => {}));
    ping();
    const t = setInterval(ping, 30000);
    return () => clearInterval(t);
  }, [liveIds]);

  const toggleStats = async (id: string) => {
    if (openStats === id) { setOpenStats(null); return; }
    setOpenStats(id);
    try { const r = await api<Analytics>("GET", `/streamer/streams/${id}/analytics`); setStats((m) => ({ ...m, [id]: r })); } catch (e: any) { ctx.toast(e.message); }
  };

  if (!data) return <div className="panel">Loading…</div>;
  return (
    <div className="stack">
      <h2>Studio · {data.streamer.display_name}</h2>
      <p className="muted small">{data.streamer.followers.toLocaleString()} followers · {data.streamer.is_partner ? "Partner (can offer calls)" : "Not a partner yet (needs 30,000+)"}</p>

      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void run(() => api("POST", "/streamer/streams", { ...form, embedId: form.embedId || undefined, thumbnailUrl: form.thumbnailUrl || undefined })); }}>
        <h3>New stream</h3>
        <div className="row wrap">
          <input className="grow" required minLength={3} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select value={form.game} onChange={(e) => setForm({ ...form, game: e.target.value })}><option value="cod">COD</option><option value="fortnite">Fortnite</option></select>
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}><option value="demo">Demo (simulated)</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option></select>
          {form.platform !== "demo" && <input placeholder={form.platform === "twitch" ? "Channel name" : "Video or live ID"} value={form.embedId} onChange={(e) => setForm({ ...form, embedId: e.target.value })} />}
          <label className="grow">
            <span className="sr-only">Cover art link</span>
            <input type="url" placeholder="Cover art link (https, optional)" value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} />
          </label>
          <button className="btn">Create</button>
        </div>
      </form>


      <div className="duo">
        <form className="panel stack tight" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/streamer/videos", { url: ytUrl, game: vGame === "other" ? undefined : vGame }); setYtUrl(""); await loadVideos(); ctx.toast("Video posted. Viewers can now earn relics from it."); }); }}>
          <h3>Post a video</h3>
          <p className="muted small">Paste a YouTube link. Title, thumbnail and length are fetched from YouTube. Videos from 30 seconds to 30 minutes can be completed by viewers.</p>
          <div className="row wrap">
            <input className="grow" required placeholder="https://www.youtube.com/watch?v=..." value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
            <select value={vGame} onChange={(e) => setVGame(e.target.value)}><option value="other">Auto-detect game</option><option value="cod">COD</option><option value="fortnite">Fortnite</option></select>
            <button className="btn small">Post</button>
          </div>
          <div className="lrows">
            {videos.slice(0, 5).map((v) => (
              <div key={v.id} className="lrow">
                <img className="mini-thumb" src={v.thumbnail_url} alt="" />
                <div className="grow"><strong className="etitle">{v.title}</strong><div className="muted small">{v.viewers} viewers · {v.completions} finished</div></div>
              </div>
            ))}
          </div>
        </form>

        <form className="panel stack tight" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/streamer/events", { ...ev, startsAt: new Date(ev.startsAt).toISOString() }); setEv({ ...ev, title: "", description: "" }); ctx.toast("Event posted."); }); }}>
          <h3>Post an event</h3>
          <input required minLength={3} placeholder="Event title" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
          <div className="row wrap">
            <select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}><option value="watch_party">Watch party</option><option value="tournament">Tournament</option><option value="meetup">Meetup</option><option value="drop">Relic drop night</option></select>
            <select value={ev.game} onChange={(e) => setEv({ ...ev, game: e.target.value })}><option value="other">Any game</option><option value="cod">COD</option><option value="fortnite">Fortnite</option></select>
            <input type="datetime-local" required value={ev.startsAt} onChange={(e) => setEv({ ...ev, startsAt: e.target.value })} />
          </div>
          <input placeholder="Location" value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} />
          <button className="btn small">Post event</button>
        </form>
      </div>

      <section>
        <h3>Your streams</h3>
        <div className="list">
          {data.streams.map((s) => (
            <div key={s.id} className="panel stack">
              <div className="row">
                <span className={s.status === "live" ? "tag live" : "tag"}>{s.status}</span>
                <strong className="grow">{s.title}</strong>
                {s.status !== "scheduled" && <button className="btn small ghost" onClick={() => toggleStats(s.id)}>{openStats === s.id ? "Hide stats" : "Stats"}</button>}
                {s.status === "scheduled" && <button className="btn" onClick={() => run(() => api("POST", `/streamer/streams/${s.id}/start`))}>Go live</button>}
                {s.status === "live" && (
                  <>
                    <select value={tier} onChange={(e) => setTier(e.target.value as "free" | "premium")}><option value="free">Free drop</option><option value="premium">Premium drop</option></select>
                    <button className="btn" onClick={() => run(async () => { const d = await api<Dropped>("POST", `/streamer/streams/${s.id}/drop`, { tier }); setDropped((m) => ({ ...m, [s.id]: d })); })}>Drop the code</button>
                    <button className="btn ghost" onClick={() => run(() => api("POST", `/streamer/streams/${s.id}/end`))}>End stream</button>
                  </>
                )}
              </div>
              {openStats === s.id && stats[s.id] && <StatsPanel a={stats[s.id]} />}
              {dropped[s.id] && s.status === "live" && (
                <div className="code-box">
                  <span className="muted small">Say this code on stream. It is shown once.</span>
                  <div className="code">{dropped[s.id].code}</div>
                  <span className="muted small">{dropped[s.id].eligibleCount} viewers qualify · {dropped[s.id].partsAwarded} part(s) each</span>
                </div>
              )}
            </div>
          ))}
          {data.streams.length === 0 && <p className="muted">No streams yet.</p>}
        </div>
      </section>

      {data.streamer.is_partner && (
        <section>
          <h3>Call slots</h3>
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void run(() => api("POST", "/streamer/slots", { startsAt: new Date(slotAt).toISOString(), durationMin: 15 })); }}>
            <input type="datetime-local" required value={slotAt} onChange={(e) => setSlotAt(e.target.value)} />
            <button className="btn">Add 15 min slot</button>
          </form>
          <div className="list">
            {data.slots.map((s) => (
              <div key={s.id} className="row item">
                <span className="grow">{new Date(s.starts_at).toLocaleString()} · {s.duration_min} min</span>
                <span className="tag">{s.status === "booked" ? `Booked by ${s.booked_by_name}` : s.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Viewers per stream minute, drawn from the Tiger Data hypertable. */
function StatsPanel({ a }: { a: Analytics }) {
  const W = 520, H = 90, pad = 6;
  const max = Math.max(1, a.peak);
  const pts = a.series.map((p, i) => {
    const x = pad + (a.series.length <= 1 ? 0 : (i / (a.series.length - 1)) * (W - pad * 2));
    const y = H - pad - (p.viewers / max) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div className="stats-panel">
      <div className="row wrap">
        <span className="stat"><strong>{a.peak}</strong><span>peak viewers</span></span>
        <span className="stat"><strong>{a.uniqueViewers}</strong><span>unique viewers</span></span>
        <span className="stat"><strong>{a.relicsClaimed}</strong><span>relics claimed</span></span>
      </div>
      {pts.length > 1 ? (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Viewers per minute" className="spark">
          <polyline points={`${pad},${H - pad} ${line} ${W - pad},${H - pad}`} className="spark-fill" />
          <polyline points={line} className="spark-line" />
        </svg>
      ) : (
        <p className="muted small">The chart appears after a few minutes of viewers.</p>
      )}
    </div>
  );
}
