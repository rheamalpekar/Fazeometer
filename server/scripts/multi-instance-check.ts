/**
 * Proves real-time events cross API instances (the Socket.io Redis adapter).
 * Start two servers on ports 4000 and 4001 with the same database, Redis and secrets, then run:
 *   npx tsx scripts/multi-instance-check.ts
 * A fan connects to instance B, a streamer goes live on instance A, and the fan must receive stream:live.
 */
import { io as connect } from "socket.io-client";

const A = process.env.A ?? "http://localhost:4000";
const B = process.env.B ?? "http://localhost:4001";
const PASSWORD = "Multi-instance-1234!";

async function call(base: string, method: string, path: string, body?: unknown, cookie = "") {
  const r = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get("set-cookie");
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json, cookie: set ? set.split(";")[0] : cookie };
}

const email = `multi${Date.now()}@test.dev`;
const fan = await call(B, "POST", "/auth/signup", { email, password: PASSWORD, displayName: "MultiFan", country: "US", birthdate: "2000-05-05", game: "cod" });
if (fan.status !== 200) throw new Error(`signup failed: ${JSON.stringify(fan.json)}`);

const socket = connect(B, { extraHeaders: { cookie: fan.cookie }, transports: ["websocket"] });
await new Promise<void>((res, rej) => { socket.on("connect", () => res()); socket.on("connect_error", rej); });
const got = new Promise<boolean>((res) => {
  socket.on("stream:live", () => res(true));
  setTimeout(() => res(false), 5000);
});

const nova = await call(A, "POST", "/auth/demo-login", { email: "nova@faze.dev" });
const created = await call(A, "POST", "/streamer/streams", { title: "Cross-instance check", game: "cod", platform: "demo" }, nova.cookie);
await call(A, "POST", `/streamer/streams/${created.json.id}/start`, undefined, nova.cookie);

const ok = await got;
console.log(ok ? "PASS  a stream:live event emitted on instance A reached a socket on instance B" : "FAIL  the event did not cross instances");
await call(A, "POST", `/streamer/streams/${created.json.id}/end`, undefined, nova.cookie);
socket.close();
process.exit(ok ? 0 : 1);
