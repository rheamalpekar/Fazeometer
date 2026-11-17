import { useEffect, useState } from "react";
import { api, type Template } from "../api";
import type { Ctx } from "../App";

const dateOf = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export function Premium({ ctx }: { ctx: Ctx }) {
  const { me, cfg } = ctx;
  const sub = me.subscription;
  const active = Boolean(sub?.active);
  const price = (cfg.priceCents / 100).toFixed(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Template[]>("GET", "/catalog/characters").then(setTemplates).catch(() => {}); }, []);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); await ctx.refresh(); if (done) ctx.toast(done); } catch (e: any) { ctx.toast(e.message); } finally { setBusy(false); }
  };
  const subscribe = () => run(async () => { const r = await api<{ url: string }>("POST", "/billing/checkout", {}); window.location.href = r.url; });
  const portal = () => run(async () => { const r = await api<{ url: string }>("POST", "/billing/portal"); window.location.href = r.url; });
  const claim = () => run(async () => { const r = await api<{ code: string }>("POST", "/me/ticket/claim"); ctx.toast(`Ticket voucher: ${r.code}`); });
  const start = (id: string) => run(async () => { await api("POST", "/characters/start", { templateId: id }); ctx.go("profile"); });

  const premiumTemplates = templates.filter((t) => t.tier === "premium");
  const months = me.tenure.months;
  const target = me.tenure.targetMonths;

  return (
    <div className="stack">
      <div className="premium-grid">
        <section className="panel plan plan-main">
          <span className="eyebrow">Premium</span>
          <div className="price"><strong>${price}</strong><span className="muted">/ month</span></div>
          <ul className="checks">
            <li>Agamemnon, a second 30-relic build</li>
            <li>Premium-only drops in live streams</li>
            <li>No ads anywhere in the app</li>
            <li>{target} paid months earns a free regional tournament ticket</li>
            <li>Cancel any time. You keep access until the month you paid for ends.</li>
          </ul>

          {!sub && (
            <>
              <button className="btn" disabled={busy} onClick={subscribe}>Subscribe for ${price}/month</button>
              <p className="muted small">{cfg.stripe ? "You will pay on Stripe's secure page." : cfg.demoMode ? "Stripe is not configured, so this uses a local demo checkout." : "Payments are not set up yet."}</p>
            </>
          )}

          {sub && (
            <div className="stack tight">
              <div className="row wrap">
                <span className={active ? (sub.cancelAtPeriodEnd ? "tag" : "tag ok") : "tag live"}>{active ? (sub.cancelAtPeriodEnd ? "Ending" : "Active") : "Ended"}</span>
                <span className="small">
                  {active
                    ? sub.cancelAtPeriodEnd ? `Access until ${dateOf(sub.currentPeriodEnd)}. It will not renew.` : `Renews on ${dateOf(sub.currentPeriodEnd)}.`
                    : `Your plan ended on ${dateOf(sub.currentPeriodEnd)}.`}
                </span>
              </div>
              {sub.status === "past_due" && <p className="error small">Your last payment failed. Update your card to keep premium.</p>}
              <div className="row wrap">
                {!active && <button className="btn" disabled={busy} onClick={subscribe}>Subscribe again</button>}
                {active && !sub.cancelAtPeriodEnd && !confirmCancel && <button className="btn ghost" onClick={() => setConfirmCancel(true)}>Cancel plan</button>}
                {active && !sub.cancelAtPeriodEnd && confirmCancel && (
                  <>
                    <span className="small">Cancel at the end of this month?</span>
                    <button className="btn small" disabled={busy} onClick={() => run(() => api("POST", "/billing/cancel"), "Your plan will end at the close of this month.").then(() => setConfirmCancel(false))}>Yes, cancel</button>
                    <button className="btn small ghost" onClick={() => setConfirmCancel(false)}>Keep it</button>
                  </>
                )}
                {active && sub.cancelAtPeriodEnd && <button className="btn" disabled={busy} onClick={() => run(() => api("POST", "/billing/resume"), "Your plan will keep renewing.")}>Keep my plan</button>}
                {cfg.stripe && <button className="btn ghost" disabled={busy} onClick={portal}>Manage billing</button>}
              </div>
            </div>
          )}
        </section>

        <div className="premium-side">
        <section className="panel plan">
          <span className="eyebrow">Loyalty</span>
          <h2>Free regional tournament ticket</h2>
          <div className="bar"><div style={{ width: `${Math.min(100, (months / target) * 100)}%` }} /></div>
          <span className="small">{months} of {target} paid months</span>
          {me.tenure.ticketCode ? (
            <p>Your voucher: <code>{me.tenure.ticketCode}</code></p>
          ) : (
            <button className="btn" disabled={!me.tenure.ticketReady || busy} onClick={claim}>{me.tenure.ticketReady ? "Claim your ticket" : `${target - months} months to go`}</button>
          )}
          {cfg.demoMode && sub && <button className="btn small ghost" disabled={busy} onClick={() => run(() => api("POST", "/demo/advance-subscription", { months: 12 }), "Added 12 demo months.")}>Demo: add 12 paid months</button>}
        </section>
        <section className="row-sec">
          <h2>Your second build</h2>
          <div className="vgrid">
            {premiumTemplates.map((t) => {
              const have = me.characters.some((c) => c.template_id === t.id);
              return (
                <div key={t.id} className="card" style={{ borderTopColor: t.color }}>
                  <span className="tag">Premium build</span>
                  <strong>{t.name}</strong>
                  <span className="muted small">{t.theme}</span>
                  <button className="btn small" disabled={have || !active || busy} onClick={() => start(t.id)}>{have ? "Started" : active ? "Start building" : "Needs an active plan"}</button>
                </div>
              );
            })}
          </div>
        </section>
        </div>
      </div>

    </div>
  );
}
