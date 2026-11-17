import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, closeSocket, getSocket, type AppConfig, type Me } from "./api";
import { Landing } from "./pages/Landing";
import { Assistant } from "./components/Assistant";
import { Home } from "./pages/Home";
import { Profile } from "./pages/Profile";
import { WatchStream } from "./pages/WatchStream";
import { WatchVideo } from "./pages/WatchVideo";
import { Premium } from "./pages/Premium";
import { Call } from "./pages/Call";
import { Streamer } from "./pages/Streamer";
import { AvatarMenu, NotificationBell, RelicModal, type Notice, type Unlock } from "./components/ui";

export type View = "home" | "profile" | "stream" | "video" | "call" | "premium" | "streamer";
export type Tab = "home" | "profile" | "call" | "premium" | "streamer";

export interface Ctx {
  me: Me;
  cfg: AppConfig;
  refresh: () => Promise<void>;
  go: (v: Tab) => void;
  watchStream: (id: string) => void;
  watchVideo: (id: string) => void;
  toast: (msg: string) => void;
  fresh: Set<string>;
  streamTick: number;
  query: URLSearchParams;
}

// ---- hash routing: every page has a link, Back works, and a refresh keeps your place ----
interface Route { view: View; id: string | null; query: URLSearchParams }
const TAB_HASH: Record<Tab, string> = { home: "#/", profile: "#/profile", call: "#/call", premium: "#/premium", streamer: "#/studio" };

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const [head, id] = path.split("/");
  const query = new URLSearchParams(qs ?? "");
  switch (head) {
    case "profile": return { view: "profile", id: null, query };
    case "call": return { view: "call", id: null, query };
    case "premium": return { view: "premium", id: null, query };
    case "studio": return { view: "streamer", id: null, query };
    case "video": return id ? { view: "video", id, query } : { view: "home", id: null, query };
    case "stream": return id ? { view: "stream", id, query } : { view: "home", id: null, query };
    default: return { view: "home", id: null, query };
  }
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [streamTick, setStreamTick] = useState(0);
  const [unlock, setUnlock] = useState<Unlock | null>(null);

  const [liveMsg, setLiveMsg] = useState("");
  const flip = useRef(false);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    flip.current = !flip.current;
    setLiveMsg(m + (flip.current ? "" : "\u00A0")); // the region always exists, so a change is announced; the suffix lets repeats announce too
    window.setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 6000);
  }, []);

  // Only a 401 means "signed out". A rate limit, a network blip or a server error must not log anyone out.
  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setMe((prev) => (prev === undefined ? null : prev));
    }
  }, []);

  const [bootFailed, setBootFailed] = useState(false);
  const boot = useCallback(() => {
    setBootFailed(false);
    api<AppConfig>("GET", "/config").then(setCfg).catch(() => setBootFailed(true));
    void refresh();
  }, [refresh]);
  useEffect(() => { boot(); }, [boot]);

  // "/" jumps to the search box from anywhere (unless you are already typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { e.preventDefault(); document.getElementById("video-search")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // Coming back from checkout.
  useEffect(() => {
    if (me && route.view === "premium" && route.query.get("paid") === "1") {
      history.replaceState(null, "", "#/premium");
      setRoute(parseHash()); // clears ?paid=1 from state, so this runs exactly once
      toast("Thank you! Your monthly plan is active.");
      void refresh();
    }
  }, [me, route, toast, refresh]);

  // Streamers land in the Studio.
  const role = me?.user.role;
  useEffect(() => {
    if (role === "streamer" && !location.hash.startsWith("#/")) location.hash = TAB_HASH.streamer;
  }, [role]);

  // Socket events that matter on every page.
  const userId = me?.user.id;
  useEffect(() => {
    if (!userId) return;
    const s = getSocket();
    const onPart = (p: { parts: { id: string; slot: string; rarity: string }[]; owned: number; total: number; complete?: boolean; source?: { kind: string; title?: string } }) => {
      setFresh(new Set(p.parts.map((x) => x.id)));
      window.setTimeout(() => setFresh(new Set()), 8000);
      const first = p.parts[0];
      if (first) setUnlock({ slot: p.parts.length > 1 ? `${first.slot} + ${p.parts.length - 1} more` : first.slot, rarity: first.rarity, owned: p.owned, total: p.total, source: p.source?.title, complete: p.complete });
      void refresh();
    };
    const onLive = (p: { title: string }) => { toast(`Live now: ${p.title}`); setStreamTick((t) => t + 1); };
    const onEnded = () => setStreamTick((t) => t + 1);
    s.on("part:unlocked", onPart);
    s.on("stream:live", onLive);
    s.on("stream:ended", onEnded);
    return () => {
      s.off("part:unlocked", onPart);
      s.off("stream:live", onLive);
      s.off("stream:ended", onEnded);
    };
  }, [userId, refresh, toast]);

  // Mobile menu: closes on navigation, on Escape (focus goes back to the Menu button) and on an outside click.
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const mobilePanel = useRef<HTMLDivElement>(null);
  useEffect(() => { setMobileOpen(false); }, [route.view, route.id]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMobileOpen(false); menuBtn.current?.focus(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!mobilePanel.current?.contains(t) && !menuBtn.current?.contains(t)) setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [mobileOpen]);

  // Each page gets its own title, and focus moves to the page content after navigating, so keyboard and screen reader users start in the right place.
  const TITLES: Record<View, string> = { home: "Home", profile: "Profile", call: "Live call", premium: "Premium", streamer: "Studio", video: "Watch", stream: "Live stream" };
  const firstRoute = useRef(true);
  useEffect(() => {
    if (!me) return;
    document.title = `${TITLES[route.view]} · FaZe Odyssey`;
    if (firstRoute.current) { firstRoute.current = false; return; }
    document.getElementById("main")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view, route.id, me?.user.id]);

  if (!cfg && bootFailed) {
    return (
      <div className="boot" role="alert">
        <h1 style={{ font: "600 28px/1.2 var(--font-display)", margin: "0 0 8px" }}>We can't reach Odyssey right now</h1>
        <p style={{ margin: "0 0 16px", color: "var(--muted)" }}>Check your connection and try again. Your progress is safe.</p>
        <button className="btn" onClick={boot}>Try again</button>
      </div>
    );
  }
  if (me === undefined || !cfg) return <div className="boot">Loading…</div>;
  if (me === null) return <Landing onDone={refresh} cfg={cfg} />;

  const go = (t: Tab) => { location.hash = TAB_HASH[t]; };
  const ctx: Ctx = {
    me, cfg, refresh, toast, fresh, streamTick, go, query: route.query,
    watchStream: (id) => { location.hash = `#/stream/${id}`; },
    watchVideo: (id) => { location.hash = `#/video/${id}`; },
  };

  const openNotice = (n: Notice) => {
    void api("POST", "/notifications/read", { ids: [n.id] }).catch(() => {});
    if (n.type === "relic") go("profile");
    else if (n.type === "live" && n.data?.streamId) ctx.watchStream(String(n.data.streamId));
    else go("home");
  };

  const isStreamer = me.user.role === "streamer";
  const activeTab: Tab | null = route.view === "stream" || route.view === "video" ? null : (route.view as Tab);
  const links: [Tab, string][] = [
    ["home", "Home"],
    ["profile", "Profile"],
    ["call", "Live call"],
    ...(isStreamer ? ([["streamer", "Studio"]] as [Tab, string][]) : []),
  ];
  const premiumActive = Boolean(me.subscription?.active);
  const signOut = async () => { await api("POST", "/auth/logout"); closeSocket(); location.hash = ""; setMe(null); };

  return (
    <div className={route.view === "home" ? "shell wide" : "shell"}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href={TAB_HASH.home} aria-label="FaZe Odyssey, home">
            <span className="logo" aria-hidden>F</span>
            <span>Odyssey</span>
          </a>
          <nav className="primary-nav" aria-label="Main">
            {links.map(([v, label]) => (
              <a key={v} className="navlink" href={TAB_HASH[v]} aria-current={activeTab === v ? "page" : undefined}>{label}</a>
            ))}
          </nav>
          <form className="topsearch" role="search" onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get("q") ?? "").trim(); location.hash = t ? `#/?q=${encodeURIComponent(t)}` : "#/"; }}>
            <label className="sr-only" htmlFor="video-search">Search videos</label>
            <input id="video-search" name="q" type="search" placeholder="Search videos  ( / )" defaultValue={route.view === "home" ? (route.query.get("q") ?? "") : ""} key={route.view + (route.query.get("q") ?? "")} autoComplete="off" />
            <button className="topsearch-btn" aria-label="Search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
          </form>
          <div className="top-right">
            <a className="btn outline hide-sm" href={TAB_HASH.premium} aria-current={activeTab === "premium" ? "page" : undefined}>{premiumActive ? "Premium" : "Go Premium"}</a>
            <NotificationBell onOpen={openNotice} />
            <AvatarMenu name={me.user.display_name} email={me.user.email} premium={premiumActive} onSignOut={signOut} />
            <button
              ref={menuBtn}
              className="menu-toggle"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen((o) => !o)}
            >
              <span className="burger" aria-hidden />
              Menu
            </button>
          </div>
        </div>
        <div id="mobile-nav" ref={mobilePanel} className={mobileOpen ? "mobile-panel open" : "mobile-panel"}>
          <div className="mobile-panel-inner">
            <nav aria-label="Mobile">
              {links.map(([v, label]) => (
                <a key={v} className="navlink" href={TAB_HASH[v]} aria-current={activeTab === v ? "page" : undefined}>{label}</a>
              ))}
              <a className="navlink" href={TAB_HASH.premium} aria-current={activeTab === "premium" ? "page" : undefined}>{premiumActive ? "Manage plan" : "Go Premium"}</a>
            </nav>
            <hr />
            <div className="between">
              <span className="muted">Signed in as {me.user.display_name}</span>
              <button className="btn outline small" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        {route.view === "home" && <Home ctx={ctx} />}
        {route.view === "profile" && <Profile ctx={ctx} />}
        {route.view === "stream" && route.id && <WatchStream ctx={ctx} streamId={route.id} />}
        {route.view === "video" && route.id && <WatchVideo ctx={ctx} videoId={route.id} />}
        {route.view === "call" && <Call ctx={ctx} />}
        {route.view === "premium" && <Premium ctx={ctx} />}
        {route.view === "streamer" && isStreamer && <Streamer ctx={ctx} />}
        {route.view === "streamer" && !isStreamer && <div className="panel"><strong>Studio is for streamers.</strong></div>}
      </main>
      <Assistant ctx={ctx} />
      {unlock && <RelicModal unlock={unlock} onClose={() => setUnlock(null)} onProfile={() => { setUnlock(null); go("profile"); }} />}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMsg}</div>
      {toastMsg && <div className="toast" aria-hidden="true">{toastMsg}</div>}
    </div>
  );
}
