/**
 * Static `baseModel → context window` table, maintained on the website side.
 *
 * X-Router does NOT expose context window per canonical model (it lives in
 * adapter capabilities per provider type), and it is a static model attribute,
 * not a measured metric — so per ANSWERS_FROM_XROUTER_METRICS.md mục 5, Foza
 * owns this table. Keys are matched loosely by family so minor version bumps
 * (e.g. claude-opus-4-8 vs claude-opus-4-6) don't need a new entry.
 *
 * Returns a display label (e.g. "200K") or null when unknown — the card shows
 * "—" for null rather than guessing.
 */

// Exact canonical names first; family fallbacks (substring) handle versions.
const EXACT: Record<string, number> = {
  // tokens of context window
  "gpt-5.5": 400_000,
  "gpt-5.4": 272_000,
  "claude-opus-4-8": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4.6": 200_000,
  "gemini-3.1-pro": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "deepseek-3.2": 128_000,
  "mistral-large-3": 128_000,
  "qwen3-coder-next": 256_000,
};

// Family substrings → context window, used when no exact match.
const FAMILY: Array<[RegExp, number]> = [
  [/opus|sonnet|haiku|claude/i, 200_000],
  [/gemini/i, 1_000_000],
  [/gpt-5|codex|^o3|^o4/i, 272_000],
  [/gpt-4/i, 128_000],
  [/deepseek/i, 128_000],
  [/mistral/i, 128_000],
  [/qwen/i, 256_000],
];

function tokensFor(baseModel: string): number | null {
  const key = baseModel.trim().toLowerCase();
  if (EXACT[key] != null) return EXACT[key];
  for (const [re, n] of FAMILY) {
    if (re.test(key)) return n;
  }
  return null;
}

/** Human label for a context window, e.g. "200K", "1M", or null if unknown. */
export function contextWindowFor(baseModel: string): string | null {
  const n = tokensFor(baseModel);
  if (n == null) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}K`;
}
