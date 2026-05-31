/**
 * modelGroup — marketplace-plans (#3).
 *
 * Deterministic, table-driven mapping from a model name to a plan "group"
 * label. Plans grant access to one or more groups (or `"*"` for all). This is
 * the single place model→group classification lives; add new models here.
 */

type GroupRule = { group: string; test: (m: string) => boolean };

// Order matters: first match wins. Most-specific patterns first.
const RULES: GroupRule[] = [
  { group: "claude", test: (m) => /claude|sonnet|opus|haiku/.test(m) },
  { group: "codex", test: (m) => /^codex|^gpt-|^o3|^o4|^chatgpt/.test(m) },
  { group: "gemini", test: (m) => /gemini/.test(m) }
];

/** Curated cheap models that belong to the "free" group regardless of vendor. */
const FREE_MODELS = new Set<string>([
  "gpt-4o-mini",
  "gemini-1.5-flash",
  "gemini-2.0-flash"
]);

/** The full set of group labels this module can emit (incl. the catch-all "other"). */
export const ALL_GROUPS: string[] = [...RULES.map((r) => r.group), "free", "other"];

/** Members of the "free" group (a curated set, not derivable from the regex rules). */
export function freeModels(): string[] {
  return Array.from(FREE_MODELS);
}

/**
 * Return a stable group label for any model name. Pure and deterministic.
 * Unknown models map to "other".
 */
export function modelGroupOf(model: string): string {
  const m = (model ?? "").toLowerCase().trim();
  if (m.length === 0) return "other";
  if (FREE_MODELS.has(m)) return "free";
  for (const rule of RULES) {
    if (rule.test(m)) return rule.group;
  }
  return "other";
}

/**
 * Invert the model→group classification into group→members, for the website's
 * plan card. Classifies each model in `models` via {@link modelGroupOf} (the same
 * function enforcement uses, so it can never drift), and always seeds the `free`
 * group from the curated {@link FREE_MODELS} set — those are not derivable from
 * the regex rules and would otherwise leave a Free plan showing zero models.
 *
 * Returns every group in {@link ALL_GROUPS} (empty array when no members), so the
 * consumer gets a complete, stable shape. `"*"` is never a member here — a plan
 * granting all groups is the caller's concern.
 */
export function expandModelGroups(models: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of ALL_GROUPS) out[g] = [];
  for (const m of models) {
    const g = modelGroupOf(m);
    if (!out[g].includes(m)) out[g].push(m);
  }
  // Always include the curated free set (deduped) — independent of `models`.
  for (const fm of FREE_MODELS) {
    if (!out.free.includes(fm)) out.free.push(fm);
  }
  return out;
}

/**
 * Expand a plan's `modelGroups` into the concrete model list to display. `"*"`
 * (grant-all) returns `["*"]` verbatim — the caller renders "all models" rather
 * than enumerating. Otherwise returns the union of the granted groups' members
 * from `groupMembers` (typically the output of {@link expandModelGroups}).
 */
export function modelsForPlanGroups(
  planGroups: string[],
  groupMembers: Record<string, string[]>
): string[] {
  if (planGroups.includes("*")) return ["*"];
  const seen = new Set<string>();
  for (const g of planGroups) {
    for (const m of groupMembers[g] ?? []) seen.add(m);
  }
  return Array.from(seen);
}

/**
 * Whether a model's group is granted by a plan's group list. `"*"` in the
 * plan's groups matches every group.
 */
export function matchesGroups(group: string, planGroups: string[]): boolean {
  return planGroups.includes("*") || planGroups.includes(group);
}
