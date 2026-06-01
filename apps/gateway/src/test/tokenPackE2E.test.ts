import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

/**
 * End-to-end wiring for marketplace-token-packs: real app, marketplace on, full
 * registerMarketplace path. Exercises the grant endpoint + read surface + the
 * registered policy check consuming a pack ahead of the wallet.
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

function runPolicy(app: FastifyInstance, keyId: string, model: string) {
  const record = app.apiKeyService.findById(keyId)!;
  const ctx = {
    request: { body: { messages: [{ content: "hi" }] }, headers: {} } as unknown as FastifyRequest,
    reply: {} as FastifyReply,
    apiKeyHash: record.keyHash, keyId, model, record
  };
  const rejection = app.marketplaceSeam.keyPolicyChecks[0](ctx);
  return { rejection, request: ctx.request };
}

describe("token packs e2e (real app wiring)", () => {
  async function newKey(app: FastifyInstance) {
    const key = await app.inject({ method: "POST", url: "/provision/key", headers: prov, payload: { label: "buyer" } });
    return key.json().id as string;
  }
  const future = Date.now() + 365 * 24 * 60 * 60_000;

  it("grants a pack idempotently and lists it on the read surface", async () => {
    const app = await build();
    const keyId = await newKey(app);

    const body = { keyId, baseModel: "claude-sonnet-4-6", tokens: 1_000_000, pricePaidUsd: 5, expiresAt: future, idempotencyKey: "ord_1" };
    const g1 = await app.inject({ method: "POST", url: "/provision/token-pack", headers: prov, payload: body });
    expect(g1.statusCode).toBe(200);
    expect(g1.json().grant.tokensRemaining).toBe(1_000_000);

    // idempotent retry → same grant, no double
    const g2 = await app.inject({ method: "POST", url: "/provision/token-pack", headers: prov, payload: body });
    expect(g2.json().grant.id).toBe(g1.json().grant.id);

    const list = await app.inject({ method: "GET", url: `/provision/token-packs?keyId=${keyId}`, headers: prov });
    expect(list.json().tokenPacks).toHaveLength(1);

    const keys = await app.inject({ method: "GET", url: "/provision/keys", headers: prov });
    const entry = keys.json().keys.find((k: { id: string }) => k.id === keyId);
    expect(entry.tokenPacks[0].baseModel).toBe("claude-sonnet-4-6");
    expect(entry.tokenPacks[0].tokensRemaining).toBe(1_000_000);
  });

  it("rejects a pack with a past expiry (400) and an unknown key (404)", async () => {
    const app = await build();
    const keyId = await newKey(app);
    const past = await app.inject({ method: "POST", url: "/provision/token-pack", headers: prov, payload: { keyId, baseModel: "gpt-5.5", tokens: 100, pricePaidUsd: 1, expiresAt: Date.now() - 1000, idempotencyKey: "x" } });
    expect(past.statusCode).toBe(400);
    const ghost = await app.inject({ method: "POST", url: "/provision/token-pack", headers: prov, payload: { keyId: "nope", baseModel: "gpt-5.5", tokens: 100, pricePaidUsd: 1, expiresAt: future, idempotencyKey: "y" } });
    expect(ghost.statusCode).toBe(404);
  });

  it("a covered request consumes the pack via the registered policy check, not the wallet", async () => {
    const app = await build();
    const keyId = await newKey(app);
    await app.inject({ method: "POST", url: "/provision/wallet/topup", headers: prov, payload: { keyId, usd: 10 } });
    await app.inject({ method: "POST", url: "/provision/token-pack", headers: prov, payload: { keyId, baseModel: "claude-sonnet-4-6", tokens: 1_000_000, pricePaidUsd: 5, expiresAt: future, idempotencyKey: "ord_2" } });

    const { rejection, request } = runPolicy(app, keyId, "claude-sonnet-4-6");
    expect(rejection).toBeFalsy();
    expect(request.tokenPack).toBeDefined();
    // wallet still full — pack covered the request
    expect(app.walletService.getUsd(keyId)).toBe(10);
  });
});
