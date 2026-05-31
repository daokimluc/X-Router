import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { freeModels } from "../marketplace/utils/modelGroup.js";
import { testConfig } from "./helpers.js";

const ADMIN = "admin-key-1";
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

describe("provision-plan-groups", () => {
  it("GET /provision/plans embeds expanded models per plan", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/provision/plans", headers: prov });
    expect(res.statusCode).toBe(200);
    const plans = res.json().plans as Array<{ id: string; modelGroups: string[]; models: string[] }>;

    const pro = plans.find((p) => p.modelGroups.includes("*"))!;
    expect(pro.models).toEqual(["*"]); // grant-all stays ["*"]

    const claude = plans.find((p) => p.id === "plan_claude")!;
    expect(claude.models).toContain("claude-opus-4-8");
    expect(claude.models).toContain("claude-sonnet-4-6");
    expect(claude.models).not.toContain("gpt-5.5");

    const free = plans.find((p) => p.id === "plan_free")!;
    // Free plan must NOT be empty — seeded from the curated set.
    expect(free.models.length).toBeGreaterThan(0);
    expect(free.models.sort()).toEqual(freeModels().sort());
  });

  it("GET /provision/model-groups returns the group->members map", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/provision/model-groups", headers: prov });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Record<string, string[]>;
    expect(groups.claude).toContain("claude-opus-4-8");
    expect(groups.codex).toContain("gpt-5.5");
    expect(groups.free.length).toBeGreaterThan(0);
    expect(groups.other).toEqual([]);
  });

  it("activeOnly excludes canonical models with no enabled listing", async () => {
    const app = await build();
    // No listings exist by default → activeOnly should drop all canonical members
    // (free is still seeded from the curated set, independent of listings).
    const res = await app.inject({ method: "GET", url: "/provision/model-groups?activeOnly=true", headers: prov });
    const groups = res.json().groups as Record<string, string[]>;
    expect(groups.claude).toEqual([]);
    expect(groups.codex).toEqual([]);
    expect(groups.free.length).toBeGreaterThan(0); // curated set unaffected by listings

    // Now add an approved seller + enabled listing for gpt-5.5 → it reappears.
    const seller = await app.inject({ method: "POST", url: "/provision/seller", headers: prov, payload: { displayName: "hoang" } });
    const sellerId = seller.json().seller.id;
    await app.inject({ method: "POST", url: `/provision/seller/${sellerId}/approve`, headers: prov });
    await app.inject({ method: "POST", url: "/provision/listing", headers: prov, payload: { sellerId, baseModel: "gpt-5.5", costPrice: { inputPerM: 2, outputPerM: 6 }, providerInstanceId: "provider_kiro_main", providerAccountId: "a1" } });

    const res2 = await app.inject({ method: "GET", url: "/provision/model-groups?activeOnly=true", headers: prov });
    expect((res2.json().groups as Record<string, string[]>).codex).toContain("gpt-5.5");
  });

  it("admin/client key is rejected on both endpoints", async () => {
    const app = await build();
    for (const url of ["/provision/plans", "/provision/model-groups"]) {
      const admin = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${ADMIN}` } });
      expect(admin.statusCode).toBe(401);
      const client = await app.inject({ method: "GET", url, headers: { authorization: "Bearer dev-key-1" } });
      expect(client.statusCode).toBe(401);
    }
  });
});
