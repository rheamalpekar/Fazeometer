import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { parse } from "cookie";
import { cfg } from "./config.js";
import { redis } from "./db.js";
import { verifyToken } from "./auth.js";
import { handleHeartbeat } from "./watch.js";
import { handleVideoBeat } from "./videoWatch.js";

let io: Server | undefined;

const MAX_SOCKETS_PER_USER = 8;
const MAX_EVENTS_PER_SECOND = 20;

export function initRealtime(http: HttpServer) {
  io = new Server(http, {
    cors: { origin: cfg.webOrigin, credentials: true },
    maxHttpBufferSize: 100_000,
  });

  // With the Redis adapter every API instance sees every room, so a relic unlock reaches the fan
  // whichever instance their socket is connected to.
  io.adapter(createAdapter(redis.duplicate({ lazyConnect: false }), redis.duplicate({ lazyConnect: false })));

  io.use(async (socket, next) => {
    const cookies = parse(socket.handshake.headers.cookie ?? "");
    const uid = cookies.token ? verifyToken(cookies.token) : null;
    if (!uid) return next(new Error("unauthenticated"));
    try {
      const open = await io!.in(`user:${uid}`).fetchSockets();
      if (open.length >= MAX_SOCKETS_PER_USER) return next(new Error("too_many_connections"));
    } catch {
      /* if the count fails, let the connection through */
    }
    socket.data.userId = uid;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // A flood of events from one socket is dropped, so one misbehaving client cannot load the server.
    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      return ++count <= MAX_EVENTS_PER_SECOND;
    };
    const reply = (ack: unknown, value: unknown) => typeof ack === "function" && ack(value);

    // Heartbeats ride the open socket. The REST redeem call, not a socket event, is what grants parts.
    socket.on("hb", (payload, ack) => {
      if (!allowed()) return reply(ack, { ok: false, reason: "rate_limited" });
      handleHeartbeat(userId, payload).then((r) => reply(ack, r)).catch(() => reply(ack, { ok: false, reason: "error" }));
    });
    socket.on("vhb", (payload, ack) => {
      if (!allowed()) return reply(ack, { ok: false, reason: "rate_limited" });
      handleVideoBeat(userId, payload)
        .then((r) => reply(ack, r))
        .catch((e) => { console.error("[vhb]", e); reply(ack, { ok: false, reason: "error" }); });
    });
  });
  return io;
}

export const emitUser = (userId: string, event: string, payload: unknown) => io?.to(`user:${userId}`).emit(event, payload);
export const emitAll = (event: string, payload: unknown) => io?.emit(event, payload);
export const closeRealtime = () => io?.close();
