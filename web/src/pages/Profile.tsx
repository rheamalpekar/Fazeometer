import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { api, type ProfileData, type Template } from "../api";
import type { Ctx } from "../App";
import { Skeleton } from "../components/ui";

const Character3D = lazy(() => import("../Character3D").then((m) => ({ default: m.Character3D })));
import { VideoCard, gameLabel } from "../components/cards";
import { countryName } from "./Login";

const LegendScene = lazy(() => import("../three/OdysseyScene").then((m) => ({ default: m.LegendScene })));

const INTERESTS = ["cod", "fortnite", "highlights", "tournaments", "tutorials", "funny", "vlogs", "challenges"];
const label = (k: string) => (k === "cod" ? "COD" : k === "fortnite" ? "Fortnite" : k[0].toUpperCase() + k.slice(1));
const when = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function Stat({ n, label: l }: { n: string | number; label: string }) {
  return <div className="stat"><strong>{n}</strong><span>{l}</span></div>;
}

export function Profile({ ctx }: { ctx: Ctx }) {
  const { me } = ctx;
  const [p, setP] = useState<ProfileData | null>(null);
  const [sel, setSel] = useState<string>("");
  const [focus, setFocus] = useState<number | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const relicTotal = me.characters.reduce((n, c) => n + c.owned, 0);

  const load = useCallback(() => api<ProfileData>("GET", "/profile").then(setP).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, relicTotal]);
  useEffect(() => { api<Template[]>("GET", "/catalog/characters").then(setTemplates).catch(() => {}); }, []);

  if (!p) {
    return (
      <div className="profile" aria-busy="true">
        <Skeleton h={96} r={12} />
        <Skeleton h={420} r={12} />
      </div>
    );
  }

  const ch = p.characters.find((c) => c.id === sel) ?? p.characters[0];
  const legend = sel === "legend";
  const toggleInterest = async (k: string) => {
    const next = p.user.interests.includes(k) ? p.user.interests.filter((i) => i !== k) : [...p.user.interests, k];
    const r = await api<{ interests: string[] }>("PUT", "/me/interests", { interests: next });
    setP({ ...p, user: { ...p.user, interests: r.interests } });
  };
  const start = async (templateId: string) => {
    try { await api("POST", "/characters/start", { templateId }); await ctx.refresh(); await load(); } catch (e: any) { ctx.toast(e.message); }
  };
  const freeTemplates = templates.filter((t) => t.tier === "free" && !p.characters.some((c) => c.template_id === t.id));

  return (
    <div className="profile">
      <header className="phead">
        <div className="avatar">{p.user.display_name.slice(0, 1).toUpperCase()}</div>
        <div className="grow">
          <h2>{p.user.display_name}</h2>
          <div className="muted small">{countryName(p.user.country)} · Voyager since {when(p.user.created_at)}</div>
          <div className="chips tight">
            {INTERESTS.map((k) => (
              <button key={k} className={p.user.interests.includes(k) ? "chip-btn on" : "chip-btn"} onClick={() => toggleInterest(k)}>{label(k)}</button>
            ))}
          </div>
        </div>
        <div className="stats">
          <Stat n={p.stats.relics} label="relics" />
          <Stat n={p.stats.videosCompleted} label="videos done" />
          <Stat n={p.stats.streamsCompleted} label="streams done" />
          <Stat n={p.stats.hoursWatched} label="hours" />
          <Stat n={p.stats.streak} label="day streak" />
          <Stat n={p.stats.credits} label="credits" />
        </div>
      </header>

      {p.characters.length === 0 ? (
        <section className="row-sec">
          <h2>Launch your ship</h2>
          <p className="muted small">Your Odyssey ship has 30 relics. You get the Keel free, and earn the rest by finishing videos and live streams.</p>
          <div className="vgrid">
            {freeTemplates.map((t) => (
              <div key={t.id} className="card" style={{ borderTopColor: t.color }}>
                <span className="tag">{gameLabel(t.game)}</span>
                <strong>{t.name}</strong>
                <span className="muted small">{t.theme}</span>
                <button className="btn small" onClick={() => start(t.id)}>Launch with 1 free relic</button>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="showcase">
          <div className="tabs">
            {p.characters.map((c) => <button key={c.id} className={!legend && ch?.id === c.id ? "tab on" : "tab"} onClick={() => setSel(c.id)}>{c.name}</button>)}
            <button className={legend ? "tab on" : "tab"} onClick={() => setSel("legend")}>Legend: Agamemnon</button>
            {!me.premium && <button className="tab" onClick={() => ctx.go("premium")}>+ Agamemnon ($5)</button>}
          </div>
          <div className="show-grid">
            <div className="canvas">
              {legend ? (
                <Suspense fallback={null}><LegendScene /></Suspense>
              ) : (
                ch && <Suspense fallback={null}><Character3D view={ch} freshIds={ctx.fresh} focusPosition={focus} /></Suspense>
              )}
              <div className="canvas-hud">
                <strong>{legend ? "Agamemnon, king of Mycenae" : ch?.name}</strong>
                <span>{legend ? "What a finished hero looks like. Drag to turn him." : `${ch?.owned} / ${ch?.total_parts} relics`}</span>
              </div>
            </div>
            <div className="stack tight">
              {!legend && ch && (
                <>
                  <div className="bar"><div style={{ width: `${(ch.owned / ch.total_parts) * 100}%`, background: ch.color }} /></div>
                  <div className="relics-grid">
                    {ch.parts.map((r) => (
                      <div
                        key={r.id}
                        className={`relic ${r.owned ? "owned" : "locked"} ${r.rarity} ${ctx.fresh.has(r.id) ? "fresh" : ""}`}
                        title={r.owned ? `${r.slot} (${r.rarity})${r.source_title ? `. From: ${r.source_title}` : ""}` : `Locked relic ${r.position}`}
                        onMouseEnter={() => setFocus(r.position)}
                        onMouseLeave={() => setFocus(null)}
                      >
                        <span className="rn">{r.position}</span>
                        <span className="rname">{r.owned ? r.slot : "Locked"}</span>
                      </div>
                    ))}
                  </div>
                  {ch.status === "complete" ? (
                    <button className="btn small" onClick={() => ctx.go("call")}>Ship complete: book your live call</button>
                  ) : (
                    <span className="muted small">Finish a video or live stream to earn the next relic. Videos give up to {ctx.cfg.videoPartsPerDay} a day.</span>
                  )}
                </>
              )}
              {legend && <p className="muted small">Build Agamemnon with 30 more relics. Finish any build to earn a live call with a partner streamer.</p>}
            </div>
          </div>
        </section>
      )}

      <div className="duo">
        <section className="row-sec">
          <h2>Achievements</h2>
          <div className="lrows">
            {p.achievements.map((a, i) => (
              <div key={i} className="lrow">
                <span className={`dot ${a.rarity}`} />
                <div className="grow">
                  <strong className="etitle">{a.relic}</strong>
                  <div className="muted small">
                    {a.kind === "video" ? "Finished video" : a.kind === "stream" ? "Finished live stream" : a.kind === "welcome" ? "Welcome gift" : "Earned"}
                    {a.title && a.kind !== "welcome" ? `: ${a.title}` : ""}
                  </div>
                </div>
                <span className="muted small">{when(a.at)}</span>
              </div>
            ))}
            {p.achievements.length === 0 && <p className="muted small">Finish a video to earn your first achievement.</p>}
          </div>
        </section>

        <section className="row-sec">
          <h2>Live streams watched</h2>
          <div className="lrows">
            {p.streams.map((s) => (
              <div key={s.id} className="lrow">
                <span className={s.coverage >= 0.8 ? "tag ok" : "tag"}>{Math.round(s.coverage * 100)}%</span>
                <div className="grow"><strong className="etitle">{s.title}</strong><div className="muted small">{gameLabel(s.game)} · {s.minutes_watched} min watched</div></div>
              </div>
            ))}
            {p.streams.length === 0 && <p className="muted small">Watch a live stream to see it here. 80% or more counts as completed.</p>}
          </div>
        </section>
      </div>

      <section className="row-sec">
        <h2>Watch history</h2>
        <div className="vgrid">{p.history.map((v) => <VideoCard key={v.id} v={v} onOpen={ctx.watchVideo} />)}</div>
        {p.history.length === 0 && <p className="muted small">Videos you watch appear here.</p>}
      </section>
    </div>
  );
}
