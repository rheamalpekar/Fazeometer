import { useEffect, useRef, useState } from "react";
import { api, getSocket, type Video } from "../api";
import type { Ctx } from "../App";
import { loadYT } from "../yt";
import { AdBanner, VideoCard, fmtDur, fmtViews, gameLabel } from "../components/cards";
import { copyText } from "../components/ui";

interface BeatAck {
  ok: boolean; reason?: string; coverage?: number; completed?: boolean; counted?: boolean;
  award?: { awarded: boolean; reason?: string; part?: { slot: string; rarity: string; position: number }; owned?: number; total?: number };
}

export function WatchVideo({ ctx, videoId }: { ctx: Ctx; videoId: string }) {
  const { cfg } = ctx;
  const [data, setData] = useState<{ video: Video; related: Video[] } | null>(null);
  const [coverage, setCoverage] = useState(0);
  const [done, setDone] = useState(false);
  const [award, setAward] = useState<BeatAck["award"] | null>(null);
  const [status, setStatus] = useState("Press play to start earning progress.");
  const [adLeft, setAdLeft] = useState(ctx.me.showAds ? 4 : 0);
  const player = useRef<any>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setData(null); setDone(false); setAward(null); setCoverage(0);
    api<{ video: Video; related: Video[] }>("GET", `/videos/${videoId}`).then((d) => {
      setData(d);
      setCoverage(d.video.coverage ?? 0);
      setDone(Boolean(d.video.completed));
    });
  }, [videoId]);

  useEffect(() => {
    if (adLeft <= 0) return;
    const t = setTimeout(() => setAdLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [adLeft]);

  // Create the YouTube player, then report its position on a timer.
  const ytId = data?.video.youtube_id;
  useEffect(() => {
    if (!ytId || adLeft > 0 || !host.current) return;
    let cancelled = false;
    let timer: number | undefined;
    const lastPos = data?.video.completed ? 0 : Math.floor(data?.video.last_position ?? 0);

    loadYT().then(() => {
      if (cancelled || !host.current) return;
      const el = document.createElement("div");
      host.current.innerHTML = "";
      host.current.appendChild(el);
      player.current = new (window as any).YT.Player(el, {
        videoId: ytId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, playsinline: 1, start: lastPos },
      });
      const socket = getSocket();
      timer = window.setInterval(() => {
        const p = player.current;
        if (!p?.getCurrentTime) return;
        const st = p.getPlayerState();
        const state = st === 1 ? "playing" : st === 2 ? "paused" : st === 3 ? "buffering" : "other";
        socket.emit(
          "vhb",
          { videoId, seq: Date.now(), position: p.getCurrentTime(), state, visible: document.visibilityState === "visible", rate: p.getPlaybackRate?.() ?? 1 },
          (r: BeatAck) => {
            if (!r.ok) { setStatus(r.reason === "too_fast" ? "Syncing…" : `Not counted: ${r.reason}`); return; }
            setCoverage(r.coverage ?? 0);
            setStatus(r.counted ? "Counting your watch time" : state === "playing" ? "Playing" : "Paused: progress only counts while playing");
            if (r.completed) {
              setDone(true);
              if (r.award) setAward(r.award);
              void ctx.refresh();
            }
          },
        );
      }, cfg.videoHbMs);
    });
    return () => { cancelled = true; if (timer) clearInterval(timer); try { player.current?.destroy?.(); } catch { /* player already gone */ } player.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, adLeft, videoId, cfg.videoHbMs]);

  if (!data) return <div className="panel">Loading video…</div>;
  const v = data.video;
  const target = cfg.videoMinCoverage;
  const shown = Math.min(1, coverage / target);

  return (
    <div className="watch-grid">
      <div className="stack tight">
        {adLeft > 0 ? (
          <div className="player ad-roll"><AdBanner /><p>Your video starts in {adLeft}…</p><p className="muted small">Premium members skip ads.</p></div>
        ) : (
          <div className="player ytbox" ref={host} />
        )}
        <h2 className="wtitle">{v.title}</h2>
        <div className="between">
          <div className="muted small">{v.channel_title} · {fmtViews(v.views)} views · {gameLabel(v.game)} · {fmtDur(v.duration_sec)}</div>
          <button className="btn small ghost" onClick={async () => ctx.toast((await copyText(`${location.origin}/#/video/${v.id}`)) ? "Link copied" : "Could not copy the link")}>Share</button>
        </div>

        <div className="panel meter">
          <div className="between">
            <strong>{done ? "Completed" : "Relic progress"}</strong>
            <span className="muted small">{done ? "Counted toward your profile" : `${Math.round(shown * 100)}% of the way (watch ${Math.round(target * 100)}% of the video)`}</span>
          </div>
          <div className="bar"><div style={{ width: `${done ? 100 : shown * 100}%` }} /></div>
          <span className="muted small">{done ? "" : status}</span>
          {done && !award && <p className="small muted">You completed this video before, so it will not award another relic.</p>}
          {award?.awarded && award.part && (
            <div className="reward">
              <span className="eyebrow">Relic unlocked</span>
              <strong>{award.part.slot}</strong>
              <span className="muted small">{award.part.rarity} · {award.owned} of {award.total} on your hero</span>
              <button className="btn small" onClick={() => ctx.go("profile")}>See it on your profile</button>
            </div>
          )}
          {award && !award.awarded && <p className="small">{award.reason}</p>}
        </div>

        {v.description && <details className="desc"><summary>Description</summary><p>{v.description}</p></details>}
      </div>

      <aside className="stack tight">
        <h3>Up next</h3>
        {data.related.map((r) => <VideoCard key={r.id} v={r} onOpen={ctx.watchVideo} />)}
      </aside>
    </div>
  );
}
