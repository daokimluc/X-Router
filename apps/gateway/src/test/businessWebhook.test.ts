import { describe, expect, it } from "vitest";
import { WebhookService } from "../services/WebhookService.js";
import { createHmac } from "node:crypto";

describe("WebhookService.notifyBusiness (provision-webhook #7)", () => {
  it("signs the exact body with HMAC-SHA256 under the secret", async () => {
    const svc = new WebhookService();
    svc.updateBusinessConfig({ enabled: true, url: "https://example.test/hook", secret: "s3cr3t", events: [] });

    let captured: { body: string; sig: string | null } | null = null;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      captured = { body: String(init.body), sig: headers.get("X-Provision-Signature") };
      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      await svc.notifyBusiness("usage.recorded", { sellerId: "cinb", actualSellCost: 0.006 });
    } finally {
      globalThis.fetch = orig;
    }

    expect(captured).not.toBeNull();
    const expected = "sha256=" + createHmac("sha256", "s3cr3t").update(captured!.body).digest("hex");
    expect(captured!.sig).toBe(expected);
    const payload = JSON.parse(captured!.body);
    expect(payload.event).toBe("usage.recorded");
    expect(payload.data.sellerId).toBe("cinb");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("does not POST when disabled or event not subscribed", async () => {
    const svc = new WebhookService();
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { called++; return new Response("", { status: 200 }); }) as typeof fetch;
    try {
      // disabled
      await svc.notifyBusiness("usage.recorded", {});
      // enabled but event not in subscription list
      svc.updateBusinessConfig({ enabled: true, url: "https://x.test", secret: "k", events: ["wallet.low"] });
      await svc.notifyBusiness("usage.recorded", {});
    } finally {
      globalThis.fetch = orig;
    }
    expect(called).toBe(0);
  });

  it("swallows delivery failure", async () => {
    const svc = new WebhookService();
    svc.updateBusinessConfig({ enabled: true, url: "https://x.test", secret: "k", events: [] });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      await expect(svc.notifyBusiness("usage.recorded", {})).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
