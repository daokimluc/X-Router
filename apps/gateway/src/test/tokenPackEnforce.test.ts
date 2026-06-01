import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createMarketplacePolicyCheck } from "../marketplace/policy/marketplacePolicyCheck.js";
import { WalletService } from "../marketplace/services/WalletService.js";
import { PlanService } from "../marketplace/services/PlanService.js";
import { TokenGrantService } from "../marketplace/services/TokenGrantService.js";
import { NoopPaygDecision } from "../marketplace/services/PaygDecision.js";
import { SpendLedgerService } from "../services/SpendLedgerService.js";
import { ModelPricingService } from "../services/ModelPricingService.js";
import type { InternalApiKeyRecord } from "../services/ApiKeyService.js";
import { makeTestDb } from "./helpers.js";

function makeCtx(record: Partial<InternalApiKeyRecord>, model: string | undefined, body: unknown) {
  const request = { body } as unknown as FastifyRequest;
  const reply = {} as FastifyReply;
  const full: InternalApiKeyRecord = { id: "k1", keyHash: "h1", enabled: true, createdAt: new Date(), ...record };
  return { request, reply, apiKeyHash: "h1", keyId: full.id, model, record: full };
}

describe("token pack enforcement", () => {
  let wallet: WalletService;
  let plans: PlanService;
  let ledger: SpendLedgerService;
  let pricing: ModelPricingService;
  let tokenGrants: TokenGrantService;
  let check: ReturnType<typeof createMarketplacePolicyCheck>;

  beforeEach(() => {
    const db = makeTestDb();
    wallet = new WalletService(db);
    plans = new PlanService();
    ledger = new SpendLedgerService();
    pricing = new ModelPricingService();
    tokenGrants = new TokenGrantService(db);
    check = createMarketplacePolicyCheck({
      walletService: wallet,
      planService: plans,
      spendLedgerService: ledger,
      modelPricingService: pricing,
      paygDecision: new NoopPaygDecision(),
      tokenGrantService: tokenGrants,
      getBody: (req) => req.body as never
    });
  });

  function grantPack(tokens: number, baseModel = "claude-sonnet-4-6") {
    return tokenGrants.grant({
      keyId: "k1", baseModel, tokens, pricePaidUsd: 5,
      expiresAt: Date.now() + 365 * 24 * 60 * 60_000, idempotencyKey: `id_${baseModel}_${tokens}`
    });
  }

  it("covered request reserves the pack and skips plan/wallet (allowed)", () => {
    grantPack(100_000);
    // plan-bound key, but the pack takes precedence → no plan reservation
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    const r = check(ctx);
    expect(r).toBeUndefined();
    expect(ctx.request.tokenPack).toBeDefined();
    expect(ctx.request.tokenPack?.baseModel).toBe("claude-sonnet-4-6");
    // plan bucket was NOT reserved
    expect(ctx.request.planReservation).toBeUndefined();
  });

  it("oversized request does not split — falls through to the plan path", () => {
    grantPack(10); // tiny pack
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "x".repeat(2000) }], max_tokens: 4000 });
    const r = check(ctx);
    expect(r).toBeUndefined();
    // pack NOT used; plan bucket reserved instead
    expect(ctx.request.tokenPack).toBeUndefined();
    expect(ctx.request.planReservation).toBeDefined();
    // pack balance intact
    expect(tokenGrants.findUsable("k1", "claude-sonnet-4-6")?.tokensRemaining).toBe(10);
  });

  it("expired pack falls through to the plan path", () => {
    tokenGrants.grant({
      keyId: "k1", baseModel: "claude-sonnet-4-6", tokens: 100_000, pricePaidUsd: 5,
      expiresAt: Date.now() - 1000, idempotencyKey: "expired"
    });
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    check(ctx);
    expect(ctx.request.tokenPack).toBeUndefined();
    expect(ctx.request.planReservation).toBeDefined();
  });

  it("no pack for the model → normal plan path", () => {
    grantPack(100_000, "gpt-5.5"); // pack for a different model
    const ctx = makeCtx({ planId: "plan_claude" }, "claude-sonnet-4-6", { messages: [{ content: "hi" }] });
    check(ctx);
    expect(ctx.request.tokenPack).toBeUndefined();
    expect(ctx.request.planReservation).toBeDefined();
  });
});
