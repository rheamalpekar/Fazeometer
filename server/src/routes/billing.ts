import crypto from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { pool, q } from "../db.js";
import { cfg } from "../config.js";
import { requireAuth } from "../auth.js";
import { HttpError } from "../util.js";
import { rateLimit } from "../ratelimit.js";

export const router = Router();
const stripe = cfg.stripeKey ? new Stripe(cfg.stripeKey) : null;

const DAY = 86400000;

export interface PaidPeriod {
  userId: string;
  periodEnd: Date;
  invoiceId: string; // unique per payment: makes retries and duplicate webhooks harmless
  amountCents: number;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}

/**
 * Records one paid month. The payment, the subscription row and the entitlements change in ONE transaction,
 * so a crash can never leave someone charged but without access. Returns false if this invoice was already applied.
 */
export async function applyPaidPeriod(p: PaidPeriod): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const pay = await c.query(
      `INSERT INTO payments (user_id, stripe_session_id, amount_cents, status) VALUES ($1,$2,$3,'paid') ON CONFLICT (stripe_session_id) DO NOTHING RETURNING id`,
      [p.userId, p.invoiceId, p.amountCents],
    );
    if (!pay.rowCount) {
      await c.query("ROLLBACK");
      return false;
    }
    await c.query(
      `INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end, months_paid)
       VALUES ($1,$2,$3,'active',$4,1)
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'active',
         current_period_end = GREATEST(subscriptions.current_period_end, EXCLUDED.current_period_end),
         months_paid = subscriptions.months_paid + 1,
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
         updated_at = now()`,
      [p.userId, p.stripeSubscriptionId ?? null, p.stripeCustomerId ?? null, p.periodEnd],
    );
    for (const kind of ["premium", "ad_free"]) {
      await c.query(
        `INSERT INTO entitlements (user_id, kind, valid_from, valid_to, source_ref) VALUES ($1,$2, now(), $3, $4)
         ON CONFLICT (user_id, kind) DO UPDATE SET valid_to = GREATEST(entitlements.valid_to, EXCLUDED.valid_to), source_ref = EXCLUDED.source_ref`,
        [p.userId, kind, p.periodEnd, p.invoiceId],
      );
    }
    await c.query("COMMIT");
    return true;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function userForSubscription(subId: string): Promise<string | null> {
  const r = await q(`SELECT user_id FROM subscriptions WHERE stripe_subscription_id=$1`, [subId]);
  if (r.rows[0]) return r.rows[0].user_id;
  if (!stripe) return null;
  const sub = await stripe.subscriptions.retrieve(subId); // the first invoice can arrive before our row exists
  return sub.metadata?.userId ?? null;
}

// ---- customer actions ----
router.post("/billing/checkout", requireAuth, rateLimit("checkout", 10, 3600, true), async (req, res) => {
  const user = req.user!;
  if (stripe) {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cfg.priceCents,
            recurring: { interval: "month" },
            product_data: { name: "FaZe Odyssey Premium (monthly)" },
          },
        },
      ],
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      customer_email: user.email,
      success_url: `${cfg.webOrigin}/#/premium?paid=1`,
      cancel_url: `${cfg.webOrigin}/#/premium?paid=0`,
    });
    return res.json({ url: session.url, mock: false });
  }
  if (!cfg.demoMode) throw new HttpError(503, "Payments are not set up yet", "payments_unavailable");
  // Demo mode without a Stripe key: a local mock so the whole flow can be shown.
  res.json({ url: `/api/billing/mock-complete?session=mock_${crypto.randomUUID()}`, mock: true });
});

router.get("/billing/mock-complete", requireAuth, async (req, res) => {
  if (stripe || !cfg.demoMode) throw new HttpError(404, "Not found");
  const sessionId = z.string().startsWith("mock_").parse(req.query.session);
  await applyPaidPeriod({ userId: req.user!.id, periodEnd: new Date(Date.now() + 30 * DAY), invoiceId: sessionId, amountCents: cfg.priceCents, stripeSubscriptionId: `mock_sub_${req.user!.id}` });
  res.redirect("/#/premium?paid=1");
});

router.post("/billing/cancel", requireAuth, async (req, res) => {
  await setCancel(req.user!.id, true);
  res.json({ ok: true });
});
router.post("/billing/resume", requireAuth, async (req, res) => {
  await setCancel(req.user!.id, false);
  res.json({ ok: true });
});

async function setCancel(userId: string, cancel: boolean) {
  const sub = (await q(`SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1`, [userId])).rows[0];
  if (!sub) throw new HttpError(404, "You do not have a subscription");
  if (stripe && sub.stripe_subscription_id && !String(sub.stripe_subscription_id).startsWith("mock_")) {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: cancel });
  }
  await q(`UPDATE subscriptions SET cancel_at_period_end=$2, updated_at=now() WHERE user_id=$1`, [userId, cancel]);
}

// Stripe's own page for changing the card or viewing invoices.
router.post("/billing/portal", requireAuth, async (req, res) => {
  if (!stripe) throw new HttpError(400, "Billing portal needs Stripe");
  const sub = (await q(`SELECT stripe_customer_id FROM subscriptions WHERE user_id=$1`, [req.user!.id])).rows[0];
  if (!sub?.stripe_customer_id) throw new HttpError(404, "No billing account yet");
  const s = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${cfg.webOrigin}/#/premium` });
  res.json({ url: s.url });
});

// ---- Stripe webhooks. Mounted with express.raw in index.ts so the signature can be verified. ----
export async function stripeWebhook(req: Request, res: Response) {
  if (!stripe || !cfg.stripeWebhookSecret) return res.status(404).end();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] as string, cfg.stripeWebhookSecret);
  } catch {
    return res.status(400).send("bad signature");
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.metadata?.userId;
        if (userId && typeof s.subscription === "string") {
          // Months are counted only from paid invoices. This just links the Stripe ids.
          await q(
            `UPDATE subscriptions SET stripe_subscription_id=$2, stripe_customer_id=$3 WHERE user_id=$1`,
            [userId, s.subscription, typeof s.customer === "string" ? s.customer : null],
          );
        }
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object as any;
        const subId: string | undefined = inv.subscription ?? inv.parent?.subscription_details?.subscription;
        const end: number | undefined = inv.lines?.data?.[0]?.period?.end;
        if (!subId || !end) break;
        const userId = await userForSubscription(subId);
        if (userId) {
          await applyPaidPeriod({
            userId,
            periodEnd: new Date(end * 1000),
            invoiceId: inv.id,
            amountCents: inv.amount_paid ?? cfg.priceCents,
            stripeSubscriptionId: subId,
            stripeCustomerId: typeof inv.customer === "string" ? inv.customer : null,
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as any;
        const subId: string | undefined = inv.subscription ?? inv.parent?.subscription_details?.subscription;
        if (subId) await q(`UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1`, [subId]);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        await q(`UPDATE subscriptions SET cancel_at_period_end=$2, updated_at=now() WHERE stripe_subscription_id=$1`, [sub.id, Boolean(sub.cancel_at_period_end)]);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        await q(`UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_subscription_id=$1`, [sub.id]);
        break;
      }
    }
  } catch (err) {
    console.error("[stripe webhook]", event.type, (err as Error).message);
    return res.status(500).send("handler failed"); // Stripe retries, and applyPaidPeriod is idempotent
  }
  res.json({ received: true });
}

// ---- loyalty ticket: 24 paid months ----
router.post("/me/ticket/claim", requireAuth, async (req, res) => {
  const u = req.user!;
  const months = ((await q(`SELECT months_paid FROM subscriptions WHERE user_id=$1`, [u.id])).rows[0]?.months_paid ?? 0) as number;
  if (months < cfg.tenureMonths) throw new HttpError(403, `Tickets unlock after ${cfg.tenureMonths} paid months (you are at ${months})`, "too_early");
  const code = `TKT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  await q(
    `INSERT INTO entitlements (user_id, kind, source_ref) VALUES ($1,'ticket_voucher',$2) ON CONFLICT (user_id, kind) DO NOTHING`,
    [u.id, code],
  );
  const row = (await q(`SELECT source_ref FROM entitlements WHERE user_id=$1 AND kind='ticket_voucher'`, [u.id])).rows[0];
  res.json({ code: row.source_ref });
});

// Demo helper: pretend N more monthly renewals happened, so the 24-month ticket can be shown.
router.post("/demo/advance-subscription", requireAuth, async (req, res) => {
  if (!cfg.demoMode) throw new HttpError(404, "Not found");
  const { months } = z.object({ months: z.number().int().min(1).max(24) }).parse(req.body);
  const sub = (await q(`SELECT current_period_end FROM subscriptions WHERE user_id=$1`, [req.user!.id])).rows[0];
  if (!sub) throw new HttpError(400, "Subscribe first");
  let end = new Date(Math.max(Date.now(), new Date(sub.current_period_end).getTime()));
  for (let i = 0; i < months; i++) {
    end = new Date(end.getTime() + 30 * DAY);
    await applyPaidPeriod({ userId: req.user!.id, periodEnd: end, invoiceId: `mock_renewal_${crypto.randomUUID()}`, amountCents: cfg.priceCents });
  }
  res.json({ ok: true });
});
