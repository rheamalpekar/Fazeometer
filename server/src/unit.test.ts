import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword, passwordProblem } from "./password.js";
import { normalizeCode, hashCode, safeEqual, makeCode, ageOf } from "./util.js";
import { countBits } from "./watch.js";
import { extractVideoId, parseDuration, classify } from "./youtube.js";
import { MIGRATIONS } from "./migrations.js";
import { SHIP_SLOTS, HERO_SLOTS, TEMPLATES, rarityOf } from "./catalogData.js";

describe("passwords", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterz", h)).toBe(false);
  });
  it("never accepts when there is no stored hash", async () => {
    expect(await verifyPassword("anything at all", null)).toBe(false);
    expect(await verifyPassword("anything at all", "not-a-hash")).toBe(false);
  });
  it("salts every hash differently", async () => {
    expect(await hashPassword("same password 1")).not.toBe(await hashPassword("same password 1"));
  });
  it("enforces the password policy", () => {
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("password12345")).toBeTruthy();
    expect(passwordProblem("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordProblem("a good long passphrase")).toBeNull();
  });
});

describe("secret codes", () => {
  it("normalizes case and spaces before hashing", () => {
    expect(normalizeCode(" troy-lotus 4821 ")).toBe("TROY-LOTUS4821");
    expect(hashCode("troy-lotus-4821")).toBe(hashCode("TROY-LOTUS-4821"));
    expect(hashCode("TROY-LOTUS-4821")).not.toBe(hashCode("TROY-LOTUS-4822"));
  });
  it("generates WORD-WORD-NNNN codes", () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
  });
  it("compares in constant time and by value", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("ageOf", () => {
  it("counts whole years", () => {
    const y = new Date().getUTCFullYear();
    expect(ageOf(`${y - 20}-01-01`)).toBeGreaterThanOrEqual(19);
    expect(ageOf(`${y - 5}-12-31`)).toBeLessThanOrEqual(5);
  });
});

describe("watch coverage bitmap", () => {
  it("counts set bits in a range, MSB first like Redis SETBIT", () => {
    const buf = Buffer.from([0b10110000, 0b01000000]); // bits 0,2,3 and 9
    expect(countBits(buf, 0, 8)).toBe(3);
    expect(countBits(buf, 0, 16)).toBe(4);
    expect(countBits(buf, 2, 4)).toBe(2);
    expect(countBits(buf, 9, 10)).toBe(1);
  });
  it("treats missing data as zero", () => {
    expect(countBits(null, 0, 100)).toBe(0);
    expect(countBits(Buffer.from([0xff]), 0, 64)).toBe(8); // only 8 real bits
  });
});

describe("youtube helpers", () => {
  it("extracts ids from every URL shape", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=5")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects things that are not YouTube videos", () => {
    expect(extractVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractVideoId("not a link")).toBeNull();
  });
  it("parses ISO 8601 durations", () => {
    expect(parseDuration("PT10M11S")).toBe(611);
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("PT45S")).toBe(45);
    expect(parseDuration("garbage")).toBe(0);
  });
  it("classifies game and topics from the title", () => {
    expect(classify("FaZe Vegas Wins the CDL Grand Finals", []).game).toBe("cod");
    expect(classify("Fortnite Zero Build Highlights", []).topics).toContain("highlights");
    expect(classify("Cooking with friends", []).game).toBe("other");
  });
});

describe("catalog and migrations", () => {
  it("has two builds of exactly 30 unique relics each", () => {
    expect(SHIP_SLOTS).toHaveLength(30);
    expect(HERO_SLOTS).toHaveLength(30);
    expect(new Set(SHIP_SLOTS).size).toBe(30);
    expect(TEMPLATES.map((t) => t.tier)).toEqual(["free", "premium"]);
    expect(TEMPLATES[0].kind).toBe("ship");
  });
  it("makes the last relics the rarest", () => {
    expect(rarityOf(1)).toBe("common");
    expect(rarityOf(30)).toBe("legendary");
  });
  it("has unique, ordered migration ids", () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("production config safety", () => {
  const load = async (env: Record<string, string>) => {
    vi.resetModules();
    const keep = { ...process.env };
    for (const k of ["JWT_SECRET", "CODE_SECRET", "DEMO_MODE", "NODE_ENV", "WEB_ORIGIN"]) delete process.env[k];
    Object.assign(process.env, env);
    const mod = await import("./config.js");
    process.env = keep;
    return mod;
  };
  const strong = "x".repeat(40);

  it("refuses to start in production with default secrets", async () => {
    const { assertSafeConfig } = await load({ NODE_ENV: "production", WEB_ORIGIN: "https://odyssey.example" });
    expect(() => assertSafeConfig()).toThrow(/JWT_SECRET/);
  });
  it("refuses demo mode in production", async () => {
    const { assertSafeConfig } = await load({ NODE_ENV: "production", JWT_SECRET: strong, CODE_SECRET: strong, DEMO_MODE: "1", WEB_ORIGIN: "https://odyssey.example" });
    expect(() => assertSafeConfig()).toThrow(/DEMO_MODE/);
  });
  it("refuses a non-https origin in production", async () => {
    const { assertSafeConfig } = await load({ NODE_ENV: "production", JWT_SECRET: strong, CODE_SECRET: strong, WEB_ORIGIN: "http://odyssey.example" });
    expect(() => assertSafeConfig()).toThrow(/https/);
  });
  it("accepts a safe production config", async () => {
    const { assertSafeConfig, cfg } = await load({ NODE_ENV: "production", JWT_SECRET: strong, CODE_SECRET: strong, WEB_ORIGIN: "https://odyssey.example" });
    expect(assertSafeConfig()).toEqual([]);
    expect(cfg.cookieSecure).toBe(true);
  });
  it("only warns in development", async () => {
    const { assertSafeConfig } = await load({});
    expect(assertSafeConfig().length).toBeGreaterThan(0);
  });
});
