import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

const ADMIN = "admin-key-1";
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) {
    const a = apps.pop();
    if (a) await a.close();
  }
});

async function build() {
  const app = await buildApp(testConfig({ marketplaceEnabled: true, requestBodyLimit: "1mb" }));
  await app.ready();
  apps.push(app);
  return app;
}

describe("two-sided-settlement admin wiring", () => {
  it("earnings snapshot, mark-paid, platform margin endpoints", async () => {
    const app = await build();
    // credit a seller directly via the decorated ledger
    app.sellerEarningsLedger.credit("cinb", 10);
    app.sellerEarningsLedger.recordPlatformMargin(2.5);

    const snap = await app.inject({ method: "GET", url: "/admin/v1/earnings/seller/cinb", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(snap.statusCode).toBe(200);
    expect(snap.json()).toMatchObject({ sellerId: "cinb", unpaid: 10, lifetime: 10 });

    const paid = await app.inject({ method: "POST", url: "/admin/v1/earnings/seller/cinb/mark-paid", headers: { authorization: `Bearer ${ADMIN}` }, payload: { amountUsd: 10 } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ unpaid: 0, lifetime: 10 });

    const margin = await app.inject({ method: "GET", url: "/admin/v1/earnings/platform", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(margin.json().platformMarginUsd).toBeCloseTo(2.5, 6);
  });

  it("mark-paid rejects non-positive amount", async () => {
    const app = await build();
    const res = await app.inject({ method: "POST", url: "/admin/v1/earnings/seller/x/mark-paid", headers: { authorization: `Bearer ${ADMIN}` }, payload: { amountUsd: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it("real PaygDecision is wired (decorated)", async () => {
    const app = await build();
    expect(app.paygDecision).toBeDefined();
    expect(app.sellerEarningsLedger).toBeDefined();
  });
});
