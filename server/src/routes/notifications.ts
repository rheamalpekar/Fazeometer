import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { mdb } from "../db.js";
import { requireAuth } from "../auth.js";
import { rateLimit } from "../ratelimit.js";

export const router = Router();

router.get("/notifications", requireAuth, rateLimit("notif", 120, 60, true), async (req, res) => {
  const col = mdb.collection("notifications");
  const [items, unread] = await Promise.all([
    col.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(30).toArray(),
    col.countDocuments({ userId: req.user!.id, readAt: null }),
  ]);
  res.json({
    unread,
    items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body ?? "", data: n.data ?? {}, createdAt: n.createdAt, read: n.readAt !== null })),
  });
});

router.post("/notifications/read", requireAuth, async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().length(24)).max(100).optional() }).parse(req.body ?? {});
  const filter: Record<string, unknown> = { userId: req.user!.id, readAt: null };
  if (ids?.length) filter._id = { $in: ids.map((i) => new ObjectId(i)) };
  const r = await mdb.collection("notifications").updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ marked: r.modifiedCount });
});
