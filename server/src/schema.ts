// Tiger Data (Postgres + TimescaleDB). Plain statements run in order. Timescale-specific ones are
// attempted separately so the app still boots on plain Postgres (it logs which mode it is in).

export const coreSchema: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE TABLE IF NOT EXISTS streamers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL,
    platform text NOT NULL,
    channel_id text NOT NULL,
    country char(2) NOT NULL,
    followers int NOT NULL,
    is_partner boolean NOT NULL DEFAULT false,
    game text NOT NULL,
    color text NOT NULL DEFAULT '#C8102E'
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    display_name text NOT NULL,
    country char(2) NOT NULL,
    birthdate date NOT NULL,
    role text NOT NULL DEFAULT 'fan',
    streamer_id uuid REFERENCES streamers(id),
    game_pref text,
    credits int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS streams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    streamer_id uuid NOT NULL REFERENCES streamers(id),
    title text NOT NULL,
    game text NOT NULL,
    platform text NOT NULL,
    embed_id text,
    status text NOT NULL DEFAULT 'scheduled',
    scheduled_for timestamptz,
    started_at timestamptz,
    ended_at timestamptz
  )`,

  `CREATE TABLE IF NOT EXISTS character_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game text NOT NULL,
    slot_number int NOT NULL,
    tier text NOT NULL,
    name text NOT NULL,
    theme text NOT NULL,
    color text NOT NULL,
    total_parts int NOT NULL DEFAULT 30,
    UNIQUE (game, slot_number)
  )`,

  `CREATE TABLE IF NOT EXISTS parts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES character_templates(id),
    position int NOT NULL,
    slot text NOT NULL,
    rarity text NOT NULL,
    glb_key text NOT NULL,
    UNIQUE (template_id, position)
  )`,

  `CREATE TABLE IF NOT EXISTS user_characters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    template_id uuid NOT NULL REFERENCES character_templates(id),
    status text NOT NULL DEFAULT 'building',
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (user_id, template_id)
  )`,

  `CREATE TABLE IF NOT EXISTS drops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id uuid NOT NULL REFERENCES streams(id),
    code_hash text NOT NULL,
    opens_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    tier text NOT NULL DEFAULT 'free',
    parts_awarded int NOT NULL DEFAULT 1,
    elapsed_minutes int NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS drop_redemptions (
    drop_id uuid NOT NULL REFERENCES drops(id),
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (drop_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS user_parts (
    user_character_id uuid NOT NULL REFERENCES user_characters(id),
    part_id uuid NOT NULL REFERENCES parts(id),
    drop_id uuid REFERENCES drops(id),
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_character_id, part_id)
  )`,

  `CREATE TABLE IF NOT EXISTS watch_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    stream_id uuid NOT NULL REFERENCES streams(id),
    minutes_watched int NOT NULL,
    coverage real NOT NULL,
    in_final_window boolean NOT NULL,
    UNIQUE (user_id, stream_id)
  )`,

  `CREATE TABLE IF NOT EXISTS entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    kind text NOT NULL,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    source_ref text
  )`,
  `CREATE INDEX IF NOT EXISTS entitlements_user_idx ON entitlements (user_id, kind)`,

  `CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    stripe_session_id text UNIQUE NOT NULL,
    amount_cents int NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS call_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    streamer_id uuid NOT NULL REFERENCES streamers(id),
    starts_at timestamptz NOT NULL,
    duration_min int NOT NULL DEFAULT 15,
    status text NOT NULL DEFAULT 'open',
    booked_by uuid REFERENCES users(id),
    booked_at timestamptz,
    room text NOT NULL DEFAULT gen_random_uuid()::text
  )`,

  `CREATE TABLE IF NOT EXISTS heartbeats (
    time timestamptz NOT NULL,
    user_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    session_id uuid NOT NULL,
    seq int NOT NULL,
    minute_index int NOT NULL,
    player_state text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS heartbeats_stream_user_idx ON heartbeats (stream_id, user_id, minute_index)`,

  // ---- videos, achievements, events (added when the product became a video + live platform) ----
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE user_parts ADD COLUMN IF NOT EXISTS source_kind text`,
  `ALTER TABLE user_parts ADD COLUMN IF NOT EXISTS source_id uuid`,
  `ALTER TABLE user_parts ADD COLUMN IF NOT EXISTS source_title text`,

  `CREATE TABLE IF NOT EXISTS videos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_id text UNIQUE NOT NULL,
    streamer_id uuid REFERENCES streamers(id),
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    thumbnail_url text NOT NULL,
    duration_sec int NOT NULL,
    views bigint NOT NULL DEFAULT 0,
    channel_title text NOT NULL DEFAULT '',
    game text NOT NULL DEFAULT 'other',
    topics text[] NOT NULL DEFAULT '{}',
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS videos_game_idx ON videos (game, published_at DESC)`,

  `CREATE TABLE IF NOT EXISTS video_progress (
    user_id uuid NOT NULL REFERENCES users(id),
    video_id uuid NOT NULL REFERENCES videos(id),
    seconds_watched int NOT NULL DEFAULT 0,
    coverage real NOT NULL DEFAULT 0,
    last_position int NOT NULL DEFAULT 0,
    completed boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
  )`,

  `CREATE TABLE IF NOT EXISTS events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    kind text NOT NULL,
    game text NOT NULL DEFAULT 'other',
    starts_at timestamptz NOT NULL,
    location text NOT NULL DEFAULT 'Online',
    description text NOT NULL DEFAULT '',
    streamer_id uuid REFERENCES streamers(id),
    accent text NOT NULL DEFAULT '#d9a441'
  )`,
  `CREATE TABLE IF NOT EXISTS event_rsvps (
    user_id uuid NOT NULL REFERENCES users(id),
    event_id uuid NOT NULL REFERENCES events(id),
    PRIMARY KEY (user_id, event_id)
  )`,
  `ALTER TABLE streams ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''`,
  `ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hero'`,
];

// Timescale features. Each runs on its own and may fail on plain Postgres.
export const timescaleSteps: string[] = [
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `SELECT create_hypertable('heartbeats', 'time', if_not_exists => true, chunk_time_interval => INTERVAL '1 day')`,
  `CREATE MATERIALIZED VIEW IF NOT EXISTS watch_daily
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
     SELECT time_bucket('1 day', time) AS day, user_id, count(*) AS beats
     FROM heartbeats GROUP BY 1, 2
     WITH NO DATA`,
  `ALTER TABLE heartbeats SET (timescaledb.compress, timescaledb.compress_segmentby = 'user_id')`,
  `SELECT add_compression_policy('heartbeats', INTERVAL '7 days', if_not_exists => true)`,
  `SELECT add_retention_policy('heartbeats', INTERVAL '90 days', if_not_exists => true)`,
];

// Used when Timescale is not available.
export const plainFallback = `CREATE OR REPLACE VIEW watch_daily AS
  SELECT date_trunc('day', time) AS day, user_id, count(*) AS beats FROM heartbeats GROUP BY 1, 2`;
