import { describe, expect, it, beforeEach, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiKeyService } from "../services/ApiKeyService.js";
import { TeamService } from "../services/TeamService.js";
import { createKeyPolicyEnforcer } from "../middleware/enforceKeyPolicy.js";
import { hashApiKey } from "../utils/hash.js";

function makeRequest(overrides: { ip?: string; body?: unknown; auth?: { apiKeyHash: string } } = {}): FastifyRequest {
  return {
    ip: overrides.ip ?? "127.0.0.1",
    body: overrides.body ?? null,
    auth: overrides.auth,
    headers: {}
  } as unknown as FastifyRequest;
}

function makeReply() {
  const sent: { code?: number; payload?: unknown } = {};
  const reply = {
    code: vi.fn((c: number) => {
      sent.code = c;
      return reply;
    }),
    send: vi.fn(async (payload: unknown) => {
      sent.payload = payload;
      return reply;
    })
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

describe("enforceKeyPolicy", () => {
  let apiKeyService: ApiKeyService;
  let teamService: TeamService;
  let testKey: string;
  let testKeyHash: string;

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
    teamService = new TeamService();
    const created = apiKeyService.create({});
    testKey = created.key;
    testKeyHash = hashApiKey(testKey);
  });

  it("allows request with no restrictions", async () => {
    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBeUndefined();
  });

  it("rejects with 401 when expiresAt is in the past", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { expiresAt: new Date(Date.now() - 1000) });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBe(401);
    expect((sent.payload as { error: { code: string } }).error.code).toBe("token_expired");
  });

  it("allows request when expiresAt is in the future", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { expiresAt: new Date(Date.now() + 60_000) });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBeUndefined();
  });

  it("rejects with 403 when client IP not in single-IP allowlist", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedIps: ["10.0.0.1"] });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ ip: "192.168.1.5", auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBe(403);
    expect((sent.payload as { error: { code: string } }).error.code).toBe("ip_not_allowed");
  });

  it("rejects with 403 when client IP not in CIDR range", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedIps: ["10.0.0.0/8"] });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ ip: "192.168.1.5", auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBe(403);
  });

  it("allows request when client IP matches CIDR range", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedIps: ["10.0.0.0/8"] });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ ip: "10.5.10.20", auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBeUndefined();
  });

  it("matches IPv4-mapped IPv6 against IPv4 allowlist entry", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedIps: ["10.0.0.5"] });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ ip: "::ffff:10.0.0.5", auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBeUndefined();
  });

  it("rejects with 403 when model not in key allowedModels", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedModels: ["gpt-4o"] });

    const enforcer = createKeyPolicyEnforcer({
      apiKeyService,
      teamService,
      getModel: (req) => (req.body as { model?: string } | null)?.model
    });
    const { reply, sent } = makeReply();
    await enforcer(
      makeRequest({ body: { model: "claude-3-5-sonnet" }, auth: { apiKeyHash: testKeyHash } }),
      reply
    );
    expect(sent.code).toBe(403);
    expect((sent.payload as { error: { code: string } }).error.code).toBe("model_not_allowed_for_key");
  });

  it("allows model in key allowedModels", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedModels: ["gpt-4o"] });

    const enforcer = createKeyPolicyEnforcer({
      apiKeyService,
      teamService,
      getModel: (req) => (req.body as { model?: string } | null)?.model
    });
    const { reply, sent } = makeReply();
    await enforcer(
      makeRequest({ body: { model: "gpt-4o" }, auth: { apiKeyHash: testKeyHash } }),
      reply
    );
    expect(sent.code).toBeUndefined();
  });

  it("rejects with 403 when model not in team allowedModels", async () => {
    const team = teamService.create({ name: "test-team", enabled: true, allowedModels: ["gpt-4o"] });
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { teamId: team.id });

    const enforcer = createKeyPolicyEnforcer({
      apiKeyService,
      teamService,
      getModel: (req) => (req.body as { model?: string } | null)?.model
    });
    const { reply, sent } = makeReply();
    await enforcer(
      makeRequest({ body: { model: "claude-3-5-sonnet" }, auth: { apiKeyHash: testKeyHash } }),
      reply
    );
    expect(sent.code).toBe(403);
    expect((sent.payload as { error: { code: string } }).error.code).toBe("team_model_not_allowed");
  });

  it("rejects with 402 when balance is exhausted", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.topup(id, 10); // sets balance to 10
    apiKeyService.deductBalance(testKeyHash, 999_999); // brings to 0

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(makeRequest({ auth: { apiKeyHash: testKeyHash } }), reply);
    expect(sent.code).toBe(402);
    expect((sent.payload as { error: { code: string } }).error.code).toBe("balance_exhausted");
  });

  it("skips model check when getModel is not provided", async () => {
    const id = apiKeyService.list()[0].id;
    apiKeyService.update(id, { allowedModels: ["gpt-4o"] });

    const enforcer = createKeyPolicyEnforcer({ apiKeyService, teamService });
    const { reply, sent } = makeReply();
    await enforcer(
      makeRequest({ body: { model: "claude-3-5-sonnet" }, auth: { apiKeyHash: testKeyHash } }),
      reply
    );
    expect(sent.code).toBeUndefined();
  });
});
