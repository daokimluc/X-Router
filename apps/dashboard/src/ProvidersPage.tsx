/**
 * Providers Page — catalog of AI providers grouped by category.
 * Fetches provider types from the API and groups them by category:
 * Free, OAuth (Subscription), API Key (Cheap), API Key (Premium), Cloud Platform, Custom
 */

import { useMemo, useState } from "react";
import { Plus, Search, X, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "./i18n";

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
};

// ─── Category Configuration ────────────────────────────────

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  free: "Free Providers",
  oauth_subscription: "OAuth (Subscription)",
  api_key_cheap: "API Key (Budget)",
  api_key_premium: "API Key (Premium)",
  cloud_platform: "Cloud Platform",
  custom: "Custom",
};

const CATEGORY_ORDER: ProviderCategory[] = [
  "free",
  "oauth_subscription",
  "api_key_cheap",
  "api_key_premium",
  "cloud_platform",
  "custom",
];

function getAuthMethodLabel(authMethods: string[]): string {
  if (authMethods.includes("oauth")) return "OAuth";
  if (authMethods.includes("service_account")) return "Service Account";
  if (authMethods.includes("none")) return "No Auth";
  if (authMethods.includes("api_key")) return "API Key";
  if (authMethods.includes("bearer_token")) return "Bearer Token";
  return authMethods[0] ?? "Unknown";
}

// ─── Main Component ────────────────────────────────────────

export function ProvidersPage(props: {
  accounts: Array<{ providerType: string; status: string }>;
  providerInstances: Array<{ id: string; type: string; enabled: boolean }>;
  providerTypes?: ProviderTypeEntry[];
  models?: Array<{ publicModel: string; providerType: string; providerInstanceId: string; upstreamModel: string; enabled: boolean; id: string }>;
  api?: { post: (path: string, body: unknown) => Promise<unknown>; patch: (path: string, body: unknown) => Promise<unknown>; delete: (path: string) => Promise<unknown>; get: <T>(path: string) => Promise<T>; getList: <T>(path: string) => Promise<T[]> };
  refresh?: () => Promise<void>;
  onSelectProvider?: (providerType: string) => void;
}) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProviderTypeEntry | null>(null);

  const providers = props.providerTypes ?? [];

  const connectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const acc of props.accounts) {
      if (acc.status === "active") {
        map.set(acc.providerType, (map.get(acc.providerType) ?? 0) + 1);
      }
    }
    return map;
  }, [props.accounts]);

  const filteredProviders = useMemo(() => {
    if (!search.trim()) return providers;
    const q = search.toLowerCase();
    return providers.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.type.toLowerCase().includes(q)
    );
  }, [search, providers]);

  const grouped = useMemo(() => {
    const map = new Map<ProviderCategory, ProviderTypeEntry[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const p of filteredProviders) {
      const category = p.category ?? "custom";
      const list = map.get(category);
      if (list) list.push(p);
    }
    return map;
  }, [filteredProviders]);

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
              <h3>{CATEGORY_LABELS[cat]}</h3>
              <button className="providerTestAllBtn">▶ {t("prov.testAll")}</button>
            </div>
            <div className="providersGrid">
              {items.map((provider) => {
                const connections = connectionCounts.get(provider.type) ?? 0;
                const hasInstance = props.providerInstances.some(
                  (pi) => pi.type === provider.type && pi.enabled
                );
                return (
                  <ProviderCard
                    key={provider.type}
                    provider={provider}
                    connections={connections}
                    isReady={hasInstance}
                    onClick={() => {
                      if (props.onSelectProvider) {
                        props.onSelectProvider(provider.type);
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

      {providers.length === 0 && (
        <div className="providersEmptyState">
          <p>{t("prov.noProviders") ?? "No provider types registered. Start the gateway to load the provider catalog."}</p>
        </div>
      )}

      {selected && (
        <ProviderDetailModal
          provider={selected}
          connections={connectionCounts.get(selected.type) ?? 0}
          onClose={() => setSelected(null)}
          onAddAccount={() => {
            if (props.onSelectProvider) {
              props.onSelectProvider(selected.type);
            }
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Provider Card ─────────────────────────────────────────

function ProviderCard(props: {
  provider: ProviderTypeEntry;
  connections: number;
  isReady: boolean;
  onClick: () => void;
}) {
  const { t } = useLang();
  const { provider, connections, isReady, onClick } = props;
  const authLabel = getAuthMethodLabel(provider.authMethods);
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
      className="providerCard2"
      onClick={onClick}
    >
      <img
        className="providerCard2Logo"
        src={provider.logoUrl ?? `/provider-logos/${provider.type}.png`}
        alt={provider.displayName}
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="providerCard2Info">
        <strong>{provider.displayName}</strong>
        <span className="providerCard2Auth">{authLabel}</span>
        <span className={`providerCard2Status ${statusClass}`}>{statusText}</span>
      </div>
      <div className="providerCard2Actions">
        <span className="providerCard2AddBtn" title={t("prov.addAccount")}>
          <Plus size={14} />
        </span>
      </div>
    </button>
  );
}

// ─── Provider Detail Modal ────────────────────────────────

function ProviderDetailModal(props: {
  provider: ProviderTypeEntry;
  connections: number;
  onClose: () => void;
  onAddAccount: () => void;
}) {
  const { t } = useLang();
  const { provider, connections, onClose, onAddAccount } = props;
  const authLabel = getAuthMethodLabel(provider.authMethods);

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalContent providerDetailModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{provider.displayName}</h2>
          <button className="iconButton" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="providerDetailBody">
          <div className="providerDetailHero">
            <img
              className="providerDetailLogo"
              src={provider.logoUrl ?? `/provider-logos/${provider.type}.png`}
              alt={provider.displayName}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div>
              <h3>{provider.displayName}</h3>
              {provider.defaultBaseUrl && (
                <a href={provider.defaultBaseUrl} target="_blank" rel="noreferrer" className="providerDetailLink">
                  <ExternalLink size={14} /> {provider.defaultBaseUrl}
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
              <span className="providerDetailStatValue">{authLabel}</span>
            </div>
            <div className="providerDetailStat">
              <span className="providerDetailStatLabel">{t("prov.category")}</span>
              <span className="providerDetailStatValue">
                {CATEGORY_LABELS[provider.category ?? "custom"]}
              </span>
            </div>
            <div className="providerDetailStat">
              <span className="providerDetailStatLabel">{t("prov.protocols")}</span>
              <span className="providerDetailStatValue">
                {provider.supportedProtocols.join(", ")}
              </span>
            </div>
          </div>
        </div>

        <div className="providerDetailFooter">
          <button className="ghostButton" onClick={onClose}>{t("common.close")}</button>
          <button className="primaryButton" onClick={onAddAccount}>
            <Plus size={16} /> {t("prov.addAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}
