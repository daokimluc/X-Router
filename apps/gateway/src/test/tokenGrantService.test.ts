import { describe, expect, it, beforeEach } from "vitest";
import { TokenGrantService } from "../marketplace/services/TokenGrantService.js";
import { Database } from "../services/Database.js";
import { makeTestDb } from "./helpers.js";

const HOUR = 60 * 60_000;

function future(now: number): number {
  return now + 365 * 24 * HOUR; // ~12 months
}

describe("TokenGrantService", () => {
  let now: number;
  let svc: TokenGrantService;

  beforeEach(() => {
    now = Date.UTC(2026, 5, 1, 12, 0, 0, 0);
    svc = new TokenGrantService(makeTestDb(), { now: () => now });
  });

  function grant(over: Partial<Parameters<TokenGrantService["grant"]>[0]> = {}) {
    return svc.grant({
      keyId: "k1",
      baseModel: "gpt-5.5",
      tokens: 1000,
      pricePaidUsd: 5,
      expiresAt: future(now),
      idempotencyKey: "ord_1",
      ...over
    });
  }

  it("issues a grant with full remaining balance", () => {
    const g = grant();
    expect(g.tokensTotal).toBe(1000);
    expect(g.tokensRemaining).toBe(1000);
    expect(g.pricePaidUsd).toBe(5);
  });

  it("is idempotent on idempotencyKey — second call returns the same grant, no double credit", () => {
    const a = grant();
    const b = grant({ tokens: 9999 }); // different tokens, same idempotencyKey
    expect(b.id).toBe(a.id);
    expect(b.tokensTotal).toBe(1000); // original, not 9999
    expect(svc.listForKey("k1")).toHaveLength(1);
  });

  it("findUsable picks the un-expired pack with most remaining", () => {
    grant({ idempotencyKey: "a", tokens: 100 });
    grant({ idempotencyKey: "b", tokens: 5000 });
    const u = svc.findUsable("k1", "gpt-5.5");
    expect(u?.tokensRemaining).toBe(5000);
  });

  it("findUsable skips expired packs", () => {
    grant({ idempotencyKey: "exp", expiresAt: now - 1 });
    expect(svc.findUsable("k1", "gpt-5.5")).toBeNull();
  });

  it("findUsable returns null for a different base model", () => {
    grant();
    expect(svc.findUsable("k1", "claude-sonnet-4-6")).toBeNull();
  });

  it("reserve underfunded → ok:false, no decrement", () => {
    const g = grant({ tokens: 100 });
    const r = svc.reserve({ grantId: g.id, estTokens: 500 });
    expect(r.ok).toBe(false);
    expect(svc.findUsable("k1", "gpt-5.5")?.tokensRemaining).toBe(100);
  });

  it("reserve + settle decrements by the ACTUAL token count", () => {
    const g = grant({ tokens: 1000 });
    const r = svc.reserve({ grantId: g.id, estTokens: 800 });
    expect(r.ok).toBe(true);
    // after reserve, remaining dropped by the estimate
    expect(svc.listForKey("k1")[0].tokensRemaining).toBe(200);
    if (r.ok) svc.settle(r.reservationId, 300); // actual < estimate → refund 500
    expect(svc.listForKey("k1")[0].tokensRemaining).toBe(700);
  });

  it("release restores the full reserved estimate", () => {
    const g = grant({ tokens: 1000 });
    const r = svc.reserve({ grantId: g.id, estTokens: 400 });
    if (r.ok) svc.release(r.reservationId);
    expect(svc.listForKey("k1")[0].tokensRemaining).toBe(1000);
  });

  it("concurrent reserves cannot both take the last tokens", () => {
    const g = grant({ tokens: 100 });
    const r1 = svc.reserve({ grantId: g.id, estTokens: 80 });
    const r2 = svc.reserve({ grantId: g.id, estTokens: 80 });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false); // only 20 left
  });

  it("settle floors remaining at zero when actual exceeds the held estimate", () => {
    const g = grant({ tokens: 100 });
    const r = svc.reserve({ grantId: g.id, estTokens: 100 });
    if (r.ok) svc.settle(r.reservationId, 150); // actual > est → would go negative
    expect(svc.listForKey("k1")[0].tokensRemaining).toBe(0);
  });

  it("double-settle is a no-op (unknown reservation id)", () => {
    const g = grant({ tokens: 100 });
    const r = svc.reserve({ grantId: g.id, estTokens: 50 });
    // settle(actual 50) consumes the held 50 (remaining 50); the second settle
    // finds no reservation and must NOT decrement again.
    if (r.ok) { svc.settle(r.reservationId, 50); svc.settle(r.reservationId, 50); }
    expect(svc.listForKey("k1")[0].tokensRemaining).toBe(50);
  });
});

describe("Database v6 migration", () => {
  it("creates the token_grants table on a fresh DB at schema v6", () => {
    const db = new Database(":memory:");
    const version = (db.db.prepare("SELECT version FROM schema_meta LIMIT 1").get() as { version: number }).version;
    expect(version).toBe(6);
    const tbl = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='token_grants'").get();
    expect(tbl).toBeDefined();
    db.close();
  });
});

