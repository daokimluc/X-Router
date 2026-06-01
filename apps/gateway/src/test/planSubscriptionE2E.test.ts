import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

/**
 * End-to-end wiring for marketplace-plan-subscription: builds the REAL app with
 * the marketplace enabled, so the subscription service + lazy-renew policy check
 * + provision routes are wired exactly as in production (registerMarketplace).
 * Exercises subscribe/renew/downgrade through the live HTTP surface and the
 * actual registered KeyPolicyCheck (not the service in isolation).
 */

const PROV = "prov-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build() {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb", provisionApiKeys: [PROV] }));
  await app.ready();
  apps.push(app);
  return app;
}

const prov = { authorization: `Bearer ${PROV}` };

/** Run the registered marketplace policy check for a key+model, like enforceKeyPolicy does. */
function runPolicy(app: FastifyInstance, keyId: string, model: string) {
  const record = app.apiKeyService.findById(keyId)!;
  const ctx = {
    request: { body: { messages: [{ content: "hi" }] }, headers: {} } as unknown as FastifyRequest,
    reply: {} as FastifyReply,
    apiKeyHash: record.keyHash,
    keyId,
    model,
    record
  };
  // Single marketplace check is registered by registerMarketplace.
  return app.marketplaceSeam.keyPolicyChecks[0](ctx);
}

describe("plan subscription e2e (real app wiring)", () => {
  async function newFundedKey(app: FastifyInstance, usd: number) {
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer" } });
    const keyId = key.json().id as string;
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd } });
    return keyId;
  }

  it("subscribe via /provision/grant charges the wallet and sets the period", async () => {
    const app = await build();
    const keyId = await newFundedKey(app, 25);

    const grant = await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().planId).toBe("plan_claude");
    expect(grant.json().walletUsd).toBe(15);
    expect(typeof grant.json().planPeriodEnd).toBe("number");

    // exposed on the provision read surface
    const keys = await app.inject({ method: "GET", url: "/provision/keys", headers: prov });
    const entry = keys.json().keys.find((k: { id: string }) => k.id === keyId);
    expect(entry.planPeriodEnd).toBe(grant.json().planPeriodEnd);
    expect(entry.walletUsd).toBe(15);
  });

  it("underfunded subscribe → 402 insufficient_funds, plan not bound", async () => {
    const app = await build();
    const keyId = await newFundedKey(app, 4);
    const grant = await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(grant.statusCode).toBe(402);
    expect(grant.json().error.code).toBe("insufficient_funds");
    expect(app.apiKeyService.findById(keyId)!.planId).toBeUndefined();
    expect(app.walletService.getUsd(keyId)).toBe(4);
  });

  it("lazy renewal fires through the registered policy check when the period elapsed", async () => {
    const app = await build();
    const keyId = await newFundedKey(app, 25);
    await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(app.walletService.getUsd(keyId)).toBe(15);

    // force the period into the past, then run the live policy check
    app.apiKeyService.update(keyId, { planPeriodEnd: Date.now() - 1000 });
    const rejection = runPolicy(app, keyId, "claude-sonnet-4-6");
    // renewal succeeded (funded) → request allowed (no rejection), wallet charged again
    expect(rejection).toBeFalsy();
    expect(app.walletService.getUsd(keyId)).toBe(5);
    expect(app.apiKeyService.findById(keyId)!.planPeriodEnd).toBeGreaterThan(Date.now());
  });

  it("underfunded renewal downgrades to Free and rejects the triggering request 402", async () => {
    const app = await build();
    const keyId = await newFundedKey(app, 10);
    await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    expect(app.walletService.getUsd(keyId)).toBe(0); // spent the whole $10 on subscribe

    app.apiKeyService.update(keyId, { planPeriodEnd: Date.now() - 1000 });
    const rejection = runPolicy(app, keyId, "claude-sonnet-4-6") as { httpStatus: number; body: { error: { code: string } } } | undefined;
    expect(rejection?.httpStatus).toBe(402);
    expect(rejection?.body.error.code).toBe("plan_renewal_failed");
    expect(app.apiKeyService.findById(keyId)!.planId).toBeUndefined(); // downgraded to Free
  });

  it("cancel via /provision/grant planId:null unbinds and stops renewal", async () => {
    const app = await build();
    const keyId = await newFundedKey(app, 25);
    await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: "plan_claude" } });
    const cancel = await app.inject({ method: "POST", url: "/provision/grant", headers: prov, payload: { keyId, planId: null } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().planId).toBeNull();
    expect(cancel.json().planPeriodEnd).toBeNull();
    expect(app.apiKeyService.findById(keyId)!.planId).toBeUndefined();
    expect(app.walletService.getUsd(keyId)).toBe(15); // no refund
  });
});
