import http from "node:http";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { cfg, assertSafeConfig } from "./config.js";
import { connectAll, migrate, pool, redis, q } from "./db.js";
import { seed, seedExtras } from "./seed.js";
import { syncYoutube } from "./youtube.js";
import { attachUser } from "./auth.js";
import { HttpError } from "./util.js";
import { rateLimit } from "./ratelimit.js";
import { initRealtime, closeRealtime } from "./realtime.js";
import { startWorkers, flushHeartbeats } from "./watch.js";
import { startReaper } from "./lifecycle.js";
import { startReminderWorker } from "./notifications.js";
import { router as authRouter } from "./routes/auth.js";
import { router as streamRouter } from "./routes/stream.js";
import { router as streamerRouter } from "./routes/streamer.js";
import { router as billingRouter, stripeWebhook } from "./routes/billing.js";
import { router as callRouter } from "./routes/call.js";
import { router as recsRouter } from "./routes/recs.js";
import { router as videosRouter } from "./routes/videos.js";
import { router as feedRouter } from "./routes/feed.js";
import { router as profileRouter } from "./routes/profile.js";
import { router as notificationsRouter } from "./routes/notifications.js";
import { router as assistantRouter } from "./routes/assistant.js";

async function main() {
  // Production refuses to start with default secrets or demo mode. Development only warns.
  for (const p of assertSafeConfig()) console.warn(`[config] ${p}`);

  await connectAll();
  await migrate();
  await seed(cfg.demoMode);
  await seedExtras(cfg.demoMode);

  // First run: pull real FaZe videos (titles, thumbnails) from YouTube in the background.
  if (cfg.youtubeKey) {
    const n = (await q(`SELECT count(*)::int AS n FROM videos`)).rows[0].n as number;
    if (n === 0) syncYoutube().catch((e) => console.warn("[youtube] first sync failed:", e.message));
  } else {
    console.warn("[youtube] YOUTUBE_API_KEY is not set, so the video catalog stays empty");
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy); // set TRUST_PROXY=1 behind a load balancer so rate limits see real client IPs
  app.use(helmet());
  app.use(compression()); // JSON feeds shrink about 5x

  // Stripe needs the raw body, so this route comes before express.json().
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // CSRF: a browser request that changes data must come from our own site. Tools such as curl send no Origin and are unaffected.
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers.origin;
    if (origin && origin !== cfg.webOrigin) return res.status(403).json({ error: "Request blocked: unexpected origin" });
    next();
  });

  app.use("/api", rateLimit("api", 600, 60)); // a generous per-IP ceiling for everything; sensitive routes set their own tighter limits
  app.use("/api", attachUser);
  app.use("/api", authRouter, streamRouter, streamerRouter, billingRouter, callRouter, recsRouter, videosRouter, feedRouter, profileRouter, notificationsRouter, assistantRouter);
  app.get("/health", async (_req, res) => {
    try {
      await Promise.all([pool.query("SELECT 1"), redis.ping()]);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "Invalid input", issues: err.issues });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  const server = http.createServer(app);
  initRealtime(server);
  const timers = [startWorkers(), startReaper(), startReminderWorker()];
  server.listen(cfg.port, () => {
    console.log(`[api] http://localhost:${cfg.port}  minute=${cfg.minuteMs}ms  heartbeat=${cfg.hbMs}ms  demo=${cfg.demoMode}  prod=${cfg.isProd}`);
  });

  // Graceful shutdown: stop taking traffic, save buffered heartbeats, then exit.
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal}: shutting down`);
    timers.forEach(clearInterval);
    closeRealtime();
    server.close();
    try { await flushHeartbeats(); } catch (e) { console.error("[api] final heartbeat flush failed:", (e as Error).message); }
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start:", err.message ?? err);
  process.exit(1);
});
