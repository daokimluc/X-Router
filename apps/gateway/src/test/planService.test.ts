import { describe, expect, it } from "vitest";
import { PlanService } from "../marketplace/services/PlanService.js";

describe("PlanService", () => {
  it("seeds the four default plans, pro is wildcard", () => {
    const svc = new PlanService();
    const ids = svc.list().map((p) => p.id).sort();
    expect(ids).toEqual(["plan_claude", "plan_codex", "plan_free", "plan_pro"]);
    expect(svc.get("plan_pro")?.modelGroups).toEqual(["*"]);
    expect(svc.get("plan_claude")?.modelGroups).toEqual(["claude"]);
  });

  it("CRUD: create, update, delete", () => {
    const svc = new PlanService();
    const created = svc.create({
      name: "Enterprise",
      priceUsd: 100,
      modelGroups: ["claude", "codex"],
      buckets: { hourUsd: 1, dayUsd: 10, monthUsd: 200 },
      overageEnabled: true
    });
    expect(svc.get(created.id)?.name).toBe("Enterprise");

    svc.update(created.id, { buckets: { hourUsd: 2, dayUsd: 20, monthUsd: 400 } });
    expect(svc.get(created.id)?.buckets.monthUsd).toBe(400);

    expect(svc.delete(created.id)).toBe(true);
    expect(svc.get(created.id)).toBeUndefined();
  });

  it("persistence round-trip; admin edits survive reload (seeds not re-applied)", () => {
    const svc = new PlanService();
    svc.update("plan_claude", { buckets: { hourUsd: 0.3, dayUsd: 1.2, monthUsd: 25 } });
    const persisted = svc.toPersisted();

    const svc2 = new PlanService();
    svc2.load(persisted);
    expect(svc2.get("plan_claude")?.buckets.monthUsd).toBe(25); // not reset to seed (20)
    expect(svc2.list()).toHaveLength(4);
  });

  it("empty persisted state keeps the seeds", () => {
    const svc = new PlanService();
    svc.load({ plans: [] });
    expect(svc.list()).toHaveLength(4);
    svc.load(null);
    expect(svc.list()).toHaveLength(4);
  });
});
