import { mdb, q } from "./db.js";
import { emitUser } from "./realtime.js";
import { safe } from "./util.js";

export interface NotificationIn {
  type: "relic" | "live" | "event" | "system";
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

/** Stores a notification in MongoDB (each type has different fields, which suits documents) and pushes it live. */
export async function notify(userId: string, n: NotificationIn): Promise<void> {
  const doc = { userId, ...n, createdAt: new Date(), readAt: null as Date | null };
  const r = await mdb.collection("notifications").insertOne(doc);
  emitUser(userId, "notification", { id: String(r.insertedId), type: n.type, title: n.title, body: n.body ?? "", createdAt: doc.createdAt });
}

export const notifyMany = async (userIds: string[], n: NotificationIn) => {
  await Promise.all(userIds.map((id) => notify(id, n).catch((e) => console.warn("[notify]", e.message))));
};

/** Tell fans who like this game that a stream just started. Capped so one stream cannot fan out to everyone. */
export async function notifyStreamLive(opts: { streamId: string; title: string; game: string; streamer: string; excludeUserId?: string }) {
  const { rows } = await q(
    `SELECT id FROM users WHERE role = 'fan' AND (game_pref = $1 OR $1 = ANY(interests)) AND id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000') LIMIT 500`,
    [opts.game, opts.excludeUserId ?? null],
  );
  await notifyMany(rows.map((r) => r.id), { type: "live", title: `${opts.streamer} is live`, body: opts.title, data: { streamId: opts.streamId } });
}

/** Every minute: remind people who pressed "Remind me" about events starting within the hour. */
export async function sendEventReminders(): Promise<number> {
  const { rows } = await q(
    `UPDATE event_rsvps r SET reminded = true FROM events e
     WHERE r.event_id = e.id AND r.reminded = false AND e.starts_at BETWEEN now() AND now() + interval '1 hour'
     RETURNING r.user_id, e.id AS event_id, e.title, e.starts_at`,
  );
  for (const r of rows) {
    safe("reminder", notify(r.user_id, { type: "event", title: "Starting soon", body: r.title, data: { eventId: r.event_id, startsAt: r.starts_at } }));
  }
  return rows.length;
}

export const startReminderWorker = () => setInterval(() => void sendEventReminders().catch((e) => console.warn("[reminders]", e.message)), 60_000);
