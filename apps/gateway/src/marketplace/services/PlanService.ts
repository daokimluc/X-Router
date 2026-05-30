/**
 * PlanService — marketplace-plans (#3).
 *
 * Holds the platform's `Plan` presets: a named bundle of model-group scope +
 * hour/day/month spend buckets + overage policy that a buyer subscribes to. The
 * website drives real billing; x-router stores the plan and binds it to keys.
 *
 * Seeded with free/claude/codex/pro defaults on first run; persisted admin edits
 * are never clobbered by re-seeding.
 */

export type PlanBuckets = {
  hourUsd: number;
  dayUsd: number;
  monthUsd: number;
};

export type Plan = {
  id: string;
  name: string;
  /** Informational; the website handles real billing. */
  priceUsd: number;
  /** Model groups this plan grants. `["*"]` = all groups. */
  modelGroups: string[];
  buckets: PlanBuckets;
  /** Plan default for overage; a key may override. */
  overageEnabled: boolean;
  /** Optional plan default PAYG wallet daily limit (USD); a key may override. */
  paygDailyLimitUsd?: number;
};

export type PersistedPlans = {
  plans: Plan[];
};

function seedPlans(): Plan[] {
  return [
    { id: "plan_free", name: "Free", priceUsd: 0, modelGroups: ["free"], buckets: { hourUsd: 0.02, dayUsd: 0.05, monthUsd: 0.5 }, overageEnabled: false },
    { id: "plan_claude", name: "Claude $10", priceUsd: 10, modelGroups: ["claude"], buckets: { hourUsd: 0.3, dayUsd: 1.2, monthUsd: 20 }, overageEnabled: false },
    { id: "plan_codex", name: "Codex $10", priceUsd: 10, modelGroups: ["codex"], buckets: { hourUsd: 0.3, dayUsd: 1.2, monthUsd: 20 }, overageEnabled: false },
    { id: "plan_pro", name: "Pro $20", priceUsd: 20, modelGroups: ["*"], buckets: { hourUsd: 0.6, dayUsd: 2.4, monthUsd: 40 }, overageEnabled: false }
  ];
}

export class PlanService {
  private readonly plans = new Map<string, Plan>();
  private onPersist?: () => void;

  constructor() {
    for (const p of seedPlans()) this.plans.set(p.id, p);
  }

  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  list(): Plan[] {
    return Array.from(this.plans.values()).map((p) => structuredClone(p));
  }

  get(id: string): Plan | undefined {
    const p = this.plans.get(id);
    return p ? structuredClone(p) : undefined;
  }

  create(input: Omit<Plan, "id"> & { id?: string }): Plan {
    const id = input.id?.trim() || `plan_${Date.now().toString(36)}`;
    const plan: Plan = {
      id,
      name: input.name,
      priceUsd: input.priceUsd,
      modelGroups: input.modelGroups.length > 0 ? input.modelGroups : ["*"],
      buckets: input.buckets,
      overageEnabled: input.overageEnabled,
      paygDailyLimitUsd: input.paygDailyLimitUsd
    };
    this.plans.set(id, plan);
    this.onPersist?.();
    return structuredClone(plan);
  }

  update(id: string, patch: Partial<Omit<Plan, "id">>): Plan | null {
    const plan = this.plans.get(id);
    if (!plan) return null;
    if (patch.name !== undefined) plan.name = patch.name;
    if (patch.priceUsd !== undefined) plan.priceUsd = patch.priceUsd;
    if (patch.modelGroups !== undefined) plan.modelGroups = patch.modelGroups;
    if (patch.buckets !== undefined) plan.buckets = patch.buckets;
    if (patch.overageEnabled !== undefined) plan.overageEnabled = patch.overageEnabled;
    if (patch.paygDailyLimitUsd !== undefined) plan.paygDailyLimitUsd = patch.paygDailyLimitUsd ?? undefined;
    this.onPersist?.();
    return structuredClone(plan);
  }

  delete(id: string): boolean {
    const ok = this.plans.delete(id);
    if (ok) this.onPersist?.();
    return ok;
  }

  toPersisted(): PersistedPlans {
    return { plans: this.list() };
  }

  /**
   * Restore persisted plans. When a non-empty set is present it REPLACES the
   * seeds (admin edits win); when empty/absent the seeds remain.
   */
  load(state: PersistedPlans | undefined | null): void {
    if (!state || !Array.isArray(state.plans) || state.plans.length === 0) return;
    this.plans.clear();
    for (const p of state.plans) this.plans.set(p.id, structuredClone(p));
  }
}
