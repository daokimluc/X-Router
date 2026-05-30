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
 * Whether a model's group is granted by a plan's group list. `"*"` in the
 * plan's groups matches every group.
 */
export function matchesGroups(group: string, planGroups: string[]): boolean {
  return planGroups.includes("*") || planGroups.includes(group);
}
