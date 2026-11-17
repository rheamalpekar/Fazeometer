import { Suspense, lazy, useState } from "react";
import { api, type AppConfig } from "../api";
import { COUNTRIES } from "./Login";
import { RELICS, relicRarity } from "../relics";
import "./landing.css";

const LandingScene = lazy(() => import("../three/OdysseyScene").then((m) => ({ default: m.LandingScene })));

const CHAPTERS = [
  { n: "I", title: "Embark", text: "Pick your favorite game and interests, then launch your Odyssey ship. One relic waits at the dock, free." },
  { n: "II", title: "Endure", text: "Watch your streamers to the final minute. At the end they speak a secret word. Only those who stayed can claim a relic." },
  { n: "III", title: "Return", text: "Thirty relics finish your ship. The gods grant a live video call and a play session with a partner streamer." },
];

export function Landing({ onDone, cfg }: { onDone: () => void; cfg: AppConfig }) {
  const [f, setF] = useState({ email: "", password: "", displayName: "", country: "US", birthdate: "2000-01-01", game: "cod" });
  const [mode, setMode] = useState<"new" | "returning">("new");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (path: string, body: object) => {
    setBusy(true);
    setErr("");
    try {
      await api("POST", path, body);
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lp">
      <section className="hero">
        <div className="hero-3d" aria-hidden>
          <Suspense fallback={null}><LandingScene /></Suspense>
        </div>
        <div className="hero-shade" />
        <header className="lp-top">
          <span className="lp-mark"><span className="lp-logo">F</span> FaZe Odyssey</span>
          <a className="lp-link" href="#join">Join the crew</a>
        </header>
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="kicker">A FaZe Clan voyage</span>
            <h1>FaZe <span>Odyssey</span></h1>
            <p className="tagline">Every stream is a voyage. Stay to the last horizon.</p>
            <p className="lede">Watch FaZe videos and live streams on one feed built around you. Finish them to earn the thirty relics of an Odyssey ship, show it off on your profile, and sail home with a live call from a streamer.</p>
            <div className="hero-cta">
              <a className="gold-btn" href="#join" onClick={() => setMode("new")}>Begin the voyage</a>
              <a className="ghost-btn" href="#join" onClick={() => setMode("returning")}>Continue the voyage</a>
            </div>
          </div>

        </div>
      </section>

      <div className="meander" aria-hidden />

      <section id="voyage" className="band">
        <div className="wrap">
          <span className="kicker">The voyage</span>
          <h2>Three chapters from the dock to the gods</h2>
          <div className="chapters">
            {CHAPTERS.map((c) => (
              <article key={c.n} className="chapter">
                <span className="numeral">{c.n}</span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap">
          <span className="kicker">Thirty relics</span>
          <h2>One relic at the dock. Twenty-nine to win.</h2>
          <p className="band-lede">Your free build is a Greek war galley made of thirty relics, from the common Keel to the legendary Odyssey Crest. Rarer relics glow brighter.</p>
          <ol className="relics">
            {RELICS.map((name, i) => (
              <li key={name} className={relicRarity(i + 1)}>
                <span className="rn">{String(i + 1).padStart(2, "0")}</span>
                <span>{name}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <span className="kicker">Two builds</span>
          <h2>A ship first, then a king</h2>
          <div className="epics">
            <article className="war cod">
              <span className="game">Free build</span>
              <h3>Trireme of Ithaca</h3>
              <p>A Greek war galley with a crimson sail, rows of shields and a gold prow. Every fan starts here with one relic given.</p>
              <span className="premium">Thirty relics from videos and live streams</span>
            </article>
            <article className="war fn">
              <span className="game">Second build, $5 a month</span>
              <h3>Agamemnon, King of Mycenae</h3>
              <p>The bronze-and-gold king who led the fleet to Troy. Build him relic by relic, with premium-only drops.</p>
              <span className="premium">For fans who finished the ship</span>
            </article>
          </div>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap">
          <span className="kicker">Gifts of the gods</span>
          <h2>What the voyage earns</h2>
          <div className="gifts">
            <article><h3>A live call</h3><p>Finish your ship and meet a partner streamer from your nation, on video, then play together live.</p></article>
            <article><h3>Agamemnon, $5 a month</h3><p>You have already proved you stay to the end. Subscribe to build the king, with premium-only drops and no ads. Cancel any time.</p></article>
            <article><h3>A free regional ticket</h3><p>After 24 paid months the gods grant a ticket to a regional tournament.</p></article>
          </div>
        </div>
      </section>

      <section id="join" className="band join-band">
        <div className="wrap join-wrap">
          <div className="join-copy">
            <span className="kicker">Join the crew</span>
            <h2>Your ship is waiting at the dock</h2>
            <p className="band-lede">Sign up, launch your ship, and take your first relic for free. Returning voyagers sign in with their email and password.</p>
          </div>

      <form className="join" onSubmit={(e) => { e.preventDefault(); void (mode === "new" ? submit("/auth/signup", f) : submit("/auth/login", { email: f.email, password: f.password })); }}>
        <h2>{mode === "new" ? "Join the crew" : "Continue the voyage"}</h2>
        <div className="mode-tabs" role="tablist">
          <button type="button" className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>New voyager</button>
          <button type="button" className={mode === "returning" ? "on" : ""} onClick={() => setMode("returning")}>Returning</button>
        </div>
        <label>Email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Password
          <input type="password" required minLength={mode === "new" ? 10 : 1} maxLength={128} autoComplete={mode === "new" ? "new-password" : "current-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>
        {mode === "new" && <span className="fine">At least 10 characters.</span>}
        {mode === "new" && <>
        <label>Display name<input minLength={2} maxLength={24} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></label>
        <div className="two">
          <label>Country
            <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
              {COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          <label>Birthdate<input type="date" value={f.birthdate} onChange={(e) => setF({ ...f, birthdate: e.target.value })} /></label>
        </div>
        <label>Favorite game
          <select value={f.game} onChange={(e) => setF({ ...f, game: e.target.value })}>
            <option value="cod">Call of Duty</option>
            <option value="fortnite">Fortnite</option>
          </select>
        </label>
        </>}
        <p className="fine">{mode === "new" ? "Live calls are for fans 18 and older." : "Welcome back. Sign in to pick up where you left off."}</p>
        {err && <p className="form-error">{err}</p>}
        <button className="gold-btn full" disabled={busy}>{busy ? "…" : mode === "new" ? "Begin the voyage" : "Continue the voyage"}</button>
        {cfg.demoMode && (
          <div className="demo">
            <span>Demo streamer accounts</span>
            <div className="two">
              {[["NovaStrike", "nova@faze.dev"], ["RexFN", "rex@faze.dev"], ["LunaPlays", "luna@faze.dev"]].map(([n, e]) => (
                <button type="button" key={e} className="ghost-btn small" onClick={() => submit("/auth/demo-login", { email: e })}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </form>
        </div>
      </section>

      <footer className="lp-foot">FaZe Odyssey is a hackathon prototype. Live calls are for fans 18 and older.</footer>
    </div>
  );
}
