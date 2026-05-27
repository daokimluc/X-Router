/**
 * Providers Page — catalog of AI providers grouped by auth method.
 * Matches 9router UI: Custom Compatible, OAuth, Free Tier, API Key sections.
 * Each card shows provider icon, name, connection status badges, and toggle.
 */

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Play,
  Pause,
  ChevronDown,
  SearchX,
  Puzzle,
  X,
  AlertCircle,
  Check,
  Trash2,
  PowerOff,
  Power,
  ListChecks,
} from "lucide-react";
import { useLang } from "./i18n";
import { TestAllResultsModal, type TestAllPayload } from "./components/TestAllResultsModal";

// ─── Types ─────────────────────────────────────────────────

type ProviderCategory =
  | "free"
  | "oauth_subscription"
  | "api_key_cheap"
  | "api_key_premium"
  | "cloud_platform"
  | "custom";

type ProviderTypeEntry = {
  type: string;
  displayName: string;
  adapterName: string;
  authMethods: string[];
  supportedProtocols: string[];
  capabilities: {
    protocols: string[];
    flags: string[];
  };
  category?: ProviderCategory;
  logoUrl?: string;
  defaultBaseUrl?: string;
  color?: string;
  noAuth?: boolean;
  deprecated?: boolean;
  deprecationNotice?: string;
};

type Account = {
  providerType: string;
  status: string;
  providerInstanceId?: string;
  lastError?: string;
  lastErrorAt?: string;
};

type ProviderInstance = {
  id: string;
  type: string;
  enabled: boolean;
};

type ModelMapping = {
  publicModel: string;
  providerType: string;
  providerInstanceId: string;
  upstreamModel: string;
  enabled: boolean;
  id: string;
};

// ─── Auth Group (matches 9router sections) ─────────────────

type AuthGroup = "custom" | "oauth" | "free" | "apikey";

const AUTH_GROUP_LABELS: Record<AuthGroup, string> = {
  custom: "Custom Providers (OpenAI/Anthropic Compatible)",
  oauth: "OAuth Providers",
  free: "Free Tier Providers",
  apikey: "API Key Providers",
};

const AUTH_GROUP_ORDER: AuthGroup[] = ["custom", "oauth", "free", "apikey"];

// ─── Provider Catalog (matches 9router's provider constants) ─

type CatalogProvider = {
  type: string;
  name: string;
  authGroup: AuthGroup;
  color: string;
  textIcon?: string;
  noAuth?: boolean;
  deprecated?: boolean;
  website?: string;
  apiKeyUrl?: string;
};

/**
 * Static catalog of known providers, grouped by auth method.
 * This mirrors 9router's OAUTH_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, APIKEY_PROVIDERS.
 */
const PROVIDER_CATALOG: CatalogProvider[] = [
  // ─── OAuth Providers ───
  { type: "kiro", name: "Kiro AI", authGroup: "oauth", color: "#FF6B35", deprecated: true, website: "https://kiro.dev" },
  { type: "windsurf", name: "Windsurf", authGroup: "oauth", color: "#00D4AA", website: "https://windsurf.com" },
  { type: "claude", name: "Claude Code", authGroup: "oauth", color: "#D97757", deprecated: true, website: "https://claude.ai" },
  { type: "codex", name: "OpenAI Codex", authGroup: "oauth", color: "#3B82F6", deprecated: true, website: "https://chatgpt.com/codex" },
  { type: "github-copilot", name: "GitHub Copilot", authGroup: "oauth", color: "#333333", deprecated: true, website: "https://github.com/features/copilot" },
  { type: "cursor", name: "Cursor IDE", authGroup: "oauth", color: "#00D4AA", website: "https://cursor.com" },
  { type: "cline", name: "Cline", authGroup: "oauth", color: "#5B9BD5", textIcon: "CL", website: "https://cline.bot" },
  { type: "kilocode", name: "Kilo Code", authGroup: "oauth", color: "#FF6B35", textIcon: "KC", website: "https://kilocode.ai" },
  { type: "antigravity", name: "Antigravity", authGroup: "oauth", color: "#F59E0B", deprecated: true, website: "https://antigravity.dev" },

  // ─── Free Tier Providers ───
  { type: "opencode_free", name: "OpenCode Free", authGroup: "free", color: "#E87040", textIcon: "OC", noAuth: true },
  { type: "openrouter", name: "OpenRouter", authGroup: "free", color: "#F97316", textIcon: "OR", website: "https://openrouter.ai", apiKeyUrl: "https://openrouter.ai/settings/keys" },
  { type: "nvidia", name: "NVIDIA NIM", authGroup: "free", color: "#76B900", textIcon: "NV", website: "https://developer.nvidia.com/nim", apiKeyUrl: "https://build.nvidia.com/settings/api-keys" },
  { type: "ollama", name: "Ollama Cloud", authGroup: "free", color: "#ffffff", textIcon: "OL", website: "https://ollama.com", apiKeyUrl: "https://ollama.com/settings/keys" },
  { type: "gemini", name: "Gemini", authGroup: "free", color: "#4285F4", textIcon: "GE", website: "https://ai.google.dev", apiKeyUrl: "https://aistudio.google.com/app/apikey" },
  { type: "vertex_ai", name: "Vertex AI", authGroup: "free", color: "#4285F4", textIcon: "VX", website: "https://cloud.google.com/vertex-ai" },
  { type: "cloudflare", name: "Cloudflare", authGroup: "free", color: "#F38020", textIcon: "CF", website: "https://developers.cloudflare.com/workers-ai/" },

  // ─── API Key Providers ───
  { type: "openai", name: "OpenAI", authGroup: "apikey", color: "#10A37F", textIcon: "OA", website: "https://platform.openai.com", apiKeyUrl: "https://platform.openai.com/api-keys" },
  { type: "anthropic", name: "Anthropic", authGroup: "apikey", color: "#D97757", textIcon: "AN", website: "https://console.anthropic.com", apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  { type: "azure_openai", name: "Azure OpenAI", authGroup: "apikey", color: "#0078D4", textIcon: "AZ", website: "https://azure.microsoft.com" },
  { type: "deepseek", name: "DeepSeek", authGroup: "apikey", color: "#4D6BFE", textIcon: "DS", website: "https://deepseek.com", apiKeyUrl: "https://platform.deepseek.com/api_keys" },
  { type: "groq", name: "Groq", authGroup: "apikey", color: "#F55036", textIcon: "GQ", website: "https://groq.com", apiKeyUrl: "https://console.groq.com/keys" },
  { type: "xai", name: "xAI (Grok)", authGroup: "apikey", color: "#1DA1F2", textIcon: "XA", website: "https://x.ai", apiKeyUrl: "https://console.x.ai" },
  { type: "mistral", name: "Mistral", authGroup: "apikey", color: "#FF7000", textIcon: "MI", website: "https://mistral.ai", apiKeyUrl: "https://console.mistral.ai/api-keys" },
  { type: "together", name: "Together AI", authGroup: "apikey", color: "#0F6FFF", textIcon: "TG", website: "https://www.together.ai", apiKeyUrl: "https://api.together.xyz/settings/api-keys" },
  { type: "fireworks", name: "Fireworks AI", authGroup: "apikey", color: "#7B2EF2", textIcon: "FW", website: "https://fireworks.ai", apiKeyUrl: "https://fireworks.ai/account/api-keys" },
  { type: "perplexity", name: "Perplexity", authGroup: "apikey", color: "#20808D", textIcon: "PP", website: "https://www.perplexity.ai", apiKeyUrl: "https://www.perplexity.ai/settings/api" },
  { type: "cerebras", name: "Cerebras", authGroup: "apikey", color: "#FF4F00", textIcon: "CB", website: "https://www.cerebras.ai", apiKeyUrl: "https://cloud.cerebras.ai/platform" },
  { type: "cohere", name: "Cohere", authGroup: "apikey", color: "#39594D", textIcon: "CO", website: "https://cohere.com", apiKeyUrl: "https://dashboard.cohere.com/api-keys" },
  { type: "kimi", name: "Kimi", authGroup: "apikey", color: "#1E3A8A", textIcon: "KM", website: "https://kimi.moonshot.cn", apiKeyUrl: "https://platform.moonshot.ai/console/api-keys" },
  { type: "alibaba", name: "Alibaba", authGroup: "apikey", color: "#FF6A00", textIcon: "ALi", website: "https://bailian.console.aliyun.com" },
  { type: "minimax", name: "Minimax", authGroup: "apikey", color: "#7C3AED", textIcon: "MM", website: "https://www.minimaxi.com" },
  { type: "siliconflow", name: "SiliconFlow", authGroup: "apikey", color: "#5B6EF5", textIcon: "SF", website: "https://cloud.siliconflow.com" },
  { type: "nebius", name: "Nebius AI", authGroup: "apikey", color: "#6C5CE7", textIcon: "NB", website: "https://nebius.com" },
  { type: "glm", name: "GLM Coding", authGroup: "apikey", color: "#2563EB", textIcon: "GL", website: "https://open.bigmodel.cn" },
  { type: "volcengine", name: "Volcengine Ark", authGroup: "apikey", color: "#1677FF", textIcon: "ARK", website: "https://ark.cn-beijing.volces.com" },
];

function getAuthGroup(provider: ProviderTypeEntry): AuthGroup {
  if (provider.category === "custom") return "custom";
  if (provider.category === "free") return "free";
  if (provider.noAuth || provider.authMethods.includes("none")) return "free";
  if (provider.authMethods.includes("oauth") || provider.category === "oauth_subscription") return "oauth";
  return "apikey";
}

// ─── Status Helpers ────────────────────────────────────────

function getProviderStats(
  providerType: string,
  accounts: Account[],
  instances: ProviderInstance[]
) {
  const providerAccounts = accounts.filter((a) => a.providerType === providerType);
  const connected = providerAccounts.filter((a) => a.status === "active").length;
  const error = providerAccounts.filter(
    (a) => a.status === "cooldown" || a.status === "error" || a.status === "expired"
  ).length;
  const total = providerAccounts.length;
  const allDisabled = total > 0 && providerAccounts.every((a) => a.status === "disabled");
  const hasInstance = instances.some((i) => i.type === providerType && i.enabled);

  const errorAccounts = providerAccounts.filter(
    (a) => a.status === "cooldown" || a.status === "error"
  );
  const latestError = errorAccounts.sort(
    (a, b) => new Date(b.lastErrorAt ?? 0).getTime() - new Date(a.lastErrorAt ?? 0).getTime()
  )[0];
  const errorTime = latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt) : null;

  return { connected, error, total, allDisabled, hasInstance, errorTime };
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Constants ─────────────────────────────────────────────

const APIKEY_INITIAL_VISIBLE = 20;

// ─── Main Component ────────────────────────────────────────

export function ProvidersPage(props: {
  accounts: Account[];
  providerInstances: ProviderInstance[];
  providerTypes?: ProviderTypeEntry[];
  models?: ModelMapping[];
  api?: {
    post: (path: string, body: unknown) => Promise<unknown>;
    patch: (path: string, body: unknown) => Promise<unknown>;
    delete: (path: string) => Promise<unknown>;
    get: <T>(path: string) => Promise<T>;
    getList: <T>(path: string) => Promise<T[]>;
  };
  refresh?: () => Promise<void>;
  onSelectProvider?: (providerType: string) => void;
}) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestAllPayload | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [customProviderModal, setCustomProviderModal] = useState<"openai" | "anthropic" | null>(null);
  // Phase 25 — batch mode for bulk enable/disable/delete
  const [batchMode, setBatchMode] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  // Merge API provider types with static catalog
  const registeredTypes = new Set((props.providerTypes ?? []).map((p) => p.type));

  const matchSearch = (name: string, type: string) =>
    !search.trim() ||
    name.toLowerCase().includes(search.trim().toLowerCase()) ||
    type.toLowerCase().includes(search.trim().toLowerCase());

  // Build display items: use catalog as base, enrich with API data
  type DisplayProvider = {
    type: string;
    name: string;
    authGroup: AuthGroup;
    color: string;
    textIcon?: string;
    noAuth?: boolean;
    deprecated?: boolean;
    isRegistered: boolean;
    website?: string;
    apiKeyUrl?: string;
  };

  const allProviders = useMemo((): DisplayProvider[] => {
    const result: DisplayProvider[] = [];
    const seen = new Set<string>();

    // First: catalog items (known providers)
    for (const cat of PROVIDER_CATALOG) {
      seen.add(cat.type);
      result.push({
        ...cat,
        isRegistered: registeredTypes.has(cat.type),
      });
    }

    // Then: any API-registered providers not in catalog
    for (const pt of props.providerTypes ?? []) {
      if (seen.has(pt.type)) continue;
      seen.add(pt.type);
      result.push({
        type: pt.type,
        name: pt.displayName,
        authGroup: getAuthGroup(pt),
        color: pt.color ?? "#64748b",
        noAuth: pt.noAuth,
        deprecated: pt.deprecated,
        isRegistered: true,
      });
    }

    return result;
  }, [props.providerTypes]);

  // Group and filter
  const grouped = useMemo(() => {
    const map = new Map<AuthGroup, DisplayProvider[]>();
    for (const group of AUTH_GROUP_ORDER) {
      map.set(group, []);
    }
    for (const p of allProviders) {
      if (!matchSearch(p.name, p.type)) continue;
      map.get(p.authGroup)!.push(p);
    }

    // Sort: connected first, then registered, then alphabetical
    for (const [, items] of map) {
      items.sort((a, b) => {
        const sa = getProviderStats(a.type, props.accounts, props.providerInstances);
        const sb = getProviderStats(b.type, props.accounts, props.providerInstances);
        // Connected first
        if (sa.connected !== sb.connected) return sb.connected - sa.connected;
        // Registered first
        if (a.isRegistered !== b.isRegistered) return a.isRegistered ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [allProviders, search, props.accounts, props.providerInstances]);

  const isSearching = !!search.trim();
  const hasAnyResult = AUTH_GROUP_ORDER.some((g) => (grouped.get(g) ?? []).length > 0);

  const handleTestAll = async () => {
    if (testing || !props.api) return;
    setTesting(true);
    setTestError(null);
    try {
      const payload = await props.api.post("/admin/v1/test-all", {}) as TestAllPayload;
      setTestResult(payload);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test failed");
      window.setTimeout(() => setTestError(null), 5000);
    } finally {
      setTesting(false);
    }
  };

  // Phase 25 — collect provider instance ids for currently selected provider types
  const selectedInstanceIds = useMemo(() => {
    const ids: string[] = [];
    for (const inst of props.providerInstances) {
      if (selectedTypes.has(inst.type)) ids.push(inst.id);
    }
    return ids;
  }, [props.providerInstances, selectedTypes]);

  const handleBatchAction = async (action: "enable" | "disable" | "delete") => {
    if (batchBusy || !props.api || selectedInstanceIds.length === 0) return;
    if (action === "delete" && !window.confirm(`Delete ${selectedInstanceIds.length} provider instance(s)? This cannot be undone.`)) return;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const result = await props.api.post(
        "/admin/v1/provider-instances/batch",
        { ids: selectedInstanceIds, action }
      ) as { action: string; updated: number; ids: string[]; notFound: string[] };
      setBatchResult(`${action}: ${result.updated} updated${result.notFound.length ? `, ${result.notFound.length} not found` : ""}`);
      window.setTimeout(() => setBatchResult(null), 4000);
      setSelectedTypes(new Set());
      setBatchMode(false);
      await props.refresh?.();
    } catch (err) {
      setBatchResult(`Error: ${err instanceof Error ? err.message : "batch failed"}`);
      window.setTimeout(() => setBatchResult(null), 5000);
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleProviderSelection = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (allProviders.length === 0 && (props.providerTypes ?? []).length === 0) {
    return (
      <div className="providersPage">
        <div className="providersEmptyState">
          <AlertCircle size={32} className="providersEmptyIcon" />
          <p>
            {t("prov.noProviders") ??
              "No provider types registered. Start the gateway to load the provider catalog."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="providersPage">
      {/* Header */}
      <div className="providersPageHeader">
        <div>
          <h2 className="providersPageTitle">{t("prov.title")}</h2>
          <p className="providersPageSubtitle">{t("prov.subtitle")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className={batchMode ? "primaryButton" : "ghostButton"}
            onClick={() => {
              setBatchMode((v) => !v);
              setSelectedTypes(new Set());
            }}
            title="Toggle batch mode for bulk enable/disable/delete"
          >
            <ListChecks size={14} />
            {batchMode ? "Batch on" : "Batch"}
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => void handleTestAll()}
            disabled={testing}
            title={t("prov.testAllConnections")}
          >
            <Play size={14} />
            {testing ? t("prov.testing") : t("prov.testAllConnections")}
          </button>
          <div className="providersSearchWrap">
            <Search size={16} />
            <input
              className="providersSearchInput"
              placeholder={t("prov.searchPlaceholder") ?? "Search providers..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="providersSearchClear" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Batch action bar (Phase 25) */}
      {batchMode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            margin: "12px 0",
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <strong>
            {selectedTypes.size === 0
              ? "Select providers to perform a bulk action"
              : `${selectedTypes.size} provider type(s) selected · ${selectedInstanceIds.length} instance(s)`}
          </strong>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="ghostButton"
            disabled={batchBusy || selectedInstanceIds.length === 0}
            onClick={() => void handleBatchAction("enable")}
          >
            <Power size={14} /> Enable
          </button>
          <button
            type="button"
            className="ghostButton"
            disabled={batchBusy || selectedInstanceIds.length === 0}
            onClick={() => void handleBatchAction("disable")}
          >
            <PowerOff size={14} /> Disable
          </button>
          <button
            type="button"
            className="ghostButton"
            style={{ color: "#ef4444" }}
            disabled={batchBusy || selectedInstanceIds.length === 0}
            onClick={() => void handleBatchAction("delete")}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
      {batchResult && (
        <div
          style={{
            padding: "8px 14px",
            margin: "8px 0",
            background: batchResult.startsWith("Error") ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
            color: batchResult.startsWith("Error") ? "#ef4444" : "#10b981",
            border: "1px solid",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {batchResult}
        </div>
      )}

      {/* No results */}
      {!hasAnyResult && (
        <div className="providersNoResult">
          <SearchX size={32} />
          <p>No providers match your search</p>
        </div>
      )}

      {/* Provider Groups */}
      {AUTH_GROUP_ORDER.map((groupKey) => {
        const items = grouped.get(groupKey) ?? [];
        if (items.length === 0) return null;

        const isApikey = groupKey === "apikey";
        const visibleItems =
          isApikey && !isSearching && !showAllApikey
            ? items.slice(0, APIKEY_INITIAL_VISIBLE)
            : items;
        const hiddenCount = items.length - APIKEY_INITIAL_VISIBLE;

        return (
          <section key={groupKey} className="providersCategorySection">
            <div className="providersCategoryHeader">
              <h3>{AUTH_GROUP_LABELS[groupKey]}</h3>
              <div className="providersCategoryActions">
                {groupKey === "custom" && (
                  <div className="providersCustomActions">
                    <button
                      className="providerAddCompatBtn providerAddCompatBtn--anthropic"
                      onClick={() => setCustomProviderModal("anthropic")}
                    >
                      <Plus size={14} /> Add Anthropic Compatible
                    </button>
                    <button
                      className="providerAddCompatBtn providerAddCompatBtn--openai"
                      onClick={() => setCustomProviderModal("openai")}
                    >
                      <Plus size={14} /> Add OpenAI Compatible
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Empty custom hint */}
            {groupKey === "custom" && items.length === 0 && (
              <div className="providersEmptyHint">
                <Puzzle size={16} />
                <span>No custom providers — use buttons above to add OpenAI/Anthropic compatible endpoints</span>
              </div>
            )}

            {/* Provider Grid */}
            <div className="providersGrid">
              {visibleItems.map((provider) => (
                <ProviderCard
                  key={provider.type}
                  provider={provider}
                  stats={getProviderStats(provider.type, props.accounts, props.providerInstances)}
                  onClick={() => {
                    if (batchMode) {
                      toggleProviderSelection(provider.type);
                    } else {
                      props.onSelectProvider?.(provider.type);
                    }
                  }}
                  batchMode={batchMode}
                  selected={selectedTypes.has(provider.type)}
                />
              ))}
            </div>

            {/* Show more */}
            {isApikey && !isSearching && !showAllApikey && hiddenCount > 0 && (
              <button className="providersShowMoreBtn" onClick={() => setShowAllApikey(true)}>
                <ChevronDown size={16} />
                Show all {items.length} providers
              </button>
            )}
          </section>
        );
      })}
      {/* Custom Provider Modal */}
      {customProviderModal && (
        <CustomProviderModal
          type={customProviderModal}
          api={props.api}
          onClose={() => setCustomProviderModal(null)}
          onSuccess={() => {
            setCustomProviderModal(null);
            void props.refresh?.();
          }}
        />
      )}
      {testError && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 16px",
            background: "#ef4444",
            color: "white",
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {testError}
        </div>
      )}
      {testResult && (
        <TestAllResultsModal payload={testResult} onClose={() => setTestResult(null)} />
      )}
    </div>
  );
}

// ─── Provider Card ─────────────────────────────────────────

function ProviderCard(props: {
  provider: {
    type: string;
    name: string;
    authGroup: AuthGroup;
    color: string;
    textIcon?: string;
    noAuth?: boolean;
    deprecated?: boolean;
    isRegistered: boolean;
  };
  stats: ReturnType<typeof getProviderStats>;
  onClick: () => void;
  batchMode?: boolean;
  selected?: boolean;
}) {
  const { provider, stats, onClick, batchMode, selected } = props;
  const { connected, error, allDisabled, hasInstance, errorTime } = stats;

  const cardClass = [
    "providerCard2",
    allDisabled ? "providerCard2--disabled" : "",
    !provider.isRegistered ? "providerCard2--unregistered" : "",
    batchMode && selected ? "providerCard2--selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cardClass}
      onClick={onClick}
      style={{
        position: "relative",
        ...(batchMode && selected ? { outline: "2px solid #3b82f6", outlineOffset: -2 } : {})
      }}
    >
      {batchMode && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 20,
            height: 20,
            borderRadius: 4,
            border: selected ? "2px solid #3b82f6" : "2px solid var(--color-border)",
            background: selected ? "#3b82f6" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          {selected && <Check size={14} color="white" />}
        </div>
      )}
      {/* Icon */}
      <div
        className="providerCard2IconWrap"
        style={{ backgroundColor: provider.color ? `${provider.color}15` : undefined }}
      >
        <img
          className="providerCard2Logo"
          src={provider.type ? `/provider-logos/${provider.type}.png` : undefined}
          alt={provider.name}
          loading="lazy"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.style.display = "none";
            const parent = img.parentElement;
            if (parent && !parent.querySelector(".providerCard2Fallback")) {
              const fallback = document.createElement("span");
              fallback.className = "providerCard2Fallback";
              fallback.textContent = provider.textIcon ?? provider.name.slice(0, 2).toUpperCase();
              if (provider.color && provider.color !== "#ffffff") {
                fallback.style.color = provider.color;
              }
              parent.appendChild(fallback);
            }
          }}
        />
      </div>

      {/* Info */}
      <div className="providerCard2Info">
        <strong>{provider.name}</strong>
        <div className="providerCard2StatusRow">
          {allDisabled ? (
            <span className="providerBadge providerBadge--disabled">
              <Pause size={10} /> Disabled
            </span>
          ) : provider.noAuth ? (
            <span className="providerBadge providerBadge--success">● Ready</span>
          ) : (
            <>
              {connected > 0 && (
                <span className="providerBadge providerBadge--success">● {connected} Connected</span>
              )}
              {error > 0 && (
                <span className="providerBadge providerBadge--error">● {error} Error</span>
              )}
              {connected === 0 && error === 0 && hasInstance && (
                <span className="providerBadge providerBadge--ready">● Ready</span>
              )}
              {connected === 0 && error === 0 && !hasInstance && (
                <span className="providerCard2Status providerStatus--none">No connections</span>
              )}
              {errorTime && <span className="providerCard2ErrorTime">{errorTime}</span>}
            </>
          )}
          {provider.deprecated && (
            <span className="providerBadge providerBadge--deprecated">⚠ Deprecated</span>
          )}
        </div>
      </div>

      {/* Auth dot */}
      <div className="providerCard2Actions">
        <span className={`providerAuthDot providerAuthDot--${provider.authGroup}`} />
      </div>
    </button>
  );
}

// ─── Custom Compatible Provider Modal ──────────────────────

function CustomProviderModal(props: {
  type: "openai" | "anthropic";
  api?: {
    post: (path: string, body: unknown) => Promise<unknown>;
  };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    props.type === "openai" ? "https://api.example.com/v1" : "https://api.example.com"
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);

  const providerType = props.type === "openai"
    ? `openai_compatible_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom"}`
    : `anthropic_compatible_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom"}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) {
      setError("Name and Base URL are required");
      return;
    }

    setValidating(true);
    setError("");

    try {
      // Validate endpoint before saving
      const testUrl = props.type === "openai"
        ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
        : `${baseUrl.replace(/\/$/, "")}/v1/messages`;

      // Create the custom provider via API
      await props.api?.post("/admin/provider-accounts", {
        providerType: props.type === "openai" ? "openai" : "anthropic",
        displayName: name.trim(),
        credentials: apiKey ? { apiKey } : {},
        config: {
          baseUrl: baseUrl.trim(),
          customName: name.trim(),
          isCustomCompatible: true
        },
        enabled: true,
        weight: 1,
        maxConcurrency: 3
      });

      props.onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add custom provider");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={props.onClose}>
      <div className="confirmModal customProviderModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="windowDots"><span /><span /><span /></div>
          <h3>Add {props.type === "openai" ? "OpenAI" : "Anthropic"} Compatible Provider</h3>
          <button className="iconButton" type="button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="customProviderForm" onSubmit={(e) => void handleSubmit(e)}>
          <label className="formField">
            <span>Provider Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={props.type === "openai" ? "My OpenAI Provider" : "My Anthropic Provider"}
              autoFocus
            />
          </label>

          <label className="formField">
            <span>Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={props.type === "openai" ? "https://api.example.com/v1" : "https://api.example.com"}
            />
            <small className="formHint">
              {props.type === "openai"
                ? "The base URL for the OpenAI-compatible API (e.g. https://api.example.com/v1)"
                : "The base URL for the Anthropic-compatible API (e.g. https://api.example.com)"}
            </small>
          </label>

          <label className="formField">
            <span>API Key (optional)</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </label>

          {error && <div className="formError">{error}</div>}

          <div className="modalFooter">
            <button className="textButton" type="button" onClick={props.onClose}>Cancel</button>
            <button className="primaryButton" type="submit" disabled={validating}>
              {validating ? "Validating..." : "Add Provider"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
