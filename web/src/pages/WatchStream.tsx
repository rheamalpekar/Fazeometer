import { useEffect, useRef, useState } from "react";
import { api, getSocket, type StreamRow } from "../api";
import type { Ctx } from "../App";
import { AdBanner } from "../components/cards";

interface DropInfo { drop: { id: string; closesAt: string; tier: string; partsAwarded: number } | null; eligible?: boolean; coverage?: number; redeemed?: boolean }

function DemoPlayer({ stream, startedAt, paused, onToggle }: { stream: StreamRow; startedAt: number; paused: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="player demo" style={{ ["--c" as string]: stream.color }}>
      <span className="tag live">LIVE</span>
      <div className="bars" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 70}ms`, animationPlayState: paused ? "paused" : "running" }} />)}</div>
      <div className="player-meta">
        <strong>{stream.streamer}</strong> · {stream.title}
        <div className="muted small">Demo stream, simulated so the full loop works without YouTube or Twitch. Stream clock {mm}:{ss}</div>
      </div>
      <button className="btn ghost" onClick={onToggle}>{paused ? "Resume" : "Pause"}</button>
    </div>
  );
}

export function WatchStream({ ctx, streamId }: { ctx: Ctx; streamId: string }) {
  const { cfg } = ctx;
  const [stream, setStream] = useState<StreamRow | null>(null);
  const [ended, setEnded] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [adLeft, setAdLeft] = useState(ctx.me.showAds ? 5 : 0);
  const [paused, setPaused] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [counted, setCounted] = useState(0);
  const [lastHb, setLastHb] = useState<string>("waiting");
  const [dropInfo, setDropInfo] = useState<DropInfo>({ drop: null });
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [left, setLeft] = useState(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    api<StreamRow[]>("GET", "/streams").then((rows) => {
      const s = rows.find((r) => r.id === streamId) ?? null;
      setStream(s);
      if (!s || s.status !== "live") setEnded(true);
    });
  }, [streamId]);

  // Pre-roll countdown for free users.
  useEffect(() => {
    if (adLeft <= 0) return;
    const t = setTimeout(() => setAdLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [adLeft]);

  // Watch session and heartbeat loop.
  useEffect(() => {
    if (!stream || ended || adLeft > 0) return;
    let stop = false;
    let timer: number | undefined;
    let sessionId = "";
    const socket = getSocket();

    const onKicked = (p: { sessionId: string }) => { if (p.sessionId === sessionId) { stop = true; setKicked(true); } };
    socket.on("kicked", onKicked);

    (async () => {
      try {
        const s = await api<{ sessionId: string; startedAt: number; hbMs: number }>("POST", "/watch/sessions", { streamId });
        if (stop) return;
        sessionId = s.sessionId;
        setStartedAt(s.startedAt);
        let seq = 0;
        const beat = () => {
          if (stop) return;
          socket.emit("hb", { sessionId, seq: seq++, state: pausedRef.current ? "paused" : "playing", visible: document.visibilityState === "visible" },
            (r: { ok: boolean; counted?: boolean; reason?: string }) => {
              if (r.ok) { setLastHb(r.counted ? "counted" : "not counted (paused or tab hidden)"); if (r.counted) setCounted((c) => c + 1); }
              else setLastHb(`rejected: ${r.reason}`);
            });
        };
        beat();
        timer = window.setInterval(beat, s.hbMs);
      } catch (e: any) {
        setMsg({ ok: false, text: e.message });
      }
    })();

    return () => { stop = true; if (timer) clearInterval(timer); socket.off("kicked", onKicked); };
  }, [stream, ended, adLeft, streamId]);

  // Drop banner: pushed over the socket, and also polled so a page reload does not miss it.
  useEffect(() => {
    const socket = getSocket();
    const check = () => api<DropInfo>("GET", `/drops/active?streamId=${streamId}`).then(setDropInfo).catch(() => {});
    const onDrop = (d: { streamId: string }) => { if (d.streamId === streamId) check(); };
    const onEnd = (d: { streamId: string }) => { if (d.streamId === streamId) setEnded(true); };
    socket.on("drop:open", onDrop);
    socket.on("stream:ended", onEnd);
    check();
    const t = setInterval(check, Math.max(cfg.hbMs, 3000));
    return () => { socket.off("drop:open", onDrop); socket.off("stream:ended", onEnd); clearInterval(t); };
  }, [streamId, cfg.hbMs]);

  useEffect(() => {
    if (!dropInfo.drop) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(dropInfo.drop!.closesAt).getTime() - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [dropInfo.drop]);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dropInfo.drop) return;
    try {
      const r = await api<{ parts: { slot: string }[]; owned: number; total: number; complete: boolean }>("POST", `/drops/${dropInfo.drop.id}/redeem`, { code });
      setMsg({ ok: true, text: `Unlocked ${r.parts.map((p) => p.slot).join(", ")}. ${r.owned} of ${r.total} parts.` });
      setCode("");
      void ctx.refresh();
      setDropInfo((d) => ({ ...d, redeemed: true }));
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  if (!stream) return <div className="panel">Loading stream…</div>;

  const embed =
    stream.platform === "youtube" && stream.embed_id ? `https://www.youtube.com/embed/${stream.embed_id}?rel=0&playsinline=1`
    : stream.platform === "twitch" && stream.embed_id ? `https://player.twitch.tv/?channel=${stream.embed_id}&parent=${location.hostname}&muted=true`
    : null;

  return (
    <div className="stack">
      <div className="between">
        <h2>{stream.title}</h2>
        <button className="btn ghost" onClick={() => ctx.go("home")}>Back</button>
      </div>

      {ended && <div className="panel"><strong>This stream has ended.</strong><p className="muted small">Credits and your streak are updated. Check your character for new parts.</p></div>}
      {kicked && <div className="panel error-box">You opened this stream in another tab, so this one stopped counting.</div>}

      {!ended && adLeft > 0 && (
        <div className="player ad-roll">
          <AdBanner />
          <p>Your stream starts in {adLeft}…</p>
          <p className="muted small">Go premium to skip ads.</p>
        </div>
      )}

      {!ended && adLeft === 0 && (
        embed ? <iframe className="player" src={embed} allow="autoplay; fullscreen" title="Stream" />
        : <DemoPlayer stream={stream} startedAt={startedAt ?? Date.now()} paused={paused} onToggle={() => setPaused((p) => !p)} />
      )}

      {!ended && (
        <div className="panel meter">
          <div className="between"><strong>Watch proof</strong><span className="muted small">Heartbeat every {Math.round(cfg.hbMs / 1000)}s</span></div>
          <p className="small">Counted heartbeats: <strong>{counted}</strong> · last: {lastHb}</p>
          {embed && <p className="muted small">Embedded players cannot report pause state to this page, so only tab visibility is checked here. The secret code still decides who qualifies.</p>}
        </div>
      )}

      {dropInfo.drop && (
        <div className={`panel drop ${dropInfo.eligible && !dropInfo.redeemed ? "open" : ""}`}>
          <div className="between">
            <strong>End-of-stream drop is open</strong>
            <span className="tag live">{left}s left</span>
          </div>
          {dropInfo.redeemed ? (
            <p>You already claimed this drop.</p>
          ) : dropInfo.eligible ? (
            <form className="row" onSubmit={redeem}>
              <input className="grow" placeholder="Type the secret code the streamer says" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              <button className="btn">Unlock {dropInfo.drop.partsAwarded > 1 ? `${dropInfo.drop.partsAwarded} parts` : "part"}</button>
            </form>
          ) : (
            <p className="muted">A drop is open, but you did not watch enough of this stream to qualify ({Math.round((dropInfo.coverage ?? 0) * 100)}% watched, 80% needed{dropInfo.drop.tier === "premium" ? ", premium only" : ""}).</p>
          )}
        </div>
      )}
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </div>
  );
}
