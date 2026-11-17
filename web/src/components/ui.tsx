import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api, getSocket } from "../api";

/** Grey pulsing blocks shown while data loads, so the page keeps its shape instead of jumping. */
export function Skeleton({ h = 16, w = "100%", r = 6 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function VideoGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="vgrid" aria-busy="true" aria-label="Loading videos">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="vcard">
          <div className="thumb"><div className="skel fill" /></div>
          <Skeleton h={16} w="92%" />
          <Skeleton h={14} w="60%" />
        </div>
      ))}
    </div>
  );
}

/**
 * One button for the whole app. "primary" is filled gold (the main action on a page), "outline" is secondary.
 * While loading it stays focusable, shows a spinner, and ignores clicks, so keyboard users do not lose their place.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline"; loading?: boolean; small?: boolean };
export function Button({ variant = "primary", loading = false, small = false, className = "", children, onClick, ...rest }: ButtonProps) {
  const cls = ["btn", variant === "outline" ? "outline" : "", small ? "small" : "", className].filter(Boolean).join(" ");
  return (
    <button {...rest} className={cls} aria-busy={loading || undefined} aria-disabled={loading || rest.disabled || undefined} disabled={rest.disabled && !loading} onClick={(e) => { if (loading) return; onClick?.(e); }}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

/** A labeled progress bar for screen readers. The visible numbers go next to it. */
export function ProgressBar({ value, max, label, valueText }: { value: number; max: number; label: string; valueText: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Keyboard behavior for a menu button: Enter, Space or Down opens it, Arrow keys, Home and End move between items,
 * Escape closes it and returns focus to the button, Tab closes it and carries on from the button.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (e.key === "Tab") { setOpen(false); trigger.current?.focus(); return; }
      const list = items();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation(); // the menu's own document key handler must not also treat this press as "move to the next item"
      setOpen(true);
    }
  };
  return { open, setOpen, trigger, panel, close, onTriggerKey };
}

/** The account menu: profile, plan and sign out. */
export function AvatarMenu({ name, email, premium, onSignOut }: { name: string; email: string; premium: boolean; onSignOut: () => void }) {
  const d = useDropdown();
  const id = useId();
  return (
    <div className="menu-wrap account">
      <button
        ref={d.trigger}
        className="avatar-btn"
        aria-haspopup="menu"
        aria-expanded={d.open}
        aria-controls={d.open ? id : undefined}
        aria-label={`Account menu for ${name}`}
        onClick={() => d.setOpen((o) => !o)}
        onKeyDown={d.onTriggerKey}
      >
        <span className="avatar-circle" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        <span className="caret" aria-hidden />
      </button>
      {d.open && (
        <div id={id} ref={d.panel} className="menu" role="menu" aria-label="Account">
          <div className="menu-head">
            <strong>{name}</strong>
            <span className="muted small">{email}</span>
          </div>
          <a role="menuitem" className="menuitem" href="#/profile" onClick={() => d.close(false)}>Profile</a>
          <a role="menuitem" className="menuitem" href="#/premium" onClick={() => d.close(false)}>{premium ? "Manage plan" : "Go Premium"}</a>
          <button role="menuitem" className="menuitem" onClick={() => { d.close(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export interface Notice { id: string; type: string; title: string; body: string; createdAt: string; read: boolean; data?: Record<string, any> }
const ICON: Record<string, string> = { relic: "◈", live: "●", event: "◷", system: "i" };

const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/** The bell in the header: unread count, a list of notifications, and live updates over the socket. */
export function NotificationBell({ onOpen }: { onOpen: (n: Notice) => void }) {
  const d = useDropdown();
  const id = useId();
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);

  const load = () => api<{ unread: number; items: Notice[] }>("GET", "/notifications").then((r) => { setItems(r.items); setUnread(r.unread); }).catch(() => {});
  useEffect(() => {
    void load();
    const s = getSocket();
    const on = () => void load();
    s.on("notification", on);
    return () => { s.off("notification", on); };
  }, []);

  const markAll = async () => { await api("POST", "/notifications/read", {}); setUnread(0); setItems((l) => l.map((n) => ({ ...n, read: true }))); };

  return (
    <div className="bell menu-wrap">
      <button
        ref={d.trigger}
        className="bell-btn"
        aria-haspopup="menu"
        aria-expanded={d.open}
        aria-controls={d.open ? id : undefined}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => d.setOpen((o) => !o)}
        onKeyDown={d.onTriggerKey}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <span className="badge-n" aria-hidden>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {d.open && (
        <div id={id} ref={d.panel} className="bell-menu menu" role="menu" aria-label="Notifications">
          <div className="between bell-head">
            <strong>Notifications</strong>
            <button className="link small" onClick={markAll} disabled={unread === 0}>Mark all read</button>
          </div>
          <div className="bell-list">
            {items.length === 0 && <p className="muted small pad">Nothing yet. Relics, live streams and event reminders show up here.</p>}
            {items.map((n) => (
              <button key={n.id} role="menuitem" className={n.read ? "note" : "note unread"} onClick={() => { d.close(false); onOpen(n); }}>
                <span className={`nicon ${n.type}`} aria-hidden>{ICON[n.type] ?? "i"}</span>
                <span className="grow">
                  <strong>{n.title}</strong>
                  {!n.read && <span className="sr-only"> (unread)</span>}
                  {n.body && <span className="muted small block">{n.body}</span>}
                </span>
                <span className="muted small nowrap">{ago(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export interface Unlock { slot: string; rarity: string; owned: number; total: number; source?: string; complete?: boolean }

/** Full-screen celebration when a relic unlocks. Focus stays inside it, Escape closes it, and focus goes back afterwards. */
export function RelicModal({ unlock, onClose, onProfile }: { unlock: Unlock; onClose: () => void; onProfile: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const f = Array.from(box.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={`modal relic-modal ${unlock.rarity}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <span className="eyebrow">{unlock.complete ? "Build complete" : "Relic unlocked"}</span>
        <div className="relic-glyph" aria-hidden>◈</div>
        <h2 id={titleId}>{unlock.slot}</h2>
        <span className={`tag rarity-${unlock.rarity}`}>{unlock.rarity}</span>
        {unlock.source && <p className="muted small">For finishing "{unlock.source}"</p>}
        <ProgressBar value={unlock.owned} max={unlock.total} label="Build progress" valueText={`${unlock.owned} of ${unlock.total} relics`} />
        <span className="muted small">{unlock.owned} of {unlock.total} relics</span>
        <div className="row wrap">
          <button ref={btn} className="btn" onClick={onProfile}>See it on my build</button>
          <button className="btn outline" onClick={onClose}>Keep watching</button>
        </div>
      </div>
    </div>
  );
}

/** Copies a link to the clipboard, falling back to selecting text when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export const Icon = {
  check: (): ReactNode => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
  ),
};
