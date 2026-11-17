const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const minuteMs = num(process.env.MINUTE_MS, 60000);
const isProd = process.env.NODE_ENV === "production";

const DEV_JWT = "dev-jwt-secret";
const DEV_CODE = "dev-code-secret";

export const cfg = {
  isProd,
  port: num(process.env.PORT, 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  pgUrl: process.env.DATABASE_URL ?? "postgres://faze:faze@localhost:55432/faze",
  mongoUrl: process.env.MONGO_URL ?? "mongodb://localhost:47017",
  mongoDb: "faze",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:56379",
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT,
  codeSecret: process.env.CODE_SECRET ?? DEV_CODE,
  cookieSecure: isProd,
  trustProxy: process.env.TRUST_PROXY === "1",

  demoMode: process.env.DEMO_MODE === "1",

  // Watch proof settings. See the architecture page, section "Proving someone watched".
  minuteMs,
  hbMs: Math.round(minuteMs / 2),
  minCoverage: num(process.env.MIN_COVERAGE, 0.8),
  finalWindowMin: num(process.env.FINAL_WINDOW_MIN, 5),
  finalWindowShare: 0.6, // at least 3 of the last 5 minutes
  dropWindowMin: num(process.env.DROP_WINDOW_MIN, 10),
  maxRedeemAttempts: 5,
  longStreamMinutes: 60, // a drop on a stream this long awards 2 parts

  // Premium is a monthly subscription. Two years of paid months earns a regional ticket.
  priceCents: 500,
  tenureMonths: 24,
  creditsPerDrop: 10,

  stripeKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  geminiMaxPerMinute: num(process.env.GEMINI_MAX_PER_MIN, 30),
  youtubeKey: process.env.YOUTUBE_API_KEY ?? "",


  // Video watch proof: playback is sampled every videoHbMs and credited in buckets of videoBucketSec.
  videoHbMs: num(process.env.VIDEO_HB_MS, 5000),
  videoBucketSec: 5,
  videoMinCoverage: 0.85,
  videoPartsPerDay: num(process.env.VIDEO_PARTS_PER_DAY, 3),
  videoMinSec: 30,
  videoMaxSec: 1800,
  videoDbWriteMs: 20000, // progress is saved to Postgres at most this often per viewer and video

  // Live streams end on their own if the streamer's Studio stops pinging.
  streamPingTimeoutMs: num(process.env.STREAM_PING_TIMEOUT_MS, 5 * 60000),
  streamMaxHours: num(process.env.STREAM_MAX_HOURS, 12),

  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitSecret: process.env.LIVEKIT_API_SECRET ?? "",
};

/**
 * Refuses to start a production server that would be unsafe. Called once at boot.
 * In development it only warns, so a fresh clone still runs.
 */
export function assertSafeConfig(): string[] {
  const problems: string[] = [];
  if (cfg.jwtSecret === DEV_JWT || cfg.jwtSecret.length < 32) problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  if (cfg.codeSecret === DEV_CODE || cfg.codeSecret.length < 32) problems.push("CODE_SECRET must be set to a random value of at least 32 characters");
  if (cfg.demoMode) problems.push("DEMO_MODE must be off (it enables passwordless demo logins and test endpoints)");
  if (cfg.isProd && !cfg.webOrigin.startsWith("https://")) problems.push("WEB_ORIGIN must be an https URL");
  if (cfg.isProd && problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join("\n - ")}`);
  return problems; // dev: caller logs these as warnings
}
