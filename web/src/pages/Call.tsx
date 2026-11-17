import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Ctx } from "../App";
import { COUNTRIES, countryName } from "./Login";

interface Status { eligible: boolean; reason: string | null; booked: { id: string; starts_at: string; duration_min: number; streamer: string } | null; survey: { nation: string; game: string } | null }
interface StreamerRow { id: string; display_name: string; country: string; followers: number; game: string; color: string; open_slots: number; bio: string; tags: string[] }
interface Slot { id: string; starts_at: string; duration_min: number }

function Room({ slotId, onLeave }: { slotId: string; onLeave: () => void }) {
  const [info, setInfo] = useState<any>(null);
  const [camErr, setCamErr] = useState("");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | undefined;
    api("GET", `/call/join/${slotId}`).then(setInfo).catch((e) => setInfo({ error: e.message }));
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
      .then((s) => { stream = s; if (video.current) video.current.srcObject = s; })
      .catch(() => setCamErr("Camera or microphone is blocked. The room still works without them."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [slotId]);

  return (
    <div className="panel stack">
      <div className="between"><h3>Call room</h3><button className="btn ghost" onClick={onLeave}>Leave</button></div>
      {info?.error && <p className="error">{info.error}</p>}
      <video ref={video} autoPlay muted playsInline className="preview" />
      {camErr && <p className="muted small">{camErr}</p>}
      {info?.mode === "mock" && <p className="muted small">LiveKit is not configured, so this is a local preview of your own camera. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET and the API returns a real join token for this room ({info.room.slice(0, 8)}…).</p>}
      {info?.mode === "livekit" && <p className="muted small">Join token issued for room {info.room.slice(0, 8)}…. Connect with livekit-client using the URL and token from this response.</p>}
    </div>
  );
}

export function Call({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [nation, setNation] = useState(ctx.me.user.country);
  const [game, setGame] = useState(ctx.me.user.game_pref ?? "cod");
  const [streamers, setStreamers] = useState<StreamerRow[] | null>(null);
  const [picked, setPicked] = useState<StreamerRow | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [room, setRoom] = useState<string | null>(null);

  const load = () => api<Status>("GET", "/call/status").then(setStatus);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (status?.eligible && status.survey) api<{ streamers: StreamerRow[] }>("GET", "/call/streamers").then((r) => setStreamers(r.streamers));
  }, [status?.eligible, status?.survey]);
  useEffect(() => {
    if (picked) api<Slot[]>("GET", `/call/slots?streamerId=${picked.id}`).then(setSlots);
  }, [picked]);

  if (!status) return <div className="panel">Loading…</div>;

  const survey = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("POST", "/survey", { nation, game });
    await load();
  };
  const book = async (id: string) => {
    try { await api("POST", `/call/slots/${id}/book`); ctx.toast("Call booked."); setPicked(null); await load(); }
    catch (e: any) { ctx.toast(e.message); if (picked) api<Slot[]>("GET", `/call/slots?streamerId=${picked.id}`).then(setSlots); }
  };

  if (room) return <Room slotId={room} onLeave={() => setRoom(null)} />;

  return (
    <div className="stack">
      <h2>Live call and play session</h2>
      {!status.eligible && (() => {
        const c = ctx.me.characters.find((x) => x.status === "building") ?? ctx.me.characters[0];
        const pct = c ? Math.round((c.owned / c.total_parts) * 100) : 0;
        return (
          <div className="call-locked">
            <section className="panel">
              <span className="eyebrow">Locked</span>
              <h3>{status.reason}</h3>
              {c && (
                <>
                  <div className="bar" role="progressbar" aria-label={`${c.name} relic progress`} aria-valuemin={0} aria-valuemax={c.total_parts} aria-valuenow={c.owned} aria-valuetext={`${c.owned} of ${c.total_parts} relics`}><div style={{ width: `${pct}%` }} /></div>
                  <span className="small muted">{c.owned} of {c.total_parts} relics on {c.name}</span>
                </>
              )}
              {status.reason?.startsWith("Complete") && <button className="btn" onClick={() => ctx.go("profile")}>See my voyage</button>}
            </section>
            <section className="panel">
              <h3>How it works</h3>
              <ol className="steps">
                <li><strong>Finish your ship.</strong> Watch videos and live streams to collect all 30 relics.</li>
                <li><strong>Pick a streamer.</strong> Choose a partner streamer from your nation and a time that suits you.</li>
                <li><strong>Join the call.</strong> Meet on video, then play COD or Fortnite together.</li>
              </ol>
            </section>
          </div>
        );
      })()}

      {status.booked && (
        <div className="panel">
          <h3>Your booked call</h3>
          <p>{status.booked.streamer} · {new Date(status.booked.starts_at).toLocaleString()} · {status.booked.duration_min} min</p>
          <button className="btn" onClick={() => setRoom(status.booked!.id)}>Open room</button>
          <p className="muted small">The room opens 10 minutes before the call. Demo mode opens it any time. The game party runs in COD or Fortnite. Add your game ID to your profile before the call.</p>
        </div>
      )}

      {status.eligible && !status.booked && !status.survey && (
        <form className="panel stack" onSubmit={survey}>
          <h3>Quick survey: who should you play with?</h3>
          <div className="row">
            <label>Your nation
              <select value={nation} onChange={(e) => setNation(e.target.value)}>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            </label>
            <label>Game
              <select value={game} onChange={(e) => setGame(e.target.value)}><option value="cod">Call of Duty</option><option value="fortnite">Fortnite</option></select>
            </label>
          </div>
          <button className="btn">Show partner streamers</button>
        </form>
      )}

      {status.eligible && !status.booked && status.survey && streamers && !picked && (
        <>
          <p className="muted">Partner streamers have 30,000+ followers. Streamers from {countryName(status.survey.nation)} come first.</p>
          <div className="grid">
            {streamers.map((s) => (
              <div key={s.id} className="card" style={{ borderTopColor: s.color }}>
                <span className="tag">{countryName(s.country)}</span>
                <h3>{s.display_name}</h3>
                <p className="muted small">{s.followers.toLocaleString()} followers · {s.game === "cod" ? "COD" : "Fortnite"}</p>
                <p className="small">{s.bio}</p>
                <button className="btn" disabled={s.open_slots === 0} onClick={() => setPicked(s)}>{s.open_slots ? `${s.open_slots} open slots` : "No slots"}</button>
              </div>
            ))}
          </div>
        </>
      )}

      {picked && (
        <div className="panel stack">
          <div className="between"><h3>Pick a time with {picked.display_name}</h3><button className="btn ghost" onClick={() => setPicked(null)}>Back</button></div>
          <div className="list">
            {slots.map((s) => (
              <div key={s.id} className="row item">
                <span className="grow">{new Date(s.starts_at).toLocaleString()} · {s.duration_min} min</span>
                <button className="btn" onClick={() => book(s.id)}>Book</button>
              </div>
            ))}
            {slots.length === 0 && <p className="muted">No open slots left.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
