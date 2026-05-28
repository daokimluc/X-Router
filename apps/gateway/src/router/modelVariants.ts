/**
 * Phase 31 — Algorithmic alias variants for model names.
 *
 * Different providers expose the same model under slightly different naming
 * conventions:
 *   - Anthropic API: `claude-opus-4-7-20250101` (date suffix)
 *   - Kiro IDE:      `claude-opus-4.7` (dot version)
 *   - Windsurf:      `claude-opus-4-7` (dash version, no date)
 *   - AWS Bedrock:   `anthropic.claude-opus-4-7-20250101-v1:0`
 *   - Vertex AI:     `claude-opus-4@7`
 *
 * `expandVariants(name)` returns all reasonable aliases for a single name so
 * the resolver can match whichever form the client sent.
 */

const DATE_SUFFIX_RE = /-\d{8}$/;
const DASH_VERSION_RE = /(\d+)-(\d+)$/;
const DOT_VERSION_RE = /(\d+)\.(\d+)/;
const BEDROCK_PREFIX = "anthropic.";
const BEDROCK_SUFFIX_RE = /-v\d+:\d+$/;

export function expandVariants(name: string): string[] {
  const variants = new Set<string>([name]);

  // Strip Anthropic date suffix: claude-opus-4-7-20250101 → claude-opus-4-7
  const noDate = name.replace(DATE_SUFFIX_RE, "");
  if (noDate !== name) variants.add(noDate);

  // Dash version → dot: claude-opus-4-7 → claude-opus-4.7
  const dotForm = noDate.replace(DASH_VERSION_RE, "$1.$2");
  if (dotForm !== noDate) variants.add(dotForm);

  // Dot version → dash: claude-opus-4.7 → claude-opus-4-7
  const dashForm = name.replace(DOT_VERSION_RE, "$1-$2");
  if (dashForm !== name) variants.add(dashForm);

  // AWS Bedrock prefix strip: anthropic.claude-opus-4-7-20250101-v1:0 → claude-opus-4-7
  if (name.startsWith(BEDROCK_PREFIX)) {
    const stripped = name.slice(BEDROCK_PREFIX.length).replace(BEDROCK_SUFFIX_RE, "");
    variants.add(stripped);
    variants.add(stripped.replace(DATE_SUFFIX_RE, ""));
  }

  // Vertex AI separator: claude-opus-4@7 → claude-opus-4-7
  if (name.includes("@")) {
    variants.add(name.replace(/@/g, "-"));
  }

  return Array.from(variants);
}

/**
 * Phase 31 — convert a canonical (or short) model name into the upstream
 * format that a specific provider type expects. Used when forwarding the
 * model name in the upstream request body.
 *
 * If `instance.modelMapping[publicModel]` is set, the route handler should
 * prefer that explicit override and skip this auto-conversion.
 */
export type UpstreamFormatter = (canonical: string) => string;

export const PROVIDER_FORMATS: Record<string, UpstreamFormatter> = {
  // Kiro: prefer dot for last version segment (claude-opus-4-7 → claude-opus-4.7)
  kiro: (m) => m.replace(DASH_VERSION_RE, "$1.$2"),
  // Windsurf passes the name through as-is (it already uses dash).
  windsurf: (m) => m,
  // Anthropic API accepts both with and without date suffix.
  anthropic: (m) => m,
  // AWS Bedrock: anthropic.<canonical>-v1:0 if not already prefixed.
  aws_bedrock: (m) => (m.startsWith(BEDROCK_PREFIX) ? m : `${BEDROCK_PREFIX}${m}-v1:0`),
  // Vertex AI uses @ separator for last version segment.
  vertex_ai: (m) => m.replace(/-(\d+)$/, "@$1"),
  // OpenAI / generic: passthrough.
  openai: (m) => m,
  azure_openai: (m) => m,
  generic_openai: (m) => m
};

export function formatUpstreamModel(canonical: string, providerType: string): string {
  const formatter = PROVIDER_FORMATS[providerType];
  return formatter ? formatter(canonical) : canonical;
}
