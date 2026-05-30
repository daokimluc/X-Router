import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createMarketplacePolicyCheck } from "../marketplace/policy/marketplacePolicyCheck.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { PlanService } from "../marketplace/services/PlanService.js";
import { NoopPaygDecision } from "../marketplace/services/PaygDecision.js";
import { RealPaygDecision } from "../marketplace/services/RealPaygDecision.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { ModelPricingService } from "../services/ModelPricingService.js";
import type { InternalApiKeyRecord } from "../services/ApiKeyService.js";
import { makeTestDb } from "./helpers.js";

function makeCtx(record: Partial<InternalApiKeyRecord>, model: string | undefined, body: unknown) {
  const request = { body } as unknown as FastifyRequest;
  const reply = {} as FastifyReply;
  const full: InternalApiKeyRecord = {
    id: "k1",
    keyHash: "h1",
    enabled: true,
    createdAt: new Date(),
    ...record
  };
  return { request, reply, apiKeyHash: "h1", keyId: full.id, model, record: full };
}

describe("marketplace plan enforcement", () => {
  let wallet: WalletService;
  let plans: PlanService;
  let ledger: SpendLedgerService;
  let pricing: ModelPricingService;
  let check: ReturnType<typeof createMarketplacePolicyCheck>;

  beforeEach(() => {
    wallet = new WalletService(makeTestDb());
    plans = new PlanService();
    ledger = new SpendLedgerService();
    pricing = new ModelPricingService();
    check = createMarketplacePolicyCheck({
      walletService: wallet,
      planService: plans,
      spendLedgerService: ledger,
      modelPricingService: pricing,
      paygDecision: new NoopPaygDecision(),
      getBody: (req) => req.body as never
    });
  });

  it("plan-less key with empty wallet → 402 balance_exhausted", () => {
    wallet.open("k1"); // provisioned, $0
    const ctx = makeCtx({}, "gpt-4o", { messages: [] });
    const r = check(ctx);
    expect(r && (r as { httpStatus: number }).httpStatus).toBe(402);
  });

  it("plan-less key with no wallet → allowed (undefined)", () => {
    const ctx = makeCtx({}, "gpt-4o", { messages: [] });
    expect(check(ctx)).toBeUndefined();
  });

  it("plan-bound key, out-of-scope model → 403 model_not_in_plan", () => {
    const ctx = makeCtx({ planId: "plan_claude" }, "gpt-5.5", { messages: [{ content: "hi" }] });
    const r = check(ctx) as { httpStatus: number; body: { error: { code: string } } };
    expect(r.httpStatus).toBe(403);
    expect(r.body.error.code).toBe("model_not_in_plan");
  });

  it("plan-bound key, in-scope model under caps → allowed + holds reservation", () => {
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    expect(check(ctx)).toBeUndefined();
    expect(ctx.request.planReservation).toBeDefined();
  });

  it("hour cap breach → 429 with hourly Retry-After", () => {
    // plan_claude hourUsd = 0.30. Pre-spend the group bucket to the cap.
    ledger.reserve({ scope: "key:k1:grp:claude", estimateUsd: 0.30, hourCap: 0.30, dayCap: 1.2, monthCap: 20 });
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "x".repeat(400) }], max_tokens: 2000 });
    const r = check(ctx) as { httpStatus: number; headers?: Record<string, string>; body: { error: { code: string } } };
    expect(r.httpStatus).toBe(429);
    expect(r.body.error.code).toBe("spend_limit_exceeded");
    expect(Number(r.headers?.["Retry-After"])).toBeGreaterThan(0);
  });

  it("month budget exhausted, overage off → 429 (blocked)", () => {
    // Seed the group bucket so only the MONTH window is at cap (not hour/day).
    ledger.reserve({ scope: "key:k1:grp:claude", estimateUsd: 0.001, monthCap: 100 });
    const e = ledger.peek("key:k1:grp:claude");
    if (e) { e.hour = 0; e.day = 0; e.month = 20; } // plan_claude monthUsd = 20
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    const r = check(ctx) as { httpStatus: number; body: { error: { code: string } } };
    expect(r.httpStatus).toBe(429);
  });

  it("month budget exhausted, overage on → 402 payg_not_implemented (stub)", () => {
    ledger.reserve({ scope: "key:k1:grp:claude", estimateUsd: 0.001, monthCap: 100 });
    const e = ledger.peek("key:k1:grp:claude");
    if (e) { e.hour = 0; e.day = 0; e.month = 20; }
    const ctx = makeCtx({ planId: "plan_claude", overageEnabled: true }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    const r = check(ctx) as { httpStatus: number; body: { error: { code: string } } };
    expect(r.httpStatus).toBe(402);
    expect(r.body.error.code).toBe("payg_not_implemented");
  });
});

describe("boost gating (two-sided-settlement #6)", () => {
  let wallet: WalletService;
  let plans: PlanService;
  let ledger: SpendLedgerService;
  let pricing: ModelPricingService;
  let check: ReturnType<typeof createMarketplacePolicyCheck>;

  beforeEach(() => {
    wallet = new WalletService(makeTestDb());
    plans = new PlanService();
    ledger = new SpendLedgerService();
    pricing = new ModelPricingService();
    check = createMarketplacePolicyCheck({
      walletService: wallet,
      planService: plans,
      spendLedgerService: ledger,
      modelPricingService: pricing,
      paygDecision: new RealPaygDecision(wallet, ledger),
      getBody: (req) => req.body as never
    });
  });

  function preSpendHour() {
    // plan_claude hourUsd = 0.30 — fill only the hour window.
    ledger.reserve({ scope: "key:k1:grp:claude", estimateUsd: 0.001, monthCap: 100 });
    const e = ledger.peek("key:k1:grp:claude");
    if (e) { e.hour = 0.3; e.day = 0; e.month = 0; }
  }

  it("speed-limit without boost → 429 wait", () => {
    preSpendHour();
    const ctx = makeCtx({ planId: "plan_claude", overageEnabled: true }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    const r = check(ctx) as { httpStatus: number };
    expect(r.httpStatus).toBe(429);
  });

  it("speed-limit with boost + funds → charges wallet, month budget untouched", () => {
    preSpendHour();
    wallet.topupUsd("k1", 5);
    const ctx = makeCtx({ planId: "plan_claude", overageEnabled: true, boostEnabled: true }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    const monthBefore = ledger.peek("key:k1:grp:claude")?.month ?? 0;
    const r = check(ctx);
    expect(r).toBeUndefined(); // allowed via boost
    expect(ctx.request.payg?.reason).toBe("boost");
    // month budget unchanged (boost is pure wallet)
    expect(ledger.peek("key:k1:grp:claude")?.month ?? 0).toBeCloseTo(monthBefore, 6);
    // wallet reserved
    expect(wallet.getUsd("k1")).toBeLessThan(5);
  });
});
