import { useEffect, useRef, useState } from "react";
import { api, type Video } from "../api";
import type { Ctx } from "../App";

interface Reply { outcome: string; sources: string[]; answer: string; videos: Video[]; streams: { id: string; title: string; streamer: string }[]; source: "gemini" | "fallback" }
interface Msg { role: "user" | "assistant"; text: string; sources?: string[]; refused?: boolean; videos?: Video[]; streams?: Reply["streams"] }

const SUGGESTIONS = ["Something funny under 10 minutes", "How do I earn my next relic?", "What is live or coming up?", "What does Premium include?"];
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;

const Spark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" /></svg>
);

export function Assistant({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); opener.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setText("");
    setBusy(true);
    try {
      const r = await api<Reply>("POST", "/assistant", { message });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, videos: r.videos, streams: r.streams, sources: r.sources, refused: ["unauthorized", "injection", "off_topic"].includes(r.outcome) }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: e?.message?.includes("Too many") ? "You are sending messages quickly. Give it a few seconds and try again." : e?.message?.includes("Invalid") ? "Please keep your question under 300 characters." : "I could not answer that just now. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => { setMsgs([]); void api("DELETE", "/assistant/history").catch(() => {}); input.current?.focus(); };
  const go = (fn: () => void) => { fn(); setOpen(false); };

  return (
    <>
      {!open && (
        <button ref={opener} className="ask-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Spark /> <span>Ask Odyssey</span>
        </button>
      )}
      {open && (
        <section className="ask" role="dialog" aria-label="Ask Odyssey, the assistant">
          <header className="ask-head">
            <span className="ask-title"><Spark /> Ask Odyssey</span>
            <span className="ask-actions">
              {msgs.length > 0 && <button className="ask-new" onClick={newChat}>New chat</button>}
            </span>
            <button className="ask-x" onClick={() => { setOpen(false); opener.current?.focus(); }} aria-label="Close assistant">×</button>
          </header>
          <div className="ask-log" ref={log} role="log" aria-live="polite" aria-label="Conversation">
            {msgs.length === 0 && (
              <div className="ask-welcome">
                <p>Hi {ctx.me.user.display_name}. I can find videos, explain how relics work, and tell you what is on.</p>
                <div className="ask-sugg">
                  {SUGGESTIONS.map((s) => <button key={s} className="ask-chip" onClick={() => void send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ask-msg me" : "ask-msg bot"}>
                <p>{m.text}</p>
                {m.sources && m.sources.length > 0 && <p className="ask-src">Based on: {m.sources.join(", ")}</p>}
                {m.streams?.map((s) => (
                  <button key={s.id} className="ask-card" onClick={() => go(() => ctx.watchStream(s.id))}>
                    <span className="ask-live">LIVE</span>
                    <span className="ask-ct"><strong>{s.title}</strong><small>{s.streamer}</small></span>
                  </button>
                ))}
                {m.videos?.map((v) => (
                  <button key={v.id} className="ask-card" onClick={() => go(() => ctx.watchVideo(v.id))}>
                    <img src={v.thumbnail_url} alt="" loading="lazy" width="96" height="54" />
                    <span className="ask-ct"><strong>{v.title}</strong><small>{v.channel_title} · {mins(v.duration_sec)}</small></span>
                  </button>
                ))}
              </div>
            ))}
            {busy && <div className="ask-msg bot" aria-busy="true"><p className="muted">Thinking…</p></div>}
          </div>
          <form className="ask-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label className="sr-only" htmlFor="ask-input">Message Ask Odyssey</label>
            <input id="ask-input" ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Ask about videos, relics, events…" autoComplete="off" />
            <button className="btn small" disabled={busy || !text.trim()}>Send</button>
          </form>
          <p className="ask-note">AI answers can be wrong. Rules on Premium and billing pages win.</p>
        </section>
      )}
    </>
  );
}
