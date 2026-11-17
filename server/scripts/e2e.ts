/**
 * End-to-end check of the unlock spine against a running server.
 * Start the server with a fast clock first:  MINUTE_MS=1000 DEMO_MODE=1 npm run start -w server
 * Then:  npm run e2e
 */
import { io as connect } from "socket.io-client";

const BASE = process.env.API ?? "http://localhost:4000";
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PASSWORD = "E2e-pass-1234!";

class Client {
  cookie = "";
  async api(method: string, path: string, body?: unknown) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* redirect or empty */ }
    return { status: r.status, json };
  }
  signup(email: string, name: string, extra: Record<string, unknown> = {}) {
    return this.api("POST", "/auth/signup", { email, password: PASSWORD, displayName: name, country: "US", birthdate: "2000-05-05", game: "cod", ...extra });
  }
}

async function watcher(email: string, name: string, streamId: string, cfg: any, behavior: "full" | "late") {
  const c = new Client();
  const login = await c.signup(email, name);
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.json)}`);
  const tpl = (await c.api("GET", "/catalog/characters")).json.find((t: any) => t.tier === "free");
  await c.api("POST", "/characters/start", { templateId: tpl.id });

  const events: any[] = [];
  const socket = connect(BASE, { extraHeaders: { cookie: c.cookie }, transports: ["websocket"] });
  await new Promise<void>((res, rej) => { socket.on("connect", () => res()); socket.on("connect_error", rej); });
  socket.on("drop:open", (d) => events.push(["drop:open", d]));
  socket.on("part:unlocked", (d) => events.push(["part:unlocked", d]));

  let stop = false;
  const run = async () => {
    // The "late" viewer joins after 40% of the stream window is already gone.
    if (behavior === "late") await sleep(cfg.minuteMs * 4);
    const s = (await c.api("POST", "/watch/sessions", { streamId })).json;
    let seq = 0;
    while (!stop) {
      await new Promise((res) => socket.emit("hb", { sessionId: s.sessionId, seq: seq++, state: "playing", visible: true }, res));
      await sleep(cfg.hbMs);
    }
  };
  void run();
  return { c, socket, events, stop: () => { stop = true; } };
}

// ---- video watch proof helpers ----
async function videoViewer(email: string, name: string) {
  const c = new Client();
  const login = await c.signup(email, name);
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.json)}`);
  const tpl = (await c.api("GET", "/catalog/characters")).json.find((t: any) => t.tier === "free");
  await c.api("POST", "/characters/start", { templateId: tpl.id });
  const socket = connect(BASE, { extraHeaders: { cookie: c.cookie }, transports: ["websocket"] });
  await new Promise<void>((res, rej) => { socket.on("connect", () => res()); socket.on("connect_error", rej); });
  const events: any[] = [];
  socket.on("part:unlocked", (d) => events.push(d));
  return { c, socket, events };
}

/** honest: position advances in step with the clock. skipper: jumps 10 seconds on every beat. */
async function playVideo(v: Awaited<ReturnType<typeof videoViewer>>, videoId: string, mode: "honest" | "skipper", duration: number, hbMs: number) {
  const acks: any[] = [];
  let pos = 0;
  const steps = mode === "honest" ? Math.ceil((duration * 1000) / hbMs) + 3 : 12;
  for (let i = 0; i < steps; i++) {
    const ack: any = await new Promise((res) => v.socket.emit("vhb", { videoId, seq: Date.now(), position: Math.min(pos, duration), state: "playing", visible: true, rate: 1 }, res));
    acks.push(ack);
    if (ack.completed) break;
    await sleep(hbMs);
    pos += mode === "honest" ? hbMs / 1000 : 10;
  }
  return acks;
}

async function main() {
  const cfg = (await new Client().api("GET", "/config")).json;
  console.log(`server minute=${cfg.minuteMs}ms heartbeat=${cfg.hbMs}ms`);
  if (cfg.minuteMs > 2000) console.warn("WARN: run the server with MINUTE_MS=1000 so this finishes quickly");

  // Streamer goes live
  const nova = new Client();
  check("streamer demo login", (await nova.api("POST", "/auth/demo-login", { email: "nova@faze.dev" })).status === 200);

  // ---- security checks ----
  const anon = new Client();
  check("signed-out users cannot read the feed", (await anon.api("GET", "/feed")).status === 401);
  check("email-only login no longer works", (await anon.api("POST", "/auth/login", { email: "nova@faze.dev" })).status === 400);
  check("a streamer account cannot be entered with a guessed password", (await anon.api("POST", "/auth/login", { email: "nova@faze.dev", password: "guess-guess-1234" })).status === 401);
  check("demo login refuses non-demo accounts", (await anon.api("POST", "/auth/demo-login", { email: "someone@example.com" })).status === 403);
  check("weak passwords are refused at sign-up", (await anon.signup(`weak${Date.now()}@test.dev`, "Weak", { password: "password123" })).status === 400);
  const evil = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  check("requests from another website are blocked (CSRF)", evil.status === 403);
  const asFan = new Client();
  await asFan.signup(`sec${Date.now()}@test.dev`, "SecFan");
  check("a fan cannot use streamer endpoints", (await asFan.api("POST", "/streamer/streams", { title: "Nope nope", game: "cod" })).status === 403);
  const created = (await nova.api("POST", "/streamer/streams", { title: "E2E stream", game: "cod", platform: "demo" })).json;
  const started = await nova.api("POST", `/streamer/streams/${created.id}/start`);
  check("stream goes live", started.status === 200 && started.json.status === "live");
  const streamId = created.id as string;

  // A fan who watches the whole time, and one who joins late.
  const stamp = Date.now();
  const full = await watcher(`full${stamp}@test.dev`, "FullWatcher", streamId, cfg, "full");
  const late = await watcher(`late${stamp}@test.dev`, "LateJoiner", streamId, cfg, "late");

  // A second tab for the same account kicks the first one.
  const dup = new Client();
  await dup.signup(`dup${stamp}@test.dev`, "TwoTabs");
  check("signing up twice with one email is refused", (await new Client().signup(`dup${stamp}@test.dev`, "Copycat")).status === 409);
  const relog = new Client();
  check("the right password signs in", (await relog.api("POST", "/auth/login", { email: `dup${stamp}@test.dev`, password: PASSWORD })).status === 200);
  check("a wrong password does not", (await new Client().api("POST", "/auth/login", { email: `dup${stamp}@test.dev`, password: "wrong-pass-9999" })).status === 401);
  const dupSocket = connect(BASE, { extraHeaders: { cookie: dup.cookie }, transports: ["websocket"] });
  await new Promise<void>((res, rej) => { dupSocket.on("connect", () => res()); dupSocket.on("connect_error", rej); });
  let kicked = false;
  dupSocket.on("kicked", () => (kicked = true));
  await dup.api("POST", "/watch/sessions", { streamId });
  await dup.api("POST", "/watch/sessions", { streamId });
  await sleep(300);
  check("a second tab kicks the first session", kicked);
  dupSocket.close();

  await sleep(cfg.minuteMs * 6 + 500); // 6 stream minutes pass

  // Too-early drop should be refused when no full minute has passed; here we are past it, so create the real drop.
  const drop = await nova.api("POST", `/streamer/streams/${streamId}/drop`, { tier: "free" });
  check("streamer drops the code", drop.status === 200 && typeof drop.json.code === "string", drop.json.code);
  check("only qualifying viewers are notified", drop.json.eligibleCount >= 1 && drop.json.eligibleCount < 2, `eligibleCount=${drop.json.eligibleCount}`);
  await sleep(300);
  check("full watcher received drop:open", full.events.some((e) => e[0] === "drop:open"));
  check("late joiner did not receive drop:open", !late.events.some((e) => e[0] === "drop:open"));
  check("drop:open payload has no code", !JSON.stringify(full.events).includes(drop.json.code));

  // Redeem rules
  const lateTry = await late.c.api("POST", `/drops/${drop.json.dropId}/redeem`, { code: drop.json.code });
  check("late joiner cannot redeem even with the right code", lateTry.status === 403, lateTry.json?.code);

  const wrong = await full.c.api("POST", `/drops/${drop.json.dropId}/redeem`, { code: "WRONG-CODE-0000" });
  check("wrong code is rejected", wrong.status === 400 && wrong.json.code === "wrong_code");

  const ok = await full.c.api("POST", `/drops/${drop.json.dropId}/redeem`, { code: drop.json.code.toLowerCase() });
  check("right code unlocks a part", ok.status === 200 && ok.json.parts.length >= 1, `owned=${ok.json?.owned}/30`);
  await sleep(300);
  check("socket pushed part:unlocked", full.events.some((e) => e[0] === "part:unlocked"));

  const again = await full.c.api("POST", `/drops/${drop.json.dropId}/redeem`, { code: drop.json.code });
  check("redeeming twice is refused", again.status === 409 && again.json.code === "already_redeemed");

  // Premium gate
  const premTpl = (await full.c.api("GET", "/catalog/characters")).json.find((t: any) => t.tier === "premium");
  const premStart = await full.c.api("POST", "/characters/start", { templateId: premTpl.id });
  check("second character needs payment", premStart.status === 402);
  const checkout = await full.c.api("POST", "/billing/checkout", {});
  check("checkout returns a url", Boolean(checkout.json?.url));
  if (checkout.json?.mock) {
    await full.c.api("GET", checkout.json.url.replace("/api", ""));
    const me = (await full.c.api("GET", "/me")).json;
    check("first monthly payment grants premium and removes ads", me.premium === true && me.showAds === false);
    check("the subscription shows one paid month", me.subscription?.active === true && me.subscription.monthsPaid === 1, `months=${me.subscription?.monthsPaid}`);
    const premStart2 = await full.c.api("POST", "/characters/start", { templateId: premTpl.id });
    check("Agamemnon starts after subscribing", premStart2.status === 200);
    await full.c.api("POST", "/billing/cancel");
    check("cancelling keeps access until the period ends", (await full.c.api("GET", "/me")).json.subscription.cancelAtPeriodEnd === true && (await full.c.api("GET", "/me")).json.premium === true);
    await full.c.api("POST", "/billing/resume");
    check("a ticket is refused before 24 paid months", (await full.c.api("POST", "/me/ticket/claim")).status === 403);
    await full.c.api("POST", "/demo/advance-subscription", { months: 23 });
    const me24 = (await full.c.api("GET", "/me")).json;
    check("24 paid months makes the ticket claimable", me24.tenure.months === 24 && me24.tenure.ticketReady === true, `months=${me24.tenure.months}`);
    const ticket = await full.c.api("POST", "/me/ticket/claim");
    check("the ticket voucher is issued", ticket.status === 200 && /^TKT-/.test(ticket.json.code));
  }

  // End the stream and check the wrap-up record in Tiger Data
  full.stop(); late.stop();
  await sleep(cfg.hbMs + 2500); // let the heartbeat writer flush
  const end = await nova.api("POST", `/streamer/streams/${streamId}/end`);
  check("stream ends and wraps up", end.status === 200 && end.json.viewers >= 2, `viewers=${end.json?.viewers}`);
  const me = (await full.c.api("GET", "/me")).json;
  check("streak counts today", me.streak >= 1, `streak=${me.streak}`);
  check("credits were awarded", me.user.credits > 0, `credits=${me.user.credits}`);

  const an = await nova.api("GET", `/streamer/streams/${streamId}/analytics`);
  check("streamer analytics come from the hypertable", an.status === 200 && an.json.series.length > 0 && an.json.uniqueViewers >= 2, `peak=${an.json?.peak} unique=${an.json?.uniqueViewers}`);

  const recs = await full.c.api("GET", "/recommendations?fresh=1");
  check("recommendations return real streams", recs.status === 200 && Array.isArray(recs.json.streams), `source=${recs.json?.source}`);


  // ---- videos: watch proof, achievements, feed, profile ----
  const DUR = 20;
  const vhb = cfg.videoHbMs;
  const vid = (await nova.api("POST", "/demo/fake-video", { title: "E2E video", durationSec: DUR })).json.id as string;
  check("test video created", Boolean(vid));
  const honest = await videoViewer(`vh${stamp}@test.dev`, "HonestViewer");
  const skipper = await videoViewer(`vs${stamp}@test.dev`, "Skipper");
  const [hAcks, sAcks] = await Promise.all([playVideo(honest, vid, "honest", DUR, vhb), playVideo(skipper, vid, "skipper", DUR, vhb)]);
  const hDone = hAcks.find((a) => a.completed);
  check("honest viewer completes the video", Boolean(hDone), `coverage=${Math.round((hAcks.at(-1)?.coverage ?? 0) * 100)}%`);
  check("completing a video awards a relic", Boolean(hDone?.award?.awarded && hDone.award.part), hDone?.award?.part?.slot);
  await sleep(300);
  check("socket pushed part:unlocked with the video as source", honest.events.some((e) => e.source?.kind === "video"));
  check("seeking ahead earns nothing", !sAcks.some((a) => a.completed) && (sAcks.at(-1)?.coverage ?? 0) < 0.3, `coverage=${Math.round((sAcks.at(-1)?.coverage ?? 0) * 100)}%`);
  const vid2 = (await nova.api("POST", "/demo/fake-video", { title: "Second video", durationSec: DUR })).json.id as string;
  // refresh the skipper's "currently watching" lock with a beat on the first video, then try a second one right away
  await new Promise((res) => skipper.socket.emit("vhb", { videoId: vid, seq: Date.now(), position: 0, state: "playing", visible: true, rate: 1 }, res));
  const parallel: any = await new Promise((res) => skipper.socket.emit("vhb", { videoId: vid2, seq: Date.now(), position: 0, state: "playing", visible: true, rate: 1 }, res));
  check("one account cannot watch two videos at once", parallel.ok === false && parallel.reason === "another_video_active", parallel.reason);
  const replay = await playVideo(honest, vid, "honest", DUR, vhb);
  check("a finished video cannot award twice", replay[0]?.completed === true && !replay[0]?.award);

  const profile = (await honest.c.api("GET", "/profile")).json;
  check("profile counts the completed video", profile.stats.videosCompleted === 1, `videosCompleted=${profile.stats.videosCompleted}`);
  check("profile lists the achievement with its source", profile.achievements.some((a: any) => a.kind === "video" && a.title === "E2E video"));
  check("profile has the full 30-relic picture", profile.characters[0]?.parts?.length === 30);

  const notes = (await honest.c.api("GET", "/notifications")).json;
  check("the relic produced a notification", notes.unread >= 1 && notes.items.some((n: any) => n.type === "relic"), `unread=${notes.unread}`);
  const t0 = Date.now();
  const feed = (await honest.c.api("GET", "/feed")).json;
  check("the feed answers fast without waiting on Gemini", Date.now() - t0 < 2500, `${Date.now() - t0}ms`);
  check("feed has live, upcoming and events", Array.isArray(feed.live) && feed.upcoming.length > 0 && feed.events.length > 0, `live=${feed.live.length} upcoming=${feed.upcoming.length} events=${feed.events.length}`);
  check("feed returns video sections", Array.isArray(feed.forYou) && Array.isArray(feed.continueWatching), `forYou=${feed.forYou.length} source=${feed.source}`);
  const setInt = await honest.c.api("PUT", "/me/interests", { interests: ["cod", "tournaments", "not-a-real-interest"] });
  check("interests are saved and unknown ones dropped", setInt.json.interests.length === 2);
  honest.socket.close(); skipper.socket.close();
  await nova.api("POST", "/demo/cleanup-fake-videos");

  // ---- abandoned streams end by themselves ----
  const stale = (await nova.api("POST", "/streamer/streams", { title: "Abandoned stream", game: "cod", platform: "demo" })).json;
  await nova.api("POST", `/streamer/streams/${stale.id}/start`);
  await sleep(2200); // the test server uses STREAM_PING_TIMEOUT_MS=1500
  const reaped = await nova.api("POST", "/demo/reap");
  const liveNow = (await nova.api("GET", "/streams")).json as any[];
  check("a stream with no streamer pings is ended by the reaper", reaped.json.reaped >= 1 && !liveNow.some((x) => x.id === stale.id && x.status === "live"), `reaped=${reaped.json?.reaped}`);

  full.socket.close(); late.socket.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
