import { describe, expect, it, vi, beforeEach } from "vitest";

// A tiny in-memory stand-in for the Redis commands the limiter uses.
const store = vi.hoisted(() => new Map<string, { n: number; expires: number }>());

vi.mock("./db.js", () => ({
  redis: {
    incr: async (k: string) => {
      const now = Date.now();
      const e = store.get(k);
      if (!e || e.expires <= now) { store.set(k, { n: 1, expires: Infinity }); return 1; }
      e.n++;
      return e.n;
    },
    expire: async (k: string, s: number) => { const e = store.get(k); if (e) e.expires = Date.now() + s * 1000; },
    ttl: async (k: string) => { const e = store.get(k); return e ? Math.max(1, Math.ceil((e.expires - Date.now()) / 1000)) : -2; },
  },
}));

import { hit } from "./ratelimit.js";

describe("rate limiter", () => {
  beforeEach(() => store.clear());

  it("allows up to the limit and then blocks", async () => {
    for (let i = 0; i < 3; i++) expect((await hit("t1", 3, 60)).allowed).toBe(true);
    const blocked = await hit("t1", 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts different keys separately", async () => {
    await hit("a", 1, 60);
    expect((await hit("a", 1, 60)).allowed).toBe(false);
    expect((await hit("b", 1, 60)).allowed).toBe(true);
  });

  it("reports how many requests are left", async () => {
    expect((await hit("c", 5, 60)).remaining).toBe(4);
    expect((await hit("c", 5, 60)).remaining).toBe(3);
  });
});
