# FaZe Odyssey

A video and live-stream platform for FaZe fans. Streamers post videos and go live. Fans watch on the platform, get a personalized feed, and earn the 30 relics of a 3D Odyssey ship by finishing videos and live streams. The ship and every achievement live on the fan's profile. A $5 monthly plan unlocks a second build, Agamemnon, premium-only drops and no ads, and 24 paid months earns a regional tournament ticket.

Architecture page: https://claude.ai/artifact/C4qpdtruij6CfY95UNtfnR (written before the video and feed pivot, so it still describes live streams only)

## What is in it

- **Feed (home):** live now, coming up, events with "Remind me", a "For you" row ranked by Gemini from interests and watch history, continue watching, search (press `/`), and browse filters. Real thumbnails and titles from the YouTube Data API.
- **Videos:** streamers post a YouTube link and the title, thumbnail and length are fetched automatically. Fans watch in an embedded player, and a relic unlocks at 85% watched.
- **Live streams:** streamers go live from the Studio. Fans watch to the end and type the secret code the streamer says.
- **Profile:** the 3D build, the 30 relic slots, achievements that name the video or stream behind each relic, stats, watch history, interests.
- **Builds:** free is the Trireme of Ithaca (a Greek war galley). The monthly plan unlocks Agamemnon, King of Mycenae.
- **Notifications:** a bell with relic unlocks, "streamer is live" and event reminders, stored in MongoDB and pushed live.
- **Studio (streamers):** go live, drop the code, post videos and events, and per-stream analytics (viewers per minute from the Tiger Data hypertable).
- **Every page has a link,** so Back, refresh and sharing work (`#/video/:id`, `#/profile`, `#/premium`, `#/studio`).

## Stack

| Layer | What |
| --- | --- |
| Web | React 18, TypeScript, Vite, React Three Fiber (Three.js, split into its own lazy chunk), YouTube IFrame API |
| API | Node, Express 5, Socket.io with the Redis adapter, helmet, zod |
| SQL | Tiger Data (Postgres + TimescaleDB): users, videos, progress, relics, subscriptions, `heartbeats` hypertable, `watch_daily` continuous aggregate |
| NoSQL | MongoDB: notifications, part metadata, streamer profiles, surveys, recommendation log, audit events |
| Cache | Redis (append-only, so it survives a restart): coverage bitmaps, session locks, rate limits, cached feed picks |
| AI | Gemini API with model fallback, a global call budget and a rules-based fallback |
| Video data | YouTube Data API v3 |

## Run it

Needs Node 20+ and Docker.

```bash
npm install
npm run db:up        # Tiger Data :55432, MongoDB :47017, Redis :56379
cp .env.example server/.env
npm run dev          # API on :4000, web on :5173
```

`npm run dev` uses Vite's development server, which loads dozens of separate files and runs every effect twice, so it feels slower than the real app. For demos, and for judging speed, use the optimized build instead:

```bash
npm run demo         # builds the web app, then serves it on :5173 with the API on :4000
```

Put your keys in `server/.env` (git-ignored): `YOUTUBE_API_KEY` fills the video catalog on first start, and `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) turns on Gemini ranking. If Docker restarts and the containers are gone, run `npm run db:up` again. Data lives in named volumes.

**Accounts.** Sign up with an email and a password (10+ characters). In demo mode (`DEMO_MODE=1`, the default in `.env.example`) the landing page shows buttons that log in as the three demo streamers without a password. Those accounts and that endpoint do not exist when demo mode is off. To make a real account a streamer:

```bash
npm run make-streamer -w server -- someone@example.com "NovaStrike"
```

## Two-minute demo

1. Sign up on the landing page, pick interests on Home, and launch your ship on Profile.
2. Open a video and press play. The relic meter fills as it really plays, and a relic pops up at 85%.
3. In a second window sign in as **NovaStrike**, open **Studio**, go live, wait a minute, press **Drop the code**.
4. In the first window open the stream under "Live now", and type the code when the banner appears.
5. Open the bell, then **Premium** to subscribe (demo checkout) and see Agamemnon, the renewal date and the 24-month ticket bar.

`MINUTE_MS=10000` makes a stream "minute" 10 seconds. Set `60000` for real time.

## Security and operations

- **Sign-in:** scrypt-hashed passwords, per-IP and per-email throttling, the same response time whether or not an account exists, 7-day session cookie (`httpOnly`, `sameSite=lax`, `secure` in production).
- **No guessable accounts:** streamer login accounts exist only in demo mode.
- **Production guard:** with `NODE_ENV=production` the server refuses to start on default secrets, with demo mode on, or with a non-https `WEB_ORIGIN`. Generate secrets with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Rate limits** (Redis): login, signup, checkout, feed, search, notifications, plus a global per-IP ceiling. Set `TRUST_PROXY=1` behind a load balancer.
- **CSRF:** data-changing requests from a browser must come from `WEB_ORIGIN`. Helmet headers and a 100 kB body limit are on.
- **Payments:** every paid month (payment, subscription row and entitlements) is one database transaction, keyed by invoice id, so retries and duplicate webhooks are harmless. Cancelling keeps access until the paid month ends.
- **Migrations:** ordered, recorded in `schema_migrations`, one transaction each. Never edit an applied one. Renaming a template in code no longer touches anyone's relics.
- **Reliability:** abandoned streams end by themselves (the Studio pings every 30 seconds), buffered heartbeats retry and flush on shutdown, a video can be watched on one video at a time per account, and video progress is written to Postgres at most every 20 seconds.
- **Scale:** the Socket.io Redis adapter lets several API instances share real-time events (`scripts/multi-instance-check.ts` proves it). The feed never waits on Gemini: it answers with the SQL ranking and refines in the background.

## Design system and accessibility

All redesign styling lives in `web/src/theme.css`, loaded last so it wins over the older sheets.

- **Tokens:** colors, spacing, radii and the 64px header are CSS variables on `:root`. Type is Barlow Semi Condensed for headings and Inter for body (16px minimum).
- **Buttons:** one gold primary per view, outlined secondary, link-style tertiary; every control has a 44px target and a visible `#8BCBFF` focus ring.
- **Layout:** the Home hero is the featured live stream beside the Voyage card, then Coming up and Events with a single time-zone label. Under 900px the nav collapses into a Menu panel. Content reflows at 320px.
- **Semantics:** skip link, landmarks, one `h1` per page, route-aware document titles, focus moved to `#main` on navigation, ARIA menus with Arrow/Home/End/Escape, progress bars with `role="progressbar"`, and a polite live region for toasts such as event reminders.
- **States:** loading skeletons, empty ("No one is live right now"), per-section error with Try again, an app-level "can't reach Odyssey" screen, and a branded fallback when a stream has no artwork. Streamers can paste an https cover-art link in the Studio.

## Ask Odyssey (Gemini assistant)

A floating chat on every page (`web/src/components/Assistant.tsx`, `POST /api/assistant`). It finds videos ("something funny under 10 minutes"), explains how relics work, and says what is live or coming up.

- **Fixed outcomes, acted on in backend code** (`server/src/assistantGuard.ts`, `routes/assistant.ts`): the model classifies each message as answer, clarify, off-topic, mixed, missing-info, unauthorized or injection, and the backend returns the fixed refusal or message for that outcome. Mixed questions get the supported part answered plus a short decline.
- **No model needed for the hard rules:** requests for other people's data, keys or admin access, and bare "ignore your instructions" attacks, are refused by regex before any model call.
- **Grounded and checked:** the model sees only trusted FACTS (numbered rules) and this fan's own data. A factual answer must list the fact ids it used; the backend drops unknown ids, and an answer with no valid basis becomes "I couldn't verify that". Recommended video and stream ids must come from the candidate list. The answer is scrubbed of links, markup and anything that looks like prompt or key leakage. The UI shows "Based on: ..." under each answer.
- **Untrusted input kept apart:** instructions go in Gemini's system instruction; the user message, chat history and every video title live in the request body marked untrusted (a video titled "ignore all rules" was tested and ignored).
- **Per-account memory:** chat history is stored server-side in Redis (last 6 messages, 1 hour) so a client cannot forge earlier turns and accounts never share a chat. "New chat" clears it.
- **Cost and reliability:** 300-character messages, 12 a minute and 200 a day per account, 12-second timeout, 400 output tokens, 10 candidate videos, plus the global Gemini budget and circuit breaker. If Gemini is down the endpoint returns plain catalog search.
- **Logging:** one JSON line per request with outcome, milliseconds, token counts and message length, never the message or answer text.
- **Public data only:** the assistant has no tools and no access to other accounts, payments or credentials. If private documents were added later, retrieval would filter by the signed-in user's permissions in the SQL query, never in the prompt.
- Keep the `RULES` in `server/src/assistantGuard.ts` in step with the product.

## Tests

```bash
npm test -w server          # 31 unit tests: passwords, codes, coverage bitmap, YouTube helpers, config guard, rate limiter
```

```bash
MINUTE_MS=1000 VIDEO_HB_MS=1000 STREAM_PING_TIMEOUT_MS=1500 DISABLE_RATE_LIMITS=1 DEMO_MODE=1 PORT=4001 npm run start -w server   # fast clocks
API=http://localhost:4001 npm run e2e                                                                                         # in another terminal
```

The e2e script has 56 checks across sign-in security, the live-stream spine, the monthly plan, video watch proof, notifications, analytics and the stale-stream reaper.

## What is real and what is a stand-in

| Piece | State |
| --- | --- |
| Auth, feed, YouTube catalog, video and stream watch proof, relics, achievements, notifications, subscriptions (mock checkout), analytics | Real and covered by tests |
| Stripe subscription code (checkout, webhooks, portal, cancel) | Written to Stripe's subscription API but **not run against Stripe**: only the demo checkout was tested |
| Google sign-in, email verification, CAPTCHA | **Not built.** Password sign-in is the only method, and signup is limited to 5 accounts per hour per IP |
| Live streams | Demo streams are simulated. A streamer can attach a YouTube live id, but there is no RTMP ingest |
| Video catalog | Search results from YouTube shown under an invented "FaZe Clan" channel. Needs content review and a rights decision before launch |
| 3D | Built from basic shapes. Swap in `.glb` models at `parts.glb_key` |
| Video call | Booking and join tokens are real. The room is a local camera preview. The company handles calls outside the app |
| Not built | Web push and email, parental consent for under-18 users, anti-farming beyond the limits above |

## Layout

```
server/src
  index.ts            app, security middleware, routes, workers, graceful shutdown
  config.ts           settings and the production safety guard
  migrations.ts       ordered one-time migrations         password.ts  scrypt hashing
  ratelimit.ts        Redis rate limiter                  lifecycle.ts  stream wrap-up and the reaper
  videoWatch.ts       video watch proof and relic award   watch.ts      live-stream heartbeats
  recommend.ts        SQL ranking + Gemini refinement     notifications.ts  MongoDB notifications
  routes/             auth, feed, videos, profile, stream, streamer (studio), billing, call, recs, notifications
server/scripts        e2e.ts, multi-instance-check.ts, make-streamer.ts
web/src
  pages/              Landing, Home, Profile, WatchVideo, WatchStream, Premium, Call, Streamer
  components/         cards.tsx (videos, streams, events), ui.tsx (bell, popup, skeletons)
```

