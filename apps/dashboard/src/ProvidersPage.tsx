/**
 * Providers Page — catalog of AI providers grouped by auth type.
 */

import { useMemo, useState } from "react";
import { Plus, Search, X, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "./i18n";

// ─── Types ─────────────────────────────────────────────────

type ProviderCatalogEntry = {
  id: string;
  name: string;
  logo: string; // path to PNG in /provider-logos/
  category: "oauth" | "free_tier" | "api_key" | "custom";
  supported: boolean; // true = gateway has adapter
  description?: string;
  website?: string;
};

// ─── Provider Catalog ──────────────────────────────────────

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // OAuth Providers
  { id: "claude-code", name: "Claude Code", logo: "/provider-logos/claude.png", category: "oauth", supported: false, description: "Anthropic's official CLI for Claude", website: "https://claude.ai/code" },
  { id: "antigravity", name: "Antigravity", logo: "/provider-logos/antigravity.png", category: "oauth", supported: false, description: "Devin AI agent platform", website: "https://app.devin.ai" },
  { id: "openai-codex", name: "OpenAI Codex", logo: "/provider-logos/codex.png", category: "oauth", supported: false, description: "OpenAI's code generation models", website: "https://openai.com/codex" },
  { id: "github-copilot", name: "GitHub Copilot", logo: "/provider-logos/github.png", category: "oauth", supported: false, description: "AI pair programmer from GitHub", website: "https://github.com/features/copilot" },
  { id: "cursor", name: "Cursor IDE", logo: "/provider-logos/cursor.png", category: "oauth", supported: false, description: "AI-first code editor", website: "https://cursor.sh" },
  { id: "kilo-code", name: "Kilo Code", logo: "/provider-logos/kilocode.png", category: "oauth", supported: false, description: "AI coding assistant", website: "https://kilocode.ai" },
  { id: "cline", name: "Cline", logo: "/provider-logos/cline.png", category: "oauth", supported: false, description: "Open-source AI coding agent", website: "https://cline.bot" },
  { id: "windsurf", name: "Windsurf", logo: "/provider-logos/iflow.png", category: "oauth", supported: true, description: "Codeium's agentic IDE", website: "https://windsurf.com" },

  // Free Tier Providers
  { id: "kiro", name: "Kiro AI", logo: "/provider-logos/kiro.png", category: "free_tier", supported: true, description: "AWS-powered AI assistant", website: "https://kiro.dev" },
  { id: "qwen-code", name: "Qwen Code", logo: "/provider-logos/qwen.png", category: "free_tier", supported: false, description: "Alibaba's Qwen coding models", website: "https://qwen.ai" },
  { id: "gemini-cli", name: "Gemini CLI", logo: "/provider-logos/gemini-cli.png", category: "free_tier", supported: false, description: "Google's Gemini command-line tool", website: "https://github.com/google-gemini/gemini-cli" },
  { id: "iflow", name: "iFlow AI", logo: "/provider-logos/iflow.png", category: "free_tier", supported: false, description: "Free tier AI inference", website: "https://iflow.cn" },
  { id: "opencode-free", name: "OpenCode Free", logo: "/provider-logos/opencode.png", category: "free_tier", supported: false, description: "Free open-source coding AI", website: "https://opencode.ai" },
  { id: "openrouter", name: "OpenRouter", logo: "/provider-logos/openrouter.png", category: "free_tier", supported: false, description: "Unified API for multiple LLMs", website: "https://openrouter.ai" },
  { id: "nvidia-nim", name: "NVIDIA NIM", logo: "/provider-logos/nvidia.png", category: "free_tier", supported: false, description: "NVIDIA's inference microservices", website: "https://build.nvidia.com" },
  { id: "ollama", name: "Ollama Cloud", logo: "/provider-logos/ollama.png", category: "free_tier", supported: false, description: "Run open-source LLMs locally or in cloud", website: "https://ollama.com" },
  { id: "vertex", name: "Vertex AI", logo: "/provider-logos/vertex.png", category: "free_tier", supported: false, description: "Google Cloud's AI platform", website: "https://cloud.google.com/vertex-ai" },
  { id: "gemini", name: "Gemini", logo: "/provider-logos/gemini.png", category: "free_tier", supported: false, description: "Google's flagship AI models", website: "https://ai.google.dev" },
  { id: "cloudflare", name: "Cloudflare AI", logo: "/provider-logos/cloudflare-ai.png", category: "free_tier", supported: false, description: "Cloudflare Workers AI", website: "https://ai.cloudflare.com" },
  { id: "byteplus", name: "BytePlus ModelArk", logo: "/provider-logos/byteplus.png", category: "free_tier", supported: false, description: "ByteDance's enterprise AI platform", website: "https://www.byteplus.com" },

  // API Key Providers
  { id: "alibaba", name: "Alibaba", logo: "/provider-logos/alicode.png", category: "api_key", supported: false, description: "Alibaba Cloud AI services", website: "https://aliyun.com" },
  { id: "alibaba-intl", name: "Alibaba Intl", logo: "/provider-logos/alicode-intl.png", category: "api_key", supported: false, description: "Alibaba Cloud International", website: "https://alibabacloud.com" },
  { id: "anthropic", name: "Anthropic", logo: "/provider-logos/anthropic.png", category: "api_key", supported: false, description: "Claude API direct access", website: "https://anthropic.com" },
  { id: "azure-openai", name: "Azure OpenAI", logo: "/provider-logos/azure.png", category: "api_key", supported: false, description: "Microsoft Azure-hosted OpenAI", website: "https://azure.microsoft.com/products/ai-services/openai-service" },
  { id: "deepseek", name: "DeepSeek", logo: "/provider-logos/deepseek.png", category: "api_key", supported: false, description: "DeepSeek AI models", website: "https://deepseek.com" },
  { id: "groq", name: "Groq", logo: "/provider-logos/groq.png", category: "api_key", supported: false, description: "Ultra-fast LPU inference", website: "https://groq.com" },
  { id: "mistral", name: "Mistral", logo: "/provider-logos/mistral.png", category: "api_key", supported: false, description: "Mistral AI models", website: "https://mistral.ai" },
  { id: "openai", name: "OpenAI", logo: "/provider-logos/openai.png", category: "api_key", supported: false, description: "GPT-4, GPT-5 direct API", website: "https://openai.com" },
  { id: "perplexity", name: "Perplexity", logo: "/provider-logos/perplexity.png", category: "api_key", supported: false, description: "Web-aware AI search", website: "https://perplexity.ai" },
  { id: "together", name: "Together AI", logo: "/provider-logos/together.png", category: "api_key", supported: false, description: "Open-source models hosted", website: "https://together.ai" },
  { id: "xai", name: "xAI (Grok)", logo: "/provider-logos/xai.png", category: "api_key", supported: false, description: "Elon Musk's Grok models", website: "https://x.ai" },
];

const CATEGORY_LABELS: Record<string, string> = {
  custom: "Custom Providers (OpenAI/Anthropic Compatible)",
  oauth: "OAuth Providers",
  free_tier: "Free Tier Providers",
  api_key: "API Key Providers",
};

const CATEGORY_ORDER: string[] = ["oauth", "free_tier", "api_key"];

// ─── Main Component ────────────────────────────────────────

export function ProvidersPage(props: {
  accounts: Array<{ providerType: string; status: string }>;
  providerInstances: Array<{ id: string; type: string; enabled: boolean }>;
  providerTypes?: Array<{ type: string; displayName: string }>;
  models?: Array<{ publicModel: string; providerType: string; providerInstanceId: string; upstreamModel: string; enabled: boolean; id: string }>;
  api?: { post: (path: string, body: unknown) => Promise<unknown>; patch: (path: string, body: unknown) => Promise<unknown>; delete: (path: string) => Promise<unknown>; get: <T>(path: string) => Promise<T>; getList: <T>(path: string) => Promise<T[]> };
  refresh?: () => Promise<void>;
  onSelectProvider?: (providerType: string) => void;
}) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProviderCatalogEntry | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);

  const connectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const acc of props.accounts) {
      if (acc.status === "active") {
        map.set(acc.providerType, (map.get(acc.providerType) ?? 0) + 1);
      }
    }
    return map;
  }, [props.accounts]);

  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return PROVIDER_CATALOG;
    const q = search.toLowerCase();
    return PROVIDER_CATALOG.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ProviderCatalogEntry[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const p of filteredCatalog) {
      const list = map.get(p.category);
      if (list) list.push(p);
    }
    return map;
  }, [filteredCatalog]);

  // If a supported provider is selected via onSelectProvider, parent handles it

  return (
    <div className="providersPage">
      <div className="providersPageHeader">
        <div>
          <h2 className="providersPageTitle">{t("prov.title")}</h2>
          <p className="providersPageSubtitle">{t("prov.subtitle")}</p>
        </div>
        <div className="providersSearchWrap">
          <Search size={16} />
          <input
            className="providersSearchInput"
            placeholder={t("prov.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={cat} className="providersCategorySection">
            <div className="providersCategoryHeader">
              <h3>{cat === "oauth" ? t("prov.oauthProviders") : cat === "free_tier" ? t("prov.freeTierProviders") : t("prov.apiKeyProviders")}</h3>
              <button className="providerTestAllBtn">▶ {t("prov.testAll")}</button>
            </div>
            <div className="providersGrid">
              {items.map((provider) => {
                const connections = connectionCounts.get(provider.id) ?? 0;
                const hasInstance = props.providerInstances.some(
                  (pi) => pi.type === provider.id && pi.enabled
                );
                return (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    connections={connections}
                    isReady={hasInstance}
                    onClick={() => {
                      if (provider.supported && props.onSelectProvider) {
                        props.onSelectProvider(provider.id);
                      } else if (provider.supported) {
                        setActiveType(provider.id);
                      } else {
                        setSelected(provider);
                      }
                    }}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {selected && (
        <ProviderDetailModal
          provider={selected}
          connections={connectionCounts.get(selected.id) ?? 0}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── Provider Card ─────────────────────────────────────────

function ProviderCard(props: {
  provider: ProviderCatalogEntry;
  connections: number;
  isReady: boolean;
  onClick: () => void;
}) {
  const { t } = useLang();
  const { provider, connections, isReady, onClick } = props;
  const statusText =
    connections > 0
      ? `● ${connections} ${t("prov.connected")}`
      : isReady
        ? `● ${t("prov.ready")}`
        : t("prov.noConnections");
  const statusClass =
    connections > 0
      ? "providerStatus--connected"
      : isReady
        ? "providerStatus--ready"
        : "providerStatus--none";

  return (
    <button
      type="button"
      className={`providerCard2 ${!provider.supported ? "providerCard2--disabled" : ""}`}
      onClick={onClick}
    >
      <img
        className="providerCard2Logo"
        src={provider.logo}
        alt={provider.name}
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="providerCard2Info">
        <strong>{provider.name}</strong>
        <span className={`providerCard2Status ${statusClass}`}>{statusText}</span>
      </div>
    </button>
  );
}

// ─── Provider Detail Modal ────────────────────────────────

function ProviderDetailModal(props: {
  provider: ProviderCatalogEntry;
  connections: number;
  onClose: () => void;
}) {
  const { t } = useLang();
  const { provider, connections, onClose } = props;

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalContent providerDetailModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{provider.name}</h2>
          <button className="iconButton" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="providerDetailBody">
          <div className="providerDetailHero">
            <img
              className="providerDetailLogo"
              src={provider.logo}
              alt={provider.name}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div>
              <h3>{provider.name}</h3>
              {provider.description && <p>{provider.description}</p>}
              {provider.website && (
                <a href={provider.website} target="_blank" rel="noreferrer" className="providerDetailLink">
                  <ExternalLink size={14} /> {t("prov.visitWebsite")}
                </a>
              )}
            </div>
          </div>

          <div className="providerDetailStats">
            <div className="providerDetailStat">
              <span className="providerDetailStatLabel">{t("prov.activeAccounts")}</span>
              <span className="providerDetailStatValue">{connections}</span>
            </div>
            <div className="providerDetailStat">
              <span className="providerDetailStatLabel">{t("prov.authMethod")}</span>
              <span className="providerDetailStatValue">
                {provider.category === "oauth" ? "OAuth" : provider.category === "api_key" ? "API Key" : provider.category === "free_tier" ? "Free Tier" : "Custom"}
              </span>
            </div>
            <div className="providerDetailStat">
              <span className="providerDetailStatLabel">{t("prov.status")}</span>
              <span className={`providerDetailStatValue ${provider.supported ? "supported" : "unsupported"}`}>
                {provider.supported ? t("prov.supported") : t("prov.comingSoon")}
              </span>
            </div>
          </div>

          {!provider.supported && (
            <div className="providerDetailNotice">
              <AlertCircle size={16} />
              <span>{t("prov.roadmapNotice")}</span>
            </div>
          )}
        </div>

        <div className="providerDetailFooter">
          <button className="ghostButton" onClick={onClose}>{t("common.close")}</button>
          {provider.supported ? (
            <button className="primaryButton" onClick={() => { onClose(); window.location.hash = "#accounts"; }}>
              <Plus size={16} /> {t("prov.addAccount")}
            </button>
          ) : (
            <button className="primaryButton" disabled>
              <CheckCircle2 size={16} /> {t("prov.notifyWhenReady")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
