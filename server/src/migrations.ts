import type { PoolClient } from "pg";
import { coreSchema } from "./schema.js";
import { TEMPLATES } from "./catalogData.js";
import { mdb } from "./db.js";

/**
 * Ordered, one-time migrations. Each runs in its own transaction and is recorded in schema_migrations,
 * so it never runs twice. Never edit an applied migration. Add a new one at the end.
 */
export interface Migration {
  id: string;
  run: (c: PoolClient) => Promise<void>;
}

const ddl = (...statements: string[]) => async (c: PoolClient) => {
  for (const s of statements) await c.query(s);
};

export const MIGRATIONS: Migration[] = [
  {
    // The original schema. Every statement is idempotent, so this is also safe on databases created before migrations existed.
    id: "001_baseline",
    run: ddl(...coreSchema),
  },
  {
    id: "002_auth",
    run: ddl(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uq ON users (google_sub) WHERE google_sub IS NOT NULL`,
    ),
  },
  {
    id: "003_subscriptions_and_stream_keepalive",
    run: ddl(
      // one row per (user, kind) so a renewal updates the same entitlement
      `DELETE FROM entitlements a USING entitlements b WHERE a.user_id = b.user_id AND a.kind = b.kind AND a.ctid < b.ctid`,
      `CREATE UNIQUE INDEX IF NOT EXISTS entitlements_user_kind_uq ON entitlements (user_id, kind)`,
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL UNIQUE REFERENCES users(id),
        stripe_subscription_id text UNIQUE,
        stripe_customer_id text,
        status text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        current_period_end timestamptz NOT NULL,
        cancel_at_period_end boolean NOT NULL DEFAULT false,
        months_paid int NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `ALTER TABLE streams ADD COLUMN IF NOT EXISTS last_ping_at timestamptz`,
      `ALTER TABLE streams ADD COLUMN IF NOT EXISTS keepalive boolean NOT NULL DEFAULT false`,
      `CREATE INDEX IF NOT EXISTS streams_live_idx ON streams (status) WHERE status = 'live'`,
    ),
  },
  {
    // One-time data change: databases from before the ship and Agamemnon builds still hold the old four templates.
    // It only touches databases that have templates this code does not know about, and it is recorded so it never runs again.
    // Renaming a template in code later will NOT wipe anyone's relics.
    id: "004_ship_and_agamemnon_templates",
    run: async (c) => {
      const known = TEMPLATES.map((t) => t.name);
      const old = (await c.query(`SELECT count(*)::int AS n FROM character_templates WHERE name <> ALL($1::text[])`, [known])).rows[0].n as number;
      if (old === 0) return;
      await c.query(`DELETE FROM user_parts`);
      await c.query(`DELETE FROM user_characters`);
      await c.query(`DELETE FROM parts`);
      await c.query(`DELETE FROM character_templates`);
      await mdb.collection("part_meta").deleteMany({});
      console.log("[migrate] replaced the old character templates with the ship and Agamemnon");
    },
  },
  {
    id: "005_event_reminders",
    run: ddl(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS reminded boolean NOT NULL DEFAULT false`),
  },
  {
    id: "006_stream_cover_art",
    run: ddl(`ALTER TABLE streams ADD COLUMN IF NOT EXISTS thumbnail_url text`),
  },
];
