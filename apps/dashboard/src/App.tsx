import {
  Activity,
  AlertCircle,
  AudioWaveform,
  BadgeCheck,
  Bot,
  BookOpen,
  Boxes,
  Brackets,
  Brush,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Cloud,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  FolderSearch,
  Database,
  Gauge,
  Globe,
  Hash,
  Info,
  KeyRound,
  ListChecks,
  Lock,
  Mic,
  Moon,
  Network,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Route,
  ScrollText,
  Send,
  Settings,
  Shield,
  Sun,
  Terminal,
  Timer,
  Trash2,
  Download,
  Users,
  Wand2,
  X,
  XCircle,
  Zap,
  Copy
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UsagePage } from "./UsagePage";
import { ProvidersPage } from "./ProvidersPage";
import { TeamsPage } from "./TeamsPage";
import { ProxyPoolsPage } from "./ProxyPoolsPage";
import { MediaProvidersPage } from "./MediaProvidersPage";
import { EmbeddingProvidersPage } from "./media/EmbeddingProvidersPage";
import { ImageProvidersPage } from "./media/ImageProvidersPage";
import { TTSProvidersPage } from "./media/TTSProvidersPage";
import { STTProvidersPage } from "./media/STTProvidersPage";
import { WebProvidersPage } from "./media/WebProvidersPage";
import { useLang } from "./i18n";
import { copyText } from "./clipboard";
import { getKnownModels } from "./providerModels";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { QuickSetupWizard } from "./components/QuickSetupWizard";
import { TopupModal } from "./components/TopupModal";
import { ModelPricingSection } from "./components/ModelPricingSection";
import { TestAllResultsModal, type TestAllPayload } from "./components/TestAllResultsModal";
import { SyncModelsModal } from "./components/SyncModelsModal";
import { ApiKeyEditModal, type ApiKeyForEdit } from "./components/ApiKeyEditModal";
import { ApiKeyExportModal } from "./components/ApiKeyExportModal";
import { ChannelOverridesEditor } from "./components/ChannelOverridesEditor";
import { CopyChannelModal } from "./components/CopyChannelModal";
import { ApiInfoPanel } from "./components/ApiInfoPanel";
import { UptimePanel } from "./components/UptimePanel";
import { FaqPanel } from "./components/FaqPanel";
import { LatencyPanel } from "./components/LatencyPanel";
import { CachePanel } from "./components/CachePanel";
import { SpendBadge } from "./components/SpendBadge";
import { VersionBadge } from "./components/VersionBadge";

// Provider metadata for detail page (website, API key URL, deprecation status)
const PROVIDER_META: Record<string, { website?: string; apiKeyUrl?: string; deprecated?: boolean }> = {
  kiro: { website: "https://kiro.dev" },
  windsurf: { website: "https://windsurf.com" },
  openai: { website: "https://platform.openai.com", apiKeyUrl: "https://platform.openai.com/api-keys" },
  anthropic: { website: "https://console.anthropic.com", apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  deepseek: { website: "https://deepseek.com", apiKeyUrl: "https://platform.deepseek.com/api_keys" },
  groq: { website: "https://groq.com", apiKeyUrl: "https://console.groq.com/keys" },
  xai: { website: "https://x.ai", apiKeyUrl: "https://console.x.ai" },
  mistral: { website: "https://mistral.ai", apiKeyUrl: "https://console.mistral.ai/api-keys" },
  together_ai: { website: "https://www.together.ai", apiKeyUrl: "https://api.together.xyz/settings/api-keys" },
  fireworks: { website: "https://fireworks.ai", apiKeyUrl: "https://fireworks.ai/account/api-keys" },
  perplexity: { website: "https://www.perplexity.ai", apiKeyUrl: "https://www.perplexity.ai/settings/api" },
  cerebras: { website: "https://www.cerebras.ai", apiKeyUrl: "https://cloud.cerebras.ai/platform" },
  cohere: { website: "https://cohere.com", apiKeyUrl: "https://dashboard.cohere.com/api-keys" },
  nebius: { website: "https://nebius.com", apiKeyUrl: "https://studio.nebius.com/settings/api-keys" },
  siliconflow: { website: "https://cloud.siliconflow.com", apiKeyUrl: "https://cloud.siliconflow.com/account/ak" },
  glm_zhipu: { website: "https://open.bigmodel.cn", apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  minimax: { website: "https://www.minimaxi.com", apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" },
  kimi_moonshot: { website: "https://kimi.moonshot.cn", apiKeyUrl: "https://platform.moonshot.ai/console/api-keys" },
  gemini: { website: "https://ai.google.dev", apiKeyUrl: "https://aistudio.google.com/app/apikey" },
  openrouter: { website: "https://openrouter.ai", apiKeyUrl: "https://openrouter.ai/settings/keys" },
  nvidia_nim: { website: "https://developer.nvidia.com/nim", apiKeyUrl: "https://build.nvidia.com/settings/api-keys" },
  alibaba: { website: "https://bailian.console.aliyun.com", apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1" },
  volcengine_ark: { website: "https://ark.cn-beijing.volces.com", apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" },
  byteplus: { website: "https://console.byteplus.com/ark", apiKeyUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey" },
  blackbox: { website: "https://blackbox.ai", apiKeyUrl: "https://www.blackbox.ai/api-management" },
  vercel_ai_gateway: { website: "https://vercel.com/ai-gateway", apiKeyUrl: "https://vercel.com/dashboard/~/ai-gateway" },
  claude_code: { website: "https://claude.ai", deprecated: true },
  codex: { website: "https://chatgpt.com/codex", deprecated: true },
  github_copilot: { website: "https://github.com/features/copilot", deprecated: true },
  cursor: { website: "https://cursor.com" },
  antigravity: { website: "https://antigravity.google", deprecated: true },
  hyperbolic: { website: "https://hyperbolic.xyz", apiKeyUrl: "https://app.hyperbolic.xyz/settings" },
  chutes: { website: "https://chutes.ai", apiKeyUrl: "https://chutes.ai/app/api" },
};

// ─── Toast System ──────────────────────────────────────────
type ToastItem = { id: number; type: "success" | "error" | "info"; text: string };
let toastId = 0;
let toastListener: ((t: ToastItem) => void) | null = null;

function showToast(type: ToastItem["type"], text: string) {
  toastListener?.({ id: ++toastId, type, text });
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    toastListener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 3500);
    };
    return () => { toastListener = null; };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toastContainer">
      {toasts.map((t) => (
        <div key={t.id} className={`toastItem toastItem--${t.type}`}>
          <span>{t.text}</span>
          <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}

type PageId =
  | "overview"
  | "providers"
  | "instances"
  | "accounts"
  | "models"
  | "profiles"
  | "endpoint"
  | "cli"
  | "playground"
  | "usage"
  | "requests"
  | "audit"
  | "teams"
  | "proxyPools"
  | "mediaProviders"
  | "mediaEmbedding"
  | "mediaImage"
  | "mediaTTS"
  | "mediaSTT"
  | "mediaWeb"
  | "settings"
  | "docs";

type ProviderType = {
  type: string;
  displayName: string;
  adapterName: string;
  authMethods: string[];
  supportedProtocols: string[];
  capabilities: {
    protocols: string[];
    flags: string[];
    maxInputTokens?: number;
    maxOutputTokens?: number;
  };
  category?: "free" | "oauth_subscription" | "api_key_cheap" | "api_key_premium" | "cloud_platform" | "custom";
  logoUrl?: string;
  defaultBaseUrl?: string;
};

type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  maxRetries: number;
  maxConcurrentRequests: number;
  accountSelectionStrategy?: string;
  priority?: number;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, string>;
  statusCodeMapping?: Record<string, "retry" | "disable" | "passthrough">;
  groupName?: string;
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    cooldownMs: number;
  };
};

type Account = {
  id: string;
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  status: "active" | "cooldown" | "disabled";
  maxConcurrency: number;
  credentialRef?: string;
  proxyPoolId?: string;
  runtime: {
    activeRequests: number;
    totalRequests: number;
    failedRequests: number;
    consecutiveFailures: number;
    lastError?: string;
  };
  metadata?: {
    healthCheckStatus?: "healthy" | "unhealthy" | "timeout";
    healthCheckMessage?: string;
    suspended?: boolean;
    suspensionReason?: string;
    machineId?: string;
    proxyPoolName?: string;
    [key: string]: unknown;
  };
  tokenStatus?: {
    expiresAt: string | null;
    lastRefreshedAt: string | null;
    credentialType: string;
  } | null;
  quota?: {
    requests: number;
    tokens: number;
    exhausted: boolean;
    dailyRequestLimit: number;
    dailyTokenLimit: number;
  } | null;
};

type ModelMapping = {
  id: string;
  publicModel: string;
  providerInstanceId: string;
  providerType: string;
  upstreamModel: string;
  enabled: boolean;
  capabilities: string[];
};

type RoutingProfile = {
  id: string;
  displayName: string;
  candidates: string[];
  fallback: boolean;
  enabled: boolean;
  requiredCapabilities: string[];
};

type ApiKey = {
  id: string;
  keyHash: string;
  enabled: boolean;
  owner?: string;
  balance?: number; // undefined = unlimited (no balance tracking)
  expiresAt?: string;
  allowedModels?: string[];
  allowedIps?: string[];
  groupName?: string;
  crossGroupRetry?: boolean;
  teamId?: string;
  /** Phase 32 — spending caps */
  dailySpendLimitUsd?: number;
  monthlySpendLimitUsd?: number;
  createdAt?: string;
  limits?: {
    minuteRequests: number;
    requestsPerMinuteLimit: number;
    dailyRequests: number;
    dailyRequestQuota: number;
    dailyTokens?: number;
    dailyTokenQuota?: number;
    minuteWindowStart: string;
    dailyWindowStart: string;
  };
};

type AuditLog = {
  id: string;
  action: string;
  actorKeyHash?: string;
  targetType?: string;
  targetId?: string;
  createdAt: string;
};

type UsageRecord = {
  id: string;
  requestId: string;
  protocol: string;
  model: string;
  providerType: string;
  providerInstanceId: string;
  accountId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
};

type RequestLog = {
  id: string;
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  apiKeyHash?: string;
  createdAt: string;
};

type ConfigRevision = {
  id: string;
  version: number;
  config: Record<string, unknown>;
  createdAt: string;
  publishedAt: string;
  actorKeyHash?: string;
};

type OAuthCallbackRecord = {
  state: string;
  code?: string;
  token?: string;
  error?: string;
  query: Record<string, string>;
  receivedAt: string;
  accountId?: string;
  accountCreated?: boolean;
  tokenExchanged?: boolean;
};

type CredentialMode = "oauth_pkce" | "refresh_token" | "api_key" | "mock_static";

type AddAccountFormState = {
  label: string;
  credentialMode: CredentialMode;
  weight: number;
  enabled: boolean;
  credentials: {
    refreshToken?: string;
    apiKey?: string;
    mockToken?: string;
  };
};

type HealthCheckResult = {
  status: "healthy" | "unhealthy" | "timeout";
  message?: string;
  latencyMs?: number;
};

type OAuthSessionPoll = {
  id: string;
  status: "pending" | "completed" | "failed" | "expired";
  providerType: string;
  label: string;
  result?: { accountId: string } | { error: string; errorCode?: string };
  expiresAt: string;
};

type AuthPreset = {
  id: string;
  label: string;
  credentialType:
    | "api_key"
    | "bearer_token"
    | "oauth"
    | "refresh_token"
    | "session_cookie"
    | "custom_json";
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type?: "text" | "password" | "datetime-local" | "textarea" | "hidden";
    placeholder?: string;
    required?: boolean;
  }>;
};

type DashboardData = {
  providerTypes: ProviderType[];
  providerInstances: ProviderInstance[];
  accounts: Account[];
  modelMappings: ModelMapping[];
  routingProfiles: RoutingProfile[];
  apiKeys: ApiKey[];
  usage: UsageRecord[];
  requestLogs: RequestLog[];
  auditLogs: AuditLog[];
};

const pages: Array<{
  id: PageId;
  label: string;
  icon: typeof Activity;
  description: string;
}> = [
  { id: "overview", label: "Overview", icon: Activity, description: "Gateway status and runtime readiness" },
  { id: "providers", label: "Providers", icon: Plug, description: "Provider connections and available models" },
  { id: "instances", label: "Provider Instances", icon: Network, description: "Runtime provider endpoints and circuit settings" },
  { id: "accounts", label: "Accounts", icon: Users, description: "Provider account pools and encrypted credentials" },
  { id: "models", label: "Models", icon: Database, description: "Public model names mapped to upstream channels — test, edit, and disable models served by the gateway" },
  { id: "profiles", label: "Routes", icon: Route, description: "Model routes with fallback support" },
  { id: "endpoint", label: "Endpoint & Keys", icon: Globe, description: "Base URLs to plug into client SDKs, full endpoint list, API key management" },
  { id: "cli", label: "CLI Tools", icon: Terminal, description: "Client setup snippets for coding tools" },
  { id: "playground", label: "Playground", icon: FlaskConical, description: "Test a routed model from the dashboard" },
  { id: "usage", label: "Usage", icon: Boxes, description: "Token usage captured from provider responses" },
  { id: "requests", label: "Request Logs", icon: ScrollText, description: "Metadata-only request log stream" },
  { id: "audit", label: "Audit Logs", icon: ListChecks, description: "Admin control-plane activity" },
  { id: "teams", label: "Teams", icon: Users, description: "Team quotas and access control" },
  { id: "proxyPools", label: "Proxy Pools", icon: Shield, description: "HTTP proxy pools for provider connections" },
  { id: "mediaProviders", label: "Media Providers", icon: FolderOpen, description: "Non-LLM AI service providers overview" },
  { id: "mediaEmbedding", label: "Embedding", icon: Brackets, description: "Embedding provider configuration" },
  { id: "mediaImage", label: "Text to Image", icon: Brush, description: "Image generation and understanding providers" },
  { id: "mediaTTS", label: "Text To Speech", icon: AudioWaveform, description: "Text-to-speech provider configuration" },
  { id: "mediaSTT", label: "Speech To Text", icon: Mic, description: "Speech-to-text provider configuration" },
  { id: "mediaWeb", label: "Web Fetch & Search", icon: FolderSearch, description: "Web search and fetch provider configuration" },
  { id: "settings", label: "Settings", icon: Settings, description: "Config revisions and security controls" },
  { id: "docs", label: "Docs", icon: BookOpen, description: "Documentation and usage guides" }
];

const pageById = new Map(pages.map((page) => [page.id, page]));

type NavGroup = {
  label: string;
  ids: PageId[];
  /** Optional: if set, this group is collapsible and the parent item routes to this page */
  parent?: PageId;
};

const navGroups: Array<NavGroup> = [
  { label: "Dashboard", ids: ["overview", "usage"] },
  { label: "Setup", ids: ["providers", "models", "profiles", "endpoint", "cli", "proxyPools"] },
  {
    label: "Media Providers",
    parent: "mediaProviders",
    ids: ["mediaEmbedding", "mediaImage", "mediaTTS", "mediaSTT", "mediaWeb"],
  },
  { label: "Monitor", ids: ["requests", "audit", "playground"] },
  { label: "Admin", ids: ["teams", "settings", "docs"] }
];

const initialData: DashboardData = {
  providerTypes: [],
  providerInstances: [],
  accounts: [],
  modelMappings: [],
  routingProfiles: [],
  apiKeys: [],
  usage: [],
  requestLogs: [],
  auditLogs: []
};

function LoginScreen(props: { onLogin: (key: string) => void }) {
  const { t } = useLang();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/v1/public/auth-info")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { isDefaultPassword?: boolean; defaultPassword?: string | null } | null) => {
        if (active && d?.isDefaultPassword && d.defaultPassword) {
          setDefaultPassword(d.defaultPassword);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError("");
    try {
      // Verify the password works as admin key by calling a simple admin endpoint
      const res = await fetch("/admin/v1/provider-types", {
        headers: { authorization: `Bearer ${password.trim()}` }
      });
      if (res.ok) {
        props.onLogin(password.trim());
      } else {
        setError(t("login.error.invalid"));
      }
    } catch {
      setError(t("login.error.connect"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loginScreen">
      <div className="loginCard">
        <div className="loginLogo">
          <Activity size={32} />
          <h1>{t("login.title")}</h1>
          <p>{t("login.subtitle")}</p>
        </div>
        <form className="loginForm" onSubmit={(e) => void handleSubmit(e)}>
          <label>
            <Lock size={16} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.placeholder")}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && <div className="loginError">{error}</div>}
          <button type="submit" className="primaryButton loginBtn" disabled={busy}>
            {busy ? t("login.verifying") : t("login.button")}
          </button>
        </form>
        {defaultPassword && (
          <small className="loginHint">
            {t("login.hint")} <code>{defaultPassword}</code>
          </small>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePageRaw] = useState<PageId>(() => {
    const path = window.location.pathname.replace(/^\/dashboard\/?/, "").replace(/\/$/, "");
    const match = pages.find((p) => p.id === path);
    return match ? match.id : "overview";
  });
  const setActivePage = (id: PageId) => {
    setActivePageRaw(id);
    window.history.pushState(null, "", `/dashboard/${id}`);
  };

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname.replace(/^\/dashboard\/?/, "").replace(/\/$/, "");
      const match = pages.find((p) => p.id === path);
      if (match) setActivePageRaw(match.id);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (window.localStorage.getItem("gateway.theme") === "dark" ? "dark" : "light")
  );
  // Sidebar collapsible group state — keyed by group.label
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [adminKey, setAdminKey] = useState(
    () => window.sessionStorage.getItem("gateway.adminKey") ?? ""
  );
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => !!window.sessionStorage.getItem("gateway.adminKey")
  );
  const [data, setData] = useState<DashboardData>(initialData);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { t, lang, setLang } = useLang();
  const api = useMemo(() => createApiClient(adminKey), [adminKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        providerTypes,
        providerInstances,
        accounts,
        modelMappings,
        routingProfiles,
        apiKeys,
        usage,
        requestLogs,
        auditLogs
      ] = await Promise.all([
        api.getList<ProviderType>("/admin/v1/provider-types"),
        api.getList<ProviderInstance>("/admin/v1/provider-instances"),
        api.getList<Account>("/admin/v1/accounts"),
        api.getList<ModelMapping>("/admin/v1/model-mappings"),
        api.getList<RoutingProfile>("/admin/v1/routing-profiles"),
        api.getList<ApiKey>("/admin/v1/api-keys"),
        api.getList<UsageRecord>("/admin/v1/usage"),
        api.getList<RequestLog>("/admin/v1/request-logs"),
        api.getList<AuditLog>("/admin/v1/audit-logs")
      ]);

      setData({
        providerTypes,
        providerInstances,
        accounts,
        modelMappings,
        routingProfiles,
        apiKeys,
        usage,
        requestLogs,
        auditLogs
      });
      setLastRefresh(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    window.sessionStorage.setItem("gateway.adminKey", adminKey);
  }, [adminKey]);

  useEffect(() => {
    window.localStorage.setItem("gateway.theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-poll every 3s when on realtime pages (usage, requests, overview)
  useEffect(() => {
    const realtimePages: PageId[] = ["usage", "requests", "overview"];
    if (!realtimePages.includes(activePage)) return;
    const interval = setInterval(() => {
      void refresh();
    }, 3_000);
    return () => clearInterval(interval);
  }, [activePage, refresh]);

  // Keyboard shortcuts
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const cmdRef = useRef<HTMLInputElement>(null);

  // Quick Setup Wizard
  const [showQuickSetup, setShowQuickSetup] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setCmdQuery("");
      }
      if (e.key === "Escape") setCmdOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (cmdOpen && cmdRef.current) cmdRef.current.focus();
  }, [cmdOpen]);

  const cmdResults = useMemo(() => {
    if (!cmdQuery.trim()) return pages;
    const q = cmdQuery.toLowerCase();
    return pages.filter((p) => p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }, [cmdQuery]);

  const activePageMeta = pageById.get(activePage);

  // Login gate
  if (!isAuthenticated) {
    return <LoginScreen onLogin={(key) => {
      setAdminKey(key);
      window.sessionStorage.setItem("gateway.adminKey", key);
      setIsAuthenticated(true);
    }} />;
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="trafficLights" aria-hidden="true">
          <span className="trafficLight red" />
          <span className="trafficLight yellow" />
          <span className="trafficLight green" />
        </div>
        <div className="brandBlock">
          <div className="appMark">
            <Shield size={20} />
          </div>
          <div className="brandText">
            <h1>X-Router</h1>
            <VersionBadge api={api} />
          </div>
        </div>

        <nav className="navList" aria-label="Dashboard">
          {navGroups.map((group) => {
            // Collapsible group: has a `parent` page that acts as both the
            // section header AND a clickable nav item. Children are shown
            // when the parent is active OR when one of the children is active.
            if (group.parent) {
              const parentPage = pageById.get(group.parent)!;
              const ParentIcon = parentPage.icon;
              const isParentActive = activePage === group.parent;
              const isChildActive = group.ids.some((id) => id === activePage);
              const isExpanded = expandedGroups[group.label] ?? (isParentActive || isChildActive);

              return (
                <div className="navGroup navGroup--collapsible" key={group.label}>
                  <button
                    className={`navItem navItem--parent${isParentActive ? " active" : ""}`}
                    onClick={() => {
                      setActivePage(group.parent!);
                      setExpandedGroups((prev) => ({ ...prev, [group.label]: !isExpanded }));
                    }}
                    title={t(`page.${group.parent}`)}
                  >
                    <ParentIcon size={20} strokeWidth={2.2} />
                    <span style={{ flex: 1, textAlign: "left" }}>{t(`page.${group.parent}`)}</span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {isExpanded && (
                    <div className="navSubList">
                      {group.ids.map((id) => {
                        const page = pageById.get(id)!;
                        const Icon = page.icon;
                        return (
                          <button
                            key={page.id}
                            className={`navItem navItem--child${page.id === activePage ? " active" : ""}`}
                            onClick={() => setActivePage(page.id)}
                            title={t(`page.${page.id}`)}
                          >
                            <Icon size={18} strokeWidth={2} />
                            <span>{t(`page.${page.id}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // Standard non-collapsible group with header label
            return (
              <div className="navGroup" key={group.label}>
                <p>{t(`nav.${group.label.toLowerCase()}`)}</p>
                {group.ids.map((id) => {
                  const page = pageById.get(id)!;
                  const Icon = page.icon;
                  return (
                    <button
                      key={page.id}
                      className={page.id === activePage ? "navItem active" : "navItem"}
                      onClick={() => setActivePage(page.id)}
                      title={t(`page.${page.id}`)}
                    >
                      <Icon size={20} strokeWidth={2.2} />
                      <span>{t(`page.${page.id}`)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="mainPanel">
        <header className="topbar">
          <div>
            <div className="statusLine">
              <span className="liveDot" />
              <span>{t("topbar.online")}</span>
            </div>
            <h2>{t(`page.${activePage}`)}</h2>
            <p>{t(`desc.${activePage}`)}</p>
          </div>
          <div className="topbarActions">
            <button
              className="primaryButton"
              type="button"
              onClick={() => setShowQuickSetup(true)}
              title={t("quickSetup.title") ?? "Quick Setup"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 12px" }}
            >
              <Wand2 size={14} />
              <span>{t("quickSetup.title") ?? "Quick Setup"}</span>
            </button>
            <button
              className="topbarSearch"
              onClick={() => { setCmdOpen(true); setCmdQuery(""); }}
              title="Search (Ctrl+K)"
            >
              <ScrollText size={15} />
              <span>{t("topbar.search")}</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              className="langToggle"
              onClick={() => setLang(lang === "en" ? "vi" : "en")}
              title={lang === "en" ? "Chuyển sang Tiếng Việt" : "Switch to English"}
            >
              {lang === "en" ? "EN" : "VI"}
            </button>
            <button
              className="iconButton"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={theme === "light" ? t("topbar.darkMode") : t("topbar.lightMode")}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="iconButton" onClick={() => void refresh()} title={t("topbar.refresh")}>
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
            <button
              className="iconButton"
              title="Logout"
              onClick={() => {
                window.sessionStorage.removeItem("gateway.adminKey");
                setIsAuthenticated(false);
                setAdminKey("");
              }}
            >
              <Lock size={16} />
            </button>
            {["usage", "requests", "overview"].includes(activePage) && lastRefresh > 0 && (
              <span className="liveIndicator">
                <span className="liveDot" />
                Live
              </span>
            )}
          </div>
        </header>

        {error ? <div className="errorBar">{error}</div> : null}

        <section className="contentBand">
          <PageContent
            activePage={activePage}
            data={data}
            api={api}
            refresh={refresh}
          />
        </section>
      </main>
      <ToastContainer />
      {/* Command Palette (Ctrl+K) */}
      {cmdOpen && (
        <div className="cmdOverlay" onClick={() => setCmdOpen(false)}>
          <div className="cmdPalette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={cmdRef}
              className="cmdInput"
              placeholder="Search pages... (Ctrl+K)"
              value={cmdQuery}
              onChange={(e) => setCmdQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && cmdResults.length > 0) {
                  setActivePage(cmdResults[0].id);
                  setCmdOpen(false);
                }
              }}
            />
            <div className="cmdResults">
              {cmdResults.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    className={`cmdItem ${p.id === activePage ? "cmdItem--active" : ""}`}
                    onClick={() => { setActivePage(p.id); setCmdOpen(false); }}
                  >
                    <Icon size={16} />
                    <div>
                      <span>{p.label}</span>
                      <small>{p.description}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Quick Setup Wizard */}
      {showQuickSetup && (
        <QuickSetupWizard
          api={api}
          onClose={() => setShowQuickSetup(false)}
          onCompleted={() => {
            void refresh();
            showToast("success", t("quickSetup.completed") ?? "Quick setup completed");
          }}
          onConnectProvider={(providerType) => {
            // Delegate to the existing per-provider connect flow by
            // navigating to the providers page; the user can pick the
            // provider tile and use the existing Add Connection modal.
            setActivePage("providers");
            setShowQuickSetup(false);
            showToast(
              "info",
              t("quickSetup.connectHint") ??
                `Open the ${providerType} card and add a connection. Re-open Quick Setup when done.`
            );
          }}
        />
      )}
    </div>
  );
}

function PageContent(props: {
  activePage: PageId;
  data: DashboardData;
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  switch (props.activePage) {
    case "overview":
      return <Overview data={props.data} api={props.api} />;
    case "providers":
      return (
        <ProvidersPageWithDetail
          providerTypes={props.data.providerTypes}
          instances={props.data.providerInstances}
          accounts={props.data.accounts}
          models={props.data.modelMappings}
          api={props.api}
          refresh={props.refresh}
        />
      );
    case "instances":
      return (
        <ProviderInstances
          providerTypes={props.data.providerTypes}
          instances={props.data.providerInstances}
          api={props.api}
          refresh={props.refresh}
        />
      );
    case "accounts":
      return (
        <Accounts
          accounts={props.data.accounts}
          instances={props.data.providerInstances}
          providerTypes={props.data.providerTypes}
          models={props.data.modelMappings}
          api={props.api}
          refresh={props.refresh}
        />
      );
    case "models":
      return (
        <ModelRegistry
          models={props.data.modelMappings}
          instances={props.data.providerInstances}
          api={props.api}
          refresh={props.refresh}
        />
      );
    case "profiles":
      return (
        <div className="stack">
          <RoutingProfiles
            profiles={props.data.routingProfiles}
            models={props.data.modelMappings}
            api={props.api}
            refresh={props.refresh}
          />
          <ModelAliasesSection api={props.api} />
        </div>
      );
    case "endpoint":
      return <EndpointPage keys={props.data.apiKeys} api={props.api} refresh={props.refresh} />;
    case "cli":
      return <CliTools keys={props.data.apiKeys} />;
    case "playground":
      return <Playground models={props.data.modelMappings} profiles={props.data.routingProfiles} />;
    case "usage":
      return <UsagePage usage={props.data.usage} providerInstances={props.data.providerInstances} accounts={props.data.accounts} api={props.api} />;
    case "requests":
      return <RequestLogs logs={props.data.requestLogs} apiKeys={props.data.apiKeys} api={props.api} refresh={props.refresh} />;
    case "audit":
      return <AuditLogs logs={props.data.auditLogs} />;
    case "settings":
      return <SettingsPage api={props.api} />;
    case "teams":
      return <TeamsPage api={props.api} refresh={props.refresh} />;
    case "proxyPools":
      return <ProxyPoolsPage api={props.api} refresh={props.refresh} />;
    case "mediaProviders":
      return <MediaProvidersPage api={props.api} refresh={props.refresh} />;
    case "mediaEmbedding":
      return <EmbeddingProvidersPage api={props.api} refresh={props.refresh} />;
    case "mediaImage":
      return <ImageProvidersPage api={props.api} refresh={props.refresh} />;
    case "mediaTTS":
      return <TTSProvidersPage api={props.api} refresh={props.refresh} />;
    case "mediaSTT":
      return <STTProvidersPage api={props.api} refresh={props.refresh} />;
    case "mediaWeb":
      return <WebProvidersPage api={props.api} refresh={props.refresh} />;
    case "docs":
      return <DocsPage />;
  }
}

function Overview({ data, api }: { data: DashboardData; api?: ReturnType<typeof createApiClient> }) {
  const { t } = useLang();
  const activeAccounts = data.accounts.filter((account) => account.status === "active").length;
  const disabledAccounts = data.accounts.filter((account) => account.status === "disabled").length;
  const cooldownAccounts = data.accounts.filter((account) => account.status === "cooldown").length;
  const totalRequests = data.accounts.reduce((sum, account) => sum + account.runtime.totalRequests, 0);
  const totalFailed = data.accounts.reduce((sum, account) => sum + account.runtime.failedRequests, 0);
  const totalTokens = data.usage.reduce((sum, u) => sum + u.totalTokens, 0);
  const enabledModels = data.modelMappings.filter((m) => m.enabled).length;
  const enabledRoutes = data.routingProfiles.filter((p) => p.enabled).length;

  // Sparkline: requests per hour (last 24h)
  const sparkData = useMemo(() => {
    const now = Date.now();
    const hours = 24;
    const buckets = new Array(hours).fill(0) as number[];
    for (const log of data.requestLogs) {
      const age = now - new Date(log.createdAt).getTime();
      const hourIdx = hours - 1 - Math.floor(age / 3_600_000);
      if (hourIdx >= 0 && hourIdx < hours) buckets[hourIdx]++;
    }
    return buckets;
  }, [data.requestLogs]);

  // Recent activity (last 5 requests)
  const recentRequests = [...data.requestLogs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Provider health
  const providerHealth = data.providerInstances.map((inst) => {
    const accounts = data.accounts.filter((a) => a.providerInstanceId === inst.id);
    const active = accounts.filter((a) => a.status === "active").length;
    const total = accounts.length;
    const reqs = accounts.reduce((s, a) => s + a.runtime.totalRequests, 0);
    const fails = accounts.reduce((s, a) => s + a.runtime.failedRequests, 0);
    return { ...inst, active, total, reqs, fails };
  });

  // Uptime approximation
  const errorRate = totalRequests > 0 ? ((totalFailed / totalRequests) * 100).toFixed(1) : "0.0";

  return (
    <div className="ovPage">
      {/* Metrics */}
      <div className="ovMetrics">
        <div className="ovMetricCard ovMetricCard--primary">
          <div className="ovMetricIcon"><Zap size={20} /></div>
          <div className="ovMetricBody">
            <span className="ovMetricValue">{totalRequests.toLocaleString()}</span>
            <span className="ovMetricLabel">{t("ov.totalRequests")}</span>
            <Sparkline data={sparkData} />
          </div>
        </div>
        <div className="ovMetricCard">
          <div className="ovMetricIcon"><Users size={20} /></div>
          <div className="ovMetricBody">
            <span className="ovMetricValue">{activeAccounts}</span>
            <span className="ovMetricLabel">{t("ov.activeAccounts")}</span>
            <span className="ovMetricSub">{cooldownAccounts} {t("ov.cooldown")} · {disabledAccounts} {t("ov.disabled")}</span>
          </div>
        </div>
        <div className="ovMetricCard">
          <div className="ovMetricIcon"><Database size={20} /></div>
          <div className="ovMetricBody">
            <span className="ovMetricValue">{enabledModels}</span>
            <span className="ovMetricLabel">{t("ov.activeModels")}</span>
            <span className="ovMetricSub">{enabledRoutes} {t("ov.routesConfigured")}</span>
          </div>
        </div>
        <div className="ovMetricCard">
          <div className="ovMetricIcon"><Gauge size={20} /></div>
          <div className="ovMetricBody">
            <span className="ovMetricValue">{totalTokens > 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(1)}M` : totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}</span>
            <span className="ovMetricLabel">{t("ov.totalTokens")}</span>
            <span className="ovMetricSub">{errorRate}% {t("ov.errorRate")}</span>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="ovGrid">
        {/* Left: System Status + Provider Health */}
        <div className="ovCol">
          {/* System Status */}
          <article className="ovCard">
            <header className="ovCardHeader">
              <Shield size={16} />
              <h3>{t("ov.systemStatus")}</h3>
            </header>
            <div className="ovStatusList">
              <div className="ovStatusItem">
                <span className="ovStatusDot ovStatusDot--ok" />
                <span>{t("ov.gateway")}</span>
                <span className="ovStatusValue">{t("ov.online")}</span>
              </div>
              <div className="ovStatusItem">
                <span className="ovStatusDot ovStatusDot--ok" />
                <span>{t("ov.adminApi")}</span>
                <span className="ovStatusValue">{t("ov.reachable")}</span>
              </div>
              <div className="ovStatusItem">
                <span className={`ovStatusDot ${data.accounts.length ? "ovStatusDot--ok" : "ovStatusDot--warn"}`} />
                <span>{t("ov.accounts")}</span>
                <span className="ovStatusValue">{data.accounts.length ? `${data.accounts.length} ${t("ov.configured")}` : t("ov.none")}</span>
              </div>
              <div className="ovStatusItem">
                <span className={`ovStatusDot ${enabledModels > 0 ? "ovStatusDot--ok" : "ovStatusDot--warn"}`} />
                <span>{t("ov.models")}</span>
                <span className="ovStatusValue">{enabledModels} {t("ov.active")}</span>
              </div>
              <div className="ovStatusItem">
                <span className="ovStatusDot ovStatusDot--ok" />
                <span>{t("ov.encryption")}</span>
                <span className="ovStatusValue">AES-256-GCM</span>
              </div>
            </div>
          </article>

          {/* Provider Health */}
          <article className="ovCard">
            <header className="ovCardHeader">
              <Network size={16} />
              <h3>{t("ov.providerHealth")}</h3>
            </header>
            {providerHealth.length === 0 ? (
              <p className="ovEmptyText">{t("ov.noProviders")}</p>
            ) : (
              <div className="ovProviderList">
                {providerHealth.map((p) => (
                  <div key={p.id} className="ovProviderRow">
                    <div className="ovProviderInfo">
                      <strong>{p.name}</strong>
                      <span>{p.active}/{p.total} {t("ov.accountsActive")}</span>
                    </div>
                    <div className="ovProviderStats">
                      <span className="ovProviderReqs">{p.reqs} {t("ov.reqs")}</span>
                      {p.fails > 0 && <span className="ovProviderFails">{p.fails} {t("ov.fails")}</span>}
                      <span className={`ovProviderStatus ${p.active > 0 ? "ovProviderStatus--ok" : "ovProviderStatus--down"}`}>
                        {p.active > 0 ? t("ov.healthy") : t("ov.down")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        {/* Right: Recent Activity + Quick Info */}
        <div className="ovCol">
          {/* Recent Activity */}
          <article className="ovCard">
            <header className="ovCardHeader">
              <Activity size={16} />
              <h3>{t("ov.recentActivity")}</h3>
            </header>
            {recentRequests.length === 0 ? (
              <p className="ovEmptyText">{t("ov.noRecentRequests")}</p>
            ) : (
              <div className="ovRecentList">
                {recentRequests.map((log) => (
                  <div key={log.id} className="ovRecentItem">
                    <div className="ovRecentLeft">
                      <span className={`rlMethod rlMethod--${log.method.toLowerCase()}`}>{log.method}</span>
                      <span className="ovRecentRoute">{log.route}</span>
                    </div>
                    <div className="ovRecentRight">
                      <span className={`rlStatus rlStatus--${log.statusCode < 400 ? "ok" : "err"}`}>{log.statusCode}</span>
                      <span className="ovRecentTime">{new Date(log.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* Quick Info */}
          <article className="ovCard">
            <header className="ovCardHeader">
              <Info size={16} />
              <h3>{t("ov.quickInfo")}</h3>
            </header>
            <div className="ovInfoGrid">
              <div className="ovInfoItem">
                <span className="ovInfoLabel">{t("ov.apiKeys")}</span>
                <span className="ovInfoValue">{data.apiKeys.length} {t("ov.issued")}</span>
              </div>
              <div className="ovInfoItem">
                <span className="ovInfoLabel">{t("ov.providersLabel")}</span>
                <span className="ovInfoValue">{data.providerTypes.length} {t("ov.types")} · {data.providerInstances.length} {t("ov.instances")}</span>
              </div>
              <div className="ovInfoItem">
                <span className="ovInfoLabel">{t("ov.auditEvents")}</span>
                <span className="ovInfoValue">{data.auditLogs.length} {t("ov.recorded")}</span>
              </div>
            </div>
          </article>

          {/* Phase 32 — Latency panel: top-10 slowest channels by p95 */}
          {api && <LatencyPanel api={api} />}

          {/* Phase 32 — Cache panel: hit ratio, entries, bytes used */}
          {api && <CachePanel api={api} />}

          {/* Phase 27 — Uptime panel: 24h hourly sparkline */}
          <UptimePanel sparkData={sparkData} errorRate={errorRate} totalRequests={totalRequests} />
        </div>
      </div>
    </div>
  );
}

type ProviderCatalogItem = {
  type: string;
  name: string;
  group: "OAuth Providers" | "Free Tier Providers" | "API Key Providers";
  supported: boolean;
};

const providerCatalogItems: ProviderCatalogItem[] = [
  // OAuth Providers
  { type: "kiro", name: "Kiro AI", group: "OAuth Providers", supported: true },
  { type: "windsurf", name: "Windsurf", group: "OAuth Providers", supported: true },
  { type: "claude", name: "Claude Code", group: "OAuth Providers", supported: false },
  { type: "codex", name: "OpenAI Codex", group: "OAuth Providers", supported: false },
  { type: "github-copilot", name: "GitHub Copilot", group: "OAuth Providers", supported: false },
  { type: "cursor", name: "Cursor IDE", group: "OAuth Providers", supported: false },
  { type: "cline", name: "Cline", group: "OAuth Providers", supported: false },
  { type: "kilocode", name: "Kilo Code", group: "OAuth Providers", supported: false },
  // Free Tier Providers
  { type: "opencode_free", name: "OpenCode Free", group: "Free Tier Providers", supported: false },
  { type: "openrouter", name: "OpenRouter", group: "Free Tier Providers", supported: false },
  { type: "nvidia", name: "NVIDIA NIM", group: "Free Tier Providers", supported: false },
  { type: "ollama", name: "Ollama Cloud", group: "Free Tier Providers", supported: false },
  { type: "gemini", name: "Gemini", group: "Free Tier Providers", supported: false },
  { type: "vertex_ai", name: "Vertex AI", group: "Free Tier Providers", supported: false },
  { type: "cloudflare", name: "Cloudflare", group: "Free Tier Providers", supported: false },
  // API Key Providers
  { type: "openai", name: "OpenAI", group: "API Key Providers", supported: false },
  { type: "anthropic", name: "Anthropic", group: "API Key Providers", supported: false },
  { type: "azure_openai", name: "Azure OpenAI", group: "API Key Providers", supported: false },
  { type: "deepseek", name: "DeepSeek", group: "API Key Providers", supported: false },
  { type: "groq", name: "Groq", group: "API Key Providers", supported: false },
  { type: "xai", name: "xAI (Grok)", group: "API Key Providers", supported: false },
  { type: "mistral", name: "Mistral", group: "API Key Providers", supported: false },
  { type: "together", name: "Together AI", group: "API Key Providers", supported: false },
  { type: "fireworks", name: "Fireworks AI", group: "API Key Providers", supported: false },
  { type: "perplexity", name: "Perplexity", group: "API Key Providers", supported: false },
  { type: "cerebras", name: "Cerebras", group: "API Key Providers", supported: false },
  { type: "cohere", name: "Cohere", group: "API Key Providers", supported: false },
  { type: "kimi", name: "Kimi", group: "API Key Providers", supported: false },
  { type: "alibaba", name: "Alibaba", group: "API Key Providers", supported: false },
  { type: "minimax", name: "Minimax", group: "API Key Providers", supported: false },
  { type: "siliconflow", name: "SiliconFlow", group: "API Key Providers", supported: false },
  { type: "nebius", name: "Nebius AI", group: "API Key Providers", supported: false },
  { type: "glm", name: "GLM Coding", group: "API Key Providers", supported: false },
  { type: "volcengine", name: "Volcengine Ark", group: "API Key Providers", supported: false },
];

function ProvidersPageWithDetail(props: {
  providerTypes: ProviderType[];
  instances: ProviderInstance[];
  accounts: Account[];
  models: ModelMapping[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  if (selectedType) {
    return (
      <UnifiedProviders
        providerTypes={props.providerTypes}
        instances={props.instances}
        accounts={props.accounts}
        models={props.models}
        api={props.api}
        refresh={props.refresh}
        initialType={selectedType}
        onBack={() => setSelectedType(null)}
      />
    );
  }

  return (
    <ProvidersPage
      accounts={props.accounts}
      providerInstances={props.instances}
      providerTypes={props.providerTypes}
      api={props.api}
      refresh={props.refresh}
      onSelectProvider={(type) => setSelectedType(type)}
    />
  );
}

function UnifiedProviders(props: {
  providerTypes: ProviderType[];
  instances: ProviderInstance[];
  accounts: Account[];
  models: ModelMapping[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
  initialType?: string;
  onBack?: () => void;
}) {
  const { t } = useLang();
  const supportedTypes = new Set(props.providerTypes.map((provider) => provider.type));
  const firstSupported =
    props.initialType ??
    providerCatalogItems.find((item) => supportedTypes.has(item.type))?.type ??
    props.instances[0]?.type ??
    "kiro";
  const [selectedType, setSelectedType] = useState<string | null>(props.initialType ?? null);
  const activeType = selectedType ?? firstSupported;
  const activeCatalog =
    providerCatalogItems.find((item) => item.type === activeType) ??
    ({ type: activeType, name: activeType, group: "OAuth Providers", supported: supportedTypes.has(activeType) } as ProviderCatalogItem);

  if (selectedType) {
    return (
      <ProviderDetail
        provider={activeCatalog}
        providerType={props.providerTypes.find((provider) => provider.type === activeType)}
        instances={props.instances.filter((instance) => instance.type === activeType)}
        accounts={props.accounts.filter((account) => account.providerType === activeType)}
        models={props.models.filter((model) => model.providerType === activeType)}
        api={props.api}
        refresh={props.refresh}
        onBack={() => props.onBack ? props.onBack() : setSelectedType(null)}
      />
    );
  }

  return (
    <div className="providersHub">
      <section className="providersHero">
        <div>
          <h2>{t("prov.title")}</h2>
          <p>{t("prov.manageByProvider")}</p>
        </div>
      </section>

      {(["OAuth Providers", "Free Tier Providers", "API Key Providers"] as const).map((group) => (
        <section className="providerGroup" key={group}>
          <div className="providerGroupHeader">
            <h3>{group}</h3>
            <button className="secondaryButton" type="button"><FlaskConical size={15} /> {t("prov.testAll")}</button>
          </div>
          <div className="providerHubGrid">
            {providerCatalogItems.filter((item) => item.group === group).map((item) => {
              const isSupported = supportedTypes.has(item.type) || item.supported;
              const accountCount = props.accounts.filter((account) => account.providerType === item.type).length;
              const modelCount = props.models.filter((model) => model.providerType === item.type).length;
              return (
                <button
                  className={isSupported ? "providerHubCard" : "providerHubCard disabled"}
                  type="button"
                  key={item.type}
                  onClick={() => isSupported && setSelectedType(item.type)}
                >
                  <ProviderLogo providerType={item.type} displayName={item.name} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{isSupported ? `${accountCount} ${t("prov.connections")} · ${modelCount} ${t("prov.models")}` : t("prov.phaseLater")}</span>
                  </div>
                  <StatusBadge status={accountCount > 0 ? "active" : isSupported ? "cooldown" : "disabled"} label={accountCount > 0 ? t("prov.connected").toLowerCase() : isSupported ? t("prov.ready").toLowerCase() : t("common.disabled").toLowerCase()} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Error messages in Vietnamese
const ERROR_MESSAGES_VI: Record<string, string> = {
  label_conflict: "Label đã tồn tại cho provider này",
  invalid_refresh_token: "Refresh token không hợp lệ (1-4096 ký tự)",
  invalid_api_key: "API key không hợp lệ (16-512 ký tự ASCII)",
  credential_mode_unsupported: "Chế độ credential không được hỗ trợ",
  invalid_label: "Label không hợp lệ (1-64 ký tự sau chuẩn hoá)",
  refresh_token_rejected: "Refresh token bị từ chối bởi provider",
  api_key_rejected: "API key bị từ chối bởi provider",
  oauth_session_in_progress: "Đang có phiên OAuth cho label này",
  rate_limited: "Quá nhiều yêu cầu, vui lòng thử lại sau",
  provider_type_not_found: "Provider không tồn tại",
  no_provider_instance: "Không tìm thấy instance cho provider này",
  persist_failed: "Lỗi lưu trữ, vui lòng thử lại",
};

function getErrorMessage(code: string, fallback: string): string {
  return ERROR_MESSAGES_VI[code] ?? fallback;
}

function getSupportedCredentialModes(providerType?: ProviderType): CredentialMode[] {
  if (!providerType) return ["api_key"];
  
  // Kiro uses device code flow (AWS Builder ID / IAM Identity Center) — show as OAuth option.
  // Windsurf: OAuth callback token is not a valid Cascade API key — only local import.
  const noExternalOAuth = ["windsurf"];
  
  const modes: CredentialMode[] = [];
  for (const method of providerType.authMethods) {
    if (method === "oauth" && !noExternalOAuth.includes(providerType.type)) {
      modes.push("oauth_pkce");
    } else if (method === "refresh_token") {
      modes.push("refresh_token");
    } else if (method === "api_key" || method === "bearer_token") {
      modes.push("api_key");
    }
  }
  
  // Mock provider supports mock_static
  if (providerType.type === "mock") {
    modes.push("mock_static");
  }
  
  return modes.length > 0 ? modes : ["api_key"];
}

function EditAccountModal(props: {
  account: Account;
  onClose: () => void;
  onSave: (patch: { displayName?: string; maxConcurrency?: number; weight?: number }) => void;
}) {
  const [displayName, setDisplayName] = useState(props.account.displayName);
  const [maxConcurrency, setMaxConcurrency] = useState(String(props.account.maxConcurrency ?? 3));
  const [weight, setWeight] = useState("1");

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={props.onClose}>
      <div className="confirmModal editAccountModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="windowDots"><span /><span /><span /></div>
          <h3>Edit Connection</h3>
          <button className="iconButton" type="button" onClick={props.onClose}><X size={18} /></button>
        </div>
        <div className="editAccountBody">
          <label className="formField">
            <span>Display Name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Account display name"
            />
          </label>
          <label className="formField">
            <span>Max Concurrency</span>
            <input
              type="number"
              min="1"
              max="100"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
            />
          </label>
          <label className="formField">
            <span>Weight (for weighted routing)</span>
            <input
              type="number"
              min="1"
              max="100"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
        </div>
        <div className="modalFooter">
          <button className="textButton" type="button" onClick={props.onClose}>Cancel</button>
          <button
            className="primaryButton"
            type="button"
            onClick={() => props.onSave({
              displayName: displayName.trim() || undefined,
              maxConcurrency: Number(maxConcurrency) || undefined,
              weight: Number(weight) || undefined
            })}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function AddAccountModal(props: {
  providerType: string;
  providerTypeInfo?: ProviderType;
  supportedModes: CredentialMode[];
  api: ReturnType<typeof createApiClient>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  type TabId = "oauth" | "token" | "local" | "azure" | "vertex" | "noauth" | "custom";

  // Determine form type based on provider type and auth methods
  const authMethods = props.providerTypeInfo?.authMethods ?? [];
  const isAzure = props.providerType === "azure_openai";
  const isVertex = props.providerType === "vertex_ai";
  const isNoAuth = authMethods.includes("none") || props.providerType === "opencode_free";
  const isCustom = props.providerType === "custom_openai" || props.providerType === "custom";
  const isNewOAuth = authMethods.includes("oauth") && !["kiro", "windsurf"].includes(props.providerType);

  const hasOAuth = props.supportedModes.includes("oauth_pkce") || isNewOAuth;
  const hasRefreshToken = props.supportedModes.includes("refresh_token");
  const hasApiKey = props.supportedModes.includes("api_key");
  const hasLocal = props.providerType === "kiro" || props.providerType === "windsurf";

  const defaultTab: TabId = isAzure ? "azure" : isVertex ? "vertex" : isNoAuth ? "noauth" : isCustom ? "custom" : hasOAuth ? "oauth" : hasRefreshToken || hasApiKey ? "token" : "local";
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // OAuth state
  const [oauthSession, setOauthSession] = useState<OAuthSessionPoll | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  // Token state
  const [tokenMode, setTokenMode] = useState<"refresh_token" | "api_key">(hasRefreshToken ? "refresh_token" : "api_key");
  const [tokenValue, setTokenValue] = useState("");

  // Local import state
  const [importing, setImporting] = useState(false);

  // Health check result state (Task 13.3)
  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);
  const [healthPending, setHealthPending] = useState(false);

  // Azure form state
  const [azureResourceName, setAzureResourceName] = useState("");
  const [azureDeploymentName, setAzureDeploymentName] = useState("");
  const [azureApiKey, setAzureApiKey] = useState("");
  const [azureApiVersion, setAzureApiVersion] = useState("2024-02-01");

  // Vertex AI form state
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexRegion, setVertexRegion] = useState("us-central1");
  const [vertexServiceAccountJson, setVertexServiceAccountJson] = useState("");

  // No-Auth form state
  const [noAuthBaseUrl, setNoAuthBaseUrl] = useState("");

  // Custom Provider form state
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customProtocol, setCustomProtocol] = useState<"openai_chat_completions" | "anthropic_messages">("openai_chat_completions");

  // OAuth polling — check callback status via state
  useEffect(() => {
    if (!oauthSession?.id || oauthSession.status !== "pending") return;

    const interval = setInterval(async () => {
      try {
        // Poll the OAuth callback by state
        const response = await props.api.get<{ data: { accountCreated?: boolean; tokenExchanged?: boolean; error?: string } }>(
          `/admin/v1/oauth/callbacks/${encodeURIComponent(oauthSession.id)}`
        );
        const callback = response.data;

        if (callback.accountCreated) {
          clearInterval(interval);
          props.onSuccess();
        } else if (callback.error) {
          clearInterval(interval);
          setErrors({ submit: callback.error });
          setOauthSession(null);
          setOauthUrl(null);
        }
      } catch {
        // 404 = callback not received yet, keep polling
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [oauthSession?.id, oauthSession?.status, props]);

  async function startOAuth() {
    const trimmedLabel = label.trim() || `${props.providerType}-${Date.now().toString(36)}`;
    const accountId = `acc_${props.providerType}_${Date.now().toString(36)}`;
    setSubmitting(true);
    setErrors({});
    try {
      // For new OAuth providers (not kiro/windsurf), use the generic OAuth start endpoint
      if (isNewOAuth) {
        const response = await props.api.post<{
          data: { authorizationUrl: string; state: string; providerType: string; expiresIn: number };
        }>("/admin/oauth/start", {
          providerType: props.providerType,
          displayName: trimmedLabel,
          owner: "team",
          maxConcurrency: 3,
          weight: 1,
          allowedModels: [],
          tags: ["oauth"],
        });

        const oauthData = response.data;
        setOauthUrl(oauthData.authorizationUrl);
        setOauthSession({
          id: oauthData.state,
          status: "pending",
          providerType: props.providerType,
          label: trimmedLabel,
          expiresAt: new Date(Date.now() + (oauthData.expiresIn * 1000)).toISOString(),
        });
      } else {
        // Use the legacy OAuth PKCE start endpoint for Kiro/Windsurf
        const response = await props.api.post<{
          data: { state: string; authorizationUrl: string; accountId: string; redirectUri: string };
        }>("/admin/v1/oauth/pkce/start", {
          providerType: props.providerType,
          providerInstanceId: `provider_${props.providerType}_main`,
          accountId,
          displayName: trimmedLabel,
          owner: "team",
          maxConcurrency: 3,
          weight: 1,
          allowedModels: [],
          tags: ["oauth"],
          authorizationEndpoint: defaultOAuthEndpoint(props.providerType),
          redirectUri: defaultOAuthRedirectUri(props.providerType),
          clientId: defaultOAuthClientId(props.providerType) || undefined,
          extraParams: oauthExtraParams(props.providerType, {
            prompt: "login",
            redirectParametersType: "query",
            workflow: "onboarding"
          })
        });

        const oauthData = response.data;
        setOauthUrl(oauthData.authorizationUrl);
        setOauthSession({
          id: oauthData.state,
          status: "pending",
          providerType: props.providerType,
          label: trimmedLabel,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
    } catch (caught) {
      const error = caught as { error?: { code?: string; message?: string } };
      setErrors({ submit: error.error?.message ?? "Không thể tạo phiên OAuth" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setErrors({ label: "Label không được để trống" }); return; }
    if (!tokenValue.trim()) { setErrors({ token: "Token không được để trống" }); return; }

    setSubmitting(true);
    setErrors({});
    try {
      await props.api.post(`/admin/v1/providers/${props.providerType}/accounts`, {
        label: trimmedLabel,
        credentialMode: tokenMode,
        weight: 1,
        enabled: true,
        credentials: tokenMode === "refresh_token"
          ? { refreshToken: tokenValue.trim() }
          : { apiKey: tokenValue.trim() },
      });
      props.onSuccess();
    } catch (caught) {
      const error = caught as { error?: { code?: string; message?: string } };
      const code = error.error?.code ?? "unknown";
      setErrors({ submit: getErrorMessage(code, error.error?.message ?? "Đã xảy ra lỗi") });
    } finally {
      setSubmitting(false);
    }
  }

  async function importLocal() {
    setImporting(true);
    setErrors({});
    try {
      const path = props.providerType === "kiro"
        ? "/admin/v1/oauth/kiro/import-local"
        : "/admin/v1/oauth/windsurf/import-local";
      await props.api.post(path, {
        providerInstanceId: `provider_${props.providerType}_main`,
        accountId: `acc_${props.providerType}_${Date.now().toString(36)}`,
        displayName: label.trim() || `${props.providerType} (local)`,
        owner: "team",
        maxConcurrency: 3,
        weight: 1,
        allowedModels: [],
        tags: ["local-import"],
        region: "us-east-1"
      });
      props.onSuccess();
    } catch (caught) {
      const error = caught as { error?: { code?: string; message?: string } };
      setErrors({ submit: error.error?.message ?? "Không tìm thấy token local. Đăng nhập IDE trước rồi thử lại." });
    } finally {
      setImporting(false);
    }
  }

  // Submit provider account via POST /admin/provider-accounts (new multi-provider API)
  async function submitProviderAccount(
    displayName: string,
    credentials: Record<string, unknown>,
    config: Record<string, unknown> = {}
  ) {
    setSubmitting(true);
    setErrors({});
    setHealthResult(null);
    setHealthPending(true);
    try {
      const response = await props.api.post<{
        data: {
          id: string;
          providerType: string;
          displayName: string;
          status: string;
          healthCheck?: HealthCheckResult;
        };
      }>("/admin/provider-accounts", {
        providerType: props.providerType,
        displayName,
        credentials,
        config,
        weight: 1,
        maxConcurrency: 3,
        tags: [],
      });

      const result: HealthCheckResult = response.data.healthCheck ?? {
        status: response.data.status === "active" ? "healthy" : "unhealthy",
        message: response.data.status === "active" ? "Connection successful" : "Connection failed",
      };
      setHealthResult(result);
      setHealthPending(false);

      if (result.status === "healthy") {
        props.onSuccess();
      }
      // For timeout/unhealthy, user decides via buttons shown in UI
    } catch (caught) {
      setHealthPending(false);
      const msg = caught instanceof Error ? caught.message : "Failed to add account";
      setErrors({ submit: msg });
      setHealthResult({ status: "unhealthy", message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAzure(event: React.FormEvent) {
    event.preventDefault();
    if (!azureResourceName.trim()) { setErrors({ azureResourceName: "Resource name is required" }); return; }
    if (!azureDeploymentName.trim()) { setErrors({ azureDeploymentName: "Deployment name is required" }); return; }
    if (!azureApiKey.trim()) { setErrors({ azureApiKey: "API key is required" }); return; }

    const displayName = label.trim() || `Azure ${azureResourceName}/${azureDeploymentName}`;
    await submitProviderAccount(
      displayName,
      { apiKey: azureApiKey.trim() },
      { resourceName: azureResourceName.trim(), deploymentName: azureDeploymentName.trim(), apiVersion: azureApiVersion.trim() }
    );
  }

  async function submitVertex(event: React.FormEvent) {
    event.preventDefault();
    if (!vertexProjectId.trim()) { setErrors({ vertexProjectId: "Project ID is required" }); return; }
    if (!vertexServiceAccountJson.trim()) { setErrors({ vertexServiceAccountJson: "Service account JSON is required" }); return; }

    // Validate JSON
    try {
      JSON.parse(vertexServiceAccountJson.trim());
    } catch {
      setErrors({ vertexServiceAccountJson: "Invalid JSON format" });
      return;
    }

    const displayName = label.trim() || `Vertex AI (${vertexProjectId})`;
    await submitProviderAccount(
      displayName,
      { serviceAccountJson: vertexServiceAccountJson.trim() },
      { projectId: vertexProjectId.trim(), region: vertexRegion.trim() }
    );
  }

  async function submitNoAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!noAuthBaseUrl.trim()) { setErrors({ noAuthBaseUrl: "Base URL is required" }); return; }

    const displayName = label.trim() || `${props.providerType} (${noAuthBaseUrl.trim()})`;
    await submitProviderAccount(
      displayName,
      {},
      { baseUrl: noAuthBaseUrl.trim() }
    );
  }

  async function submitCustom(event: React.FormEvent) {
    event.preventDefault();
    if (!customDisplayName.trim()) { setErrors({ customDisplayName: "Display name is required" }); return; }
    if (!customBaseUrl.trim()) { setErrors({ customBaseUrl: "Base URL is required" }); return; }

    await submitProviderAccount(
      customDisplayName.trim(),
      customApiKey.trim() ? { apiKey: customApiKey.trim() } : {},
      { baseUrl: customBaseUrl.trim(), protocol: customProtocol }
    );
  }

  async function submitApiKeyForm(event: React.FormEvent) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setErrors({ label: "Label is required" }); return; }
    if (!tokenValue.trim()) { setErrors({ token: "API Key is required" }); return; }

    await submitProviderAccount(
      trimmedLabel,
      { apiKey: tokenValue.trim() },
      {}
    );
  }

  // Determine provider display name
  const providerDisplayName = props.providerTypeInfo?.displayName ?? props.providerType;

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={props.onClose}>
      <div className="addAccountModal addAccountModalV2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="windowDots"><span /><span /><span /></div>
          <h3>Add Account — {providerDisplayName}</h3>
          <button className="iconButton" type="button" onClick={props.onClose}><X size={18} /></button>
        </div>

        {/* Health Check Result Banner (Task 13.3) */}
        {healthResult && (
          <div className={`healthCheckBanner healthCheckBanner--${healthResult.status}`}>
            <div className="healthCheckBannerContent">
              {healthResult.status === "healthy" && <CheckCircle2 size={18} />}
              {healthResult.status === "unhealthy" && <XCircle size={18} />}
              {healthResult.status === "timeout" && <Activity size={18} />}
              <div>
                <strong>
                  {healthResult.status === "healthy" && "Connection Healthy"}
                  {healthResult.status === "unhealthy" && "Connection Unhealthy"}
                  {healthResult.status === "timeout" && "Connection Timeout"}
                </strong>
                {healthResult.message && <p>{healthResult.message}</p>}
              </div>
            </div>
            {healthResult.status === "timeout" && (
              <div className="healthCheckBannerActions">
                <button className="primaryButton" type="button" onClick={props.onSuccess}>Save Anyway</button>
                <button className="ghostButton" type="button" onClick={props.onClose}>Cancel</button>
              </div>
            )}
            {healthResult.status === "unhealthy" && (
              <div className="healthCheckBannerActions">
                <button className="ghostButton" type="button" onClick={() => setHealthResult(null)}>Try Again</button>
                <button className="ghostButton" type="button" onClick={props.onClose}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* Tabs — only show for providers with multiple auth options or legacy providers */}
        {!isAzure && !isVertex && !isNoAuth && !isCustom && (<>
        {/* Auth Method Selection — card-based like 9router */}
        {!oauthSession && (
          <div className="addAccMethodCards">
            <p className="addAccMethodHint">Choose your authentication method:</p>

            {hasOAuth && (
              <button
                type="button"
                className={`addAccMethodCard ${activeTab === "oauth" ? "addAccMethodCard--active" : ""}`}
                onClick={() => setActiveTab("oauth")}
              >
                <div className="addAccMethodCardIcon"><Globe size={18} /></div>
                <div className="addAccMethodCardBody">
                  <strong>{props.providerType === "kiro" ? "AWS Builder ID" : isNewOAuth ? "Connect via Browser" : "OAuth Authorization"}</strong>
                  <span>{props.providerType === "kiro"
                    ? "Recommended for most users. Free AWS account required."
                    : isNewOAuth
                      ? `Authorize ${providerDisplayName} in your browser.`
                      : "Authorize via OAuth in your browser."
                  }</span>
                </div>
              </button>
            )}

            {(hasRefreshToken || hasApiKey) && (
              <button
                type="button"
                className={`addAccMethodCard ${activeTab === "token" ? "addAccMethodCard--active" : ""}`}
                onClick={() => setActiveTab("token")}
              >
                <div className="addAccMethodCardIcon"><KeyRound size={18} /></div>
                <div className="addAccMethodCardBody">
                  <strong>{hasApiKey && !hasRefreshToken ? "API Key" : "Token / API Key"}</strong>
                  <span>{hasRefreshToken ? "Paste refresh token or API key." : "Paste your API key to connect."}</span>
                </div>
              </button>
            )}

            {hasLocal && (
              <button
                type="button"
                className={`addAccMethodCard ${activeTab === "local" ? "addAccMethodCard--active" : ""}`}
                onClick={() => setActiveTab("local")}
              >
                <div className="addAccMethodCardIcon"><Database size={18} /></div>
                <div className="addAccMethodCardBody">
                  <strong>Import Token</strong>
                  <span>Paste refresh token from {props.providerType === "kiro" ? "Kiro" : "Windsurf"} IDE.</span>
                </div>
              </button>
            )}
          </div>
        )}

        {errors.submit && <div className="formNotice error">{errors.submit}</div>}

        {/* Tab: OAuth */}
        {activeTab === "oauth" && (
          <div className="addAccTabContent">
            {!oauthSession ? (
              <>
                <p className="addAccDesc">
                  {isNewOAuth
                    ? `Click the button below to connect your ${providerDisplayName} account via browser.`
                    : `Nhấn nút bên dưới và hoàn tất ủy quyền ${props.providerType === "kiro" ? "Kiro" : "Windsurf"} trong trình duyệt.`}
                </p>
                <label className="addAccField">
                  <span>Label (optional)</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`${props.providerType}-account`}
                  />
                </label>
                <button
                  type="button"
                  className="primaryButton addAccOAuthBtn"
                  disabled={submitting}
                  onClick={() => void startOAuth()}
                >
                  <Globe size={16} />
                  {submitting ? "Creating link..." : isNewOAuth ? "Connect via Browser" : "Mở trong trình duyệt"}
                </button>
              </>
            ) : (
              <>
                <label className="addAccField">
                  <span>{isNewOAuth ? "Authorization Link" : "Liên kết xác thực"}</span>
                  <div className="addAccOAuthUrlRow">
                    <input readOnly value={oauthUrl ?? ""} className="addAccOAuthUrl" />
                    <button
                      type="button"
                      className="iconButton"
                      title="Copy"
                      onClick={() => void copyText(oauthUrl ?? "")}
                    >
                      <Clipboard size={16} />
                    </button>
                  </div>
                </label>
                <button
                  type="button"
                  className="primaryButton addAccOAuthBtn"
                  onClick={() => window.open(oauthUrl ?? "", "_blank", "noopener,noreferrer")}
                >
                  <Globe size={16} /> Mở trong trình duyệt
                </button>
                <div className="addAccPolling">
                  <RefreshCw size={14} className="spin" />
                  <span>Đang chờ ủy quyền...</span>
                </div>
                <p className="addAccHint">Sau khi ủy quyền, cửa sổ này sẽ tự cập nhật.</p>
              </>
            )}
          </div>
        )}

        {/* Tab: Token / Key */}
        {activeTab === "token" && (
          <form className="addAccTabContent" onSubmit={(e) => {
            // For new multi-provider types, use the new provider-accounts API with health check
            if (!["kiro", "windsurf"].includes(props.providerType)) {
              void submitApiKeyForm(e);
            } else {
              void submitToken(e);
            }
          }}>
            {/* Mode toggle: Single / Bulk */}
            {!["kiro", "windsurf"].includes(props.providerType) && (
              <div className="addAccTokenToggle">
                <button type="button" className={tokenMode === "api_key" ? "active" : ""} onClick={() => setTokenMode("api_key")}>Single</button>
                <button type="button" className={tokenMode === "refresh_token" ? "active" : ""} onClick={() => setTokenMode("refresh_token")}>Bulk Add</button>
              </div>
            )}

            {/* Bulk Add mode */}
            {!["kiro", "windsurf"].includes(props.providerType) && tokenMode === "refresh_token" && (
              <>
                <p className="addAccDesc">One key per line. Format: <code>name|apiKey</code> or just <code>apiKey</code> (auto-named).</p>
                <label className="addAccField">
                  <span>API Keys (one per line)</span>
                  <textarea
                    placeholder={"Production|sk-abc123...\nStaging|sk-def456...\nsk-key-only-auto-named"}
                    value={tokenValue}
                    onChange={(e) => setTokenValue(e.target.value)}
                    disabled={submitting}
                    rows={5}
                  />
                </label>
                <button type="button" className="primaryButton" disabled={submitting || !tokenValue.trim()} onClick={async () => {
                  setSubmitting(true);
                  setErrors({});
                  const lines = tokenValue.split("\n").map(l => l.trim()).filter(Boolean);
                  let success = 0, failed = 0;
                  for (let i = 0; i < lines.length; i++) {
                    const parts = lines[i].split("|");
                    const apiKey = parts.length >= 2 ? parts.slice(1).join("|").trim() : parts[0].trim();
                    const displayName = parts.length >= 2 ? parts[0].trim() : `${providerDisplayName} Key ${i + 1}`;
                    try {
                      await props.api.post("/admin/provider-accounts", {
                        providerType: props.providerType,
                        displayName,
                        credentials: { apiKey },
                        config: {},
                        weight: 1,
                        maxConcurrency: 3,
                        tags: [],
                      });
                      success++;
                    } catch { failed++; }
                  }
                  setSubmitting(false);
                  if (failed === 0) { props.onSuccess(); }
                  else { setErrors({ submit: `${success} added, ${failed} failed` }); }
                }}>
                  {submitting ? "Adding..." : "Add All Keys"}
                </button>
              </>
            )}

            {/* Single mode (or kiro/windsurf) */}
            {(["kiro", "windsurf"].includes(props.providerType) || tokenMode === "api_key") && (<>
            {props.providerType === "windsurf" && (
              <div className="addAccGetTokenHint">
                <span>Lấy token tại:</span>
                <button
                  type="button"
                  className="addAccGetTokenBtn"
                  onClick={() => window.open("https://windsurf.com/show-auth-token", "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink size={14} /> windsurf.com/show-auth-token
                </button>
              </div>
            )}
            <label className="addAccField">
              <span>Label</span>
              <input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Display name for account"
              />
              {errors.label && <small className="fieldError">{errors.label}</small>}
            </label>
            {["kiro", "windsurf"].includes(props.providerType) && hasRefreshToken && hasApiKey && (
              <div className="addAccTokenToggle">
                <button type="button" className={tokenMode === "refresh_token" ? "active" : ""} onClick={() => setTokenMode("refresh_token")}>Refresh Token</button>
                <button type="button" className={tokenMode === "api_key" ? "active" : ""} onClick={() => setTokenMode("api_key")}>API Key</button>
              </div>
            )}
            <label className="addAccField">
              <span>{["kiro", "windsurf"].includes(props.providerType) ? (tokenMode === "refresh_token" ? "Refresh Token" : "API Key") : "API Key"}</span>
              <textarea
                placeholder={["kiro", "windsurf"].includes(props.providerType) ? (tokenMode === "refresh_token" ? "Enter refresh token" : "Enter API key") : "sk-..."}
                value={tokenValue}
                onChange={(e) => setTokenValue(e.target.value)}
                disabled={submitting}
                rows={3}
              />
              {errors.token && <small className="fieldError">{errors.token}</small>}
            </label>
            {/* Validate button for API key providers */}
            {!["kiro", "windsurf"].includes(props.providerType) && healthPending && (
              <div className="addAccPolling">
                <RefreshCw size={14} className="spin" />
                <span>Validating connection...</span>
              </div>
            )}
            <button type="submit" className="primaryButton" disabled={submitting || !label.trim() || !tokenValue.trim()}>
              {submitting ? "Adding..." : healthPending ? "Checking..." : "Add Account"}
            </button>
            </>)}
          </form>
        )}

        {/* Tab: Local Import */}
        {activeTab === "local" && (
          <div className="addAccTabContent">
            <p className="addAccDesc">
              Tự động tìm và import token từ {props.providerType === "kiro" ? "Kiro" : "Windsurf"} IDE đã đăng nhập trên máy này.
            </p>
            <label className="addAccField">
              <span>Label (tùy chọn)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`${props.providerType} (local)`}
              />
            </label>
            <button
              type="button"
              className="primaryButton addAccOAuthBtn"
              disabled={importing}
              onClick={() => void importLocal()}
            >
              <Database size={16} />
              {importing ? "Đang import..." : `Import từ ${props.providerType === "kiro" ? "Kiro" : "Windsurf"} IDE`}
            </button>
            <p className="addAccHint">
              Tìm tại: {props.providerType === "kiro" ? "~/.aws/sso/cache/" : "~/.codeium/windsurf/db/"}
            </p>
          </div>
        )}
        </>)}

        {/* Azure OpenAI Form */}
        {isAzure && (
          <form className="addAccTabContent" onSubmit={(e) => void submitAzure(e)}>
            <label className="addAccField">
              <span>Display Name (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Azure Deployment" />
            </label>
            <label className="addAccField">
              <span>Resource Name *</span>
              <input autoFocus value={azureResourceName} onChange={(e) => setAzureResourceName(e.target.value)} placeholder="my-resource" />
              {errors.azureResourceName && <small className="fieldError">{errors.azureResourceName}</small>}
              <small className="fieldHint">The Azure resource name (e.g. my-resource.openai.azure.com)</small>
            </label>
            <label className="addAccField">
              <span>Deployment Name *</span>
              <input value={azureDeploymentName} onChange={(e) => setAzureDeploymentName(e.target.value)} placeholder="gpt-4o" />
              {errors.azureDeploymentName && <small className="fieldError">{errors.azureDeploymentName}</small>}
            </label>
            <label className="addAccField">
              <span>API Key *</span>
              <input type="password" value={azureApiKey} onChange={(e) => setAzureApiKey(e.target.value)} placeholder="Enter Azure API key" />
              {errors.azureApiKey && <small className="fieldError">{errors.azureApiKey}</small>}
            </label>
            <label className="addAccField">
              <span>API Version</span>
              <input value={azureApiVersion} onChange={(e) => setAzureApiVersion(e.target.value)} placeholder="2024-02-01" />
              <small className="fieldHint">Default: 2024-02-01</small>
            </label>
            {errors.submit && <div className="formNotice error">{errors.submit}</div>}
            <button type="submit" className="primaryButton" disabled={submitting || !azureResourceName.trim() || !azureDeploymentName.trim() || !azureApiKey.trim()}>
              {submitting ? "Connecting..." : "Add Azure Account"}
            </button>
          </form>
        )}

        {/* Vertex AI Form */}
        {isVertex && (
          <form className="addAccTabContent" onSubmit={(e) => void submitVertex(e)}>
            <label className="addAccField">
              <span>Display Name (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Vertex AI Project" />
            </label>
            <label className="addAccField">
              <span>Project ID *</span>
              <input autoFocus value={vertexProjectId} onChange={(e) => setVertexProjectId(e.target.value)} placeholder="my-gcp-project" />
              {errors.vertexProjectId && <small className="fieldError">{errors.vertexProjectId}</small>}
            </label>
            <label className="addAccField">
              <span>Region</span>
              <input value={vertexRegion} onChange={(e) => setVertexRegion(e.target.value)} placeholder="us-central1" />
              <small className="fieldHint">Default: us-central1</small>
            </label>
            <label className="addAccField">
              <span>Service Account JSON *</span>
              <textarea
                value={vertexServiceAccountJson}
                onChange={(e) => setVertexServiceAccountJson(e.target.value)}
                placeholder='Paste service account JSON key file content here...'
                rows={6}
              />
              {errors.vertexServiceAccountJson && <small className="fieldError">{errors.vertexServiceAccountJson}</small>}
              <small className="fieldHint">Paste the contents of your service account key JSON file, or upload below</small>
            </label>
            <label className="addAccField">
              <span>Or upload JSON file</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const content = ev.target?.result;
                      if (typeof content === "string") setVertexServiceAccountJson(content);
                    };
                    reader.readAsText(file);
                  }
                }}
              />
            </label>
            {errors.submit && <div className="formNotice error">{errors.submit}</div>}
            <button type="submit" className="primaryButton" disabled={submitting || !vertexProjectId.trim() || !vertexServiceAccountJson.trim()}>
              {submitting ? "Connecting..." : "Add Vertex AI Account"}
            </button>
          </form>
        )}

        {/* No-Auth Form */}
        {isNoAuth && (
          <form className="addAccTabContent" onSubmit={(e) => void submitNoAuth(e)}>
            <label className="addAccField">
              <span>Display Name (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${providerDisplayName} account`} />
            </label>
            <label className="addAccField">
              <span>Base URL *</span>
              <input autoFocus value={noAuthBaseUrl} onChange={(e) => setNoAuthBaseUrl(e.target.value)} placeholder="https://api.example.com" />
              {errors.noAuthBaseUrl && <small className="fieldError">{errors.noAuthBaseUrl}</small>}
              <small className="fieldHint">The API base URL (no authentication required)</small>
            </label>
            {errors.submit && <div className="formNotice error">{errors.submit}</div>}
            <button type="submit" className="primaryButton" disabled={submitting || !noAuthBaseUrl.trim()}>
              {submitting ? "Connecting..." : "Add Account"}
            </button>
          </form>
        )}

        {/* Custom Provider Form */}
        {isCustom && (
          <form className="addAccTabContent" onSubmit={(e) => void submitCustom(e)}>
            <label className="addAccField">
              <span>Display Name *</span>
              <input autoFocus value={customDisplayName} onChange={(e) => setCustomDisplayName(e.target.value)} placeholder="My Custom Provider" />
              {errors.customDisplayName && <small className="fieldError">{errors.customDisplayName}</small>}
            </label>
            <label className="addAccField">
              <span>Base URL *</span>
              <input value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.example.com" />
              {errors.customBaseUrl && <small className="fieldError">{errors.customBaseUrl}</small>}
            </label>
            <label className="addAccField">
              <span>API Key (optional)</span>
              <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="Enter API key if required" />
            </label>
            <label className="addAccField">
              <span>Protocol</span>
              <select value={customProtocol} onChange={(e) => setCustomProtocol(e.target.value as "openai_chat_completions" | "anthropic_messages")}>
                <option value="openai_chat_completions">OpenAI Chat Completions</option>
                <option value="anthropic_messages">Anthropic Messages</option>
              </select>
            </label>
            {errors.submit && <div className="formNotice error">{errors.submit}</div>}
            <button type="submit" className="primaryButton" disabled={submitting || !customDisplayName.trim() || !customBaseUrl.trim()}>
              {submitting ? "Connecting..." : "Add Custom Provider"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ProviderDetail(props: {
  provider: ProviderCatalogItem;
  providerType?: ProviderType;
  instances: ProviderInstance[];
  accounts: Account[];
  models: ModelMapping[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useLang();
  const instance =
    props.instances[0] ??
    ({
      id: `provider_${props.provider.type}_main`,
      type: props.provider.type,
      name: props.provider.name,
      enabled: true,
      maxRetries: 1,
      maxConcurrentRequests: 10,
      circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 30000 }
    } as ProviderInstance);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<AccountTestResult | null>(null);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [copyChannelModalOpen, setCopyChannelModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Account | null>(null);
  const [deleteModelCandidate, setDeleteModelCandidate] = useState<ModelMapping | null>(null);
  const [editAccountCandidate, setEditAccountCandidate] = useState<Account | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [oauthLaunch, setOAuthLaunch] = useState<{
    state: string;
    authorizationUrl: string;
    accountId: string;
    redirectUri: string;
  } | null>(null);
  const [modelId, setModelId] = useState("");
  const [accountDraft, setAccountDraft] = useState({
    id: makeAccountId(props.provider.type),
    displayName: `${props.provider.name} Account`,
    maxConcurrency: "3",
    weight: "1"
  });
  const activeAccounts = props.accounts.filter((account) => account.status !== "disabled").length;

  async function createAuthLink() {
    try {
      const response = await props.api.post<{
        data: {
          state: string;
          authorizationUrl: string;
          accountId: string;
          redirectUri: string;
        };
      }>("/admin/v1/oauth/pkce/start", {
        providerType: props.provider.type,
        providerInstanceId: instance.id,
        accountId: accountDraft.id,
        displayName: accountDraft.displayName,
        owner: "team",
        maxConcurrency: Number(accountDraft.maxConcurrency),
        weight: Number(accountDraft.weight),
        allowedModels: [],
        tags: ["oauth"],
        authorizationEndpoint: defaultOAuthEndpoint(props.provider.type),
        redirectUri: defaultOAuthRedirectUri(props.provider.type),
        clientId: defaultOAuthClientId(props.provider.type) || undefined,
        redirectFrom: props.provider.type === "kiro" ? "KiroIDE" : undefined,
        extraParams: oauthExtraParams(props.provider.type, {
          prompt: "login",
          redirectParametersType: "query",
          workflow: "onboarding"
        })
      });

      setOAuthLaunch(response.data);
      setMessage({ type: "success", text: "Authorization link is ready. Open it or copy it to a signed-in browser." });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not create authorization link"
      });
    }
  }

  async function checkAuthCallback() {
    if (!oauthLaunch?.state) {
      setMessage({ type: "error", text: "Create an authorization link first" });
      return;
    }

    try {
      let callback = await props.api.get<{ data: OAuthCallbackRecord }>(
        `/admin/v1/oauth/callbacks/${encodeURIComponent(oauthLaunch.state)}`
      );
      if (
        props.provider.type === "kiro" &&
        callback.data.accountCreated &&
        !callback.data.tokenExchanged
      ) {
        callback = await props.api.post<{ data: OAuthCallbackRecord }>(
          `/admin/v1/oauth/callbacks/${encodeURIComponent(oauthLaunch.state)}/exchange`,
          {}
        );
      }

      if (callback.data.accountCreated) {
        setAccountDraft({
          ...accountDraft,
          id: makeAccountId(props.provider.type)
        });
        setOAuthLaunch(null);
        await props.refresh();
      }

      setMessage({
        type: callback.data.error ? "error" : "success",
        text: callback.data.error
          ? `OAuth returned error: ${callback.data.error}`
          : callback.data.accountCreated
            ? callback.data.tokenExchanged === false && props.provider.type === "kiro"
              ? `Account captured but Kiro token was not exchanged: ${callback.data.accountId ?? oauthLaunch.accountId}`
              : `Account added: ${callback.data.accountId ?? oauthLaunch.accountId}`
            : "Callback captured, but account was not created yet"
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "OAuth callback not found yet"
      });
    }
  }

  async function importLocalSession() {
    try {
      const path =
        props.provider.type === "kiro"
          ? "/admin/v1/oauth/kiro/import-local"
          : props.provider.type === "windsurf"
            ? "/admin/v1/oauth/windsurf/import-local"
            : props.provider.type === "codex"
              ? "/admin/v1/oauth/codex/import-local"
              : "";

      if (!path) {
        setMessage({ type: "error", text: "Provider này chưa hỗ trợ import local." });
        return;
      }

      const response = await props.api.post<{ data: Account }>(path, {
        providerInstanceId: instance.id,
        accountId: accountDraft.id,
        displayName: accountDraft.displayName,
        owner: "team",
        maxConcurrency: Number(accountDraft.maxConcurrency),
        weight: Number(accountDraft.weight),
        allowedModels: [],
        tags: ["local"],
        region: "us-east-1"
      });
      setMessage({ type: "success", text: `Added account ${response.data.id}` });
      setAccountDraft({
        ...accountDraft,
        id: makeAccountId(props.provider.type)
      });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not add account"
      });
    }
  }

  async function setAccountEnabled(account: Account, enabled: boolean) {
    try {
      await props.api.post(`/admin/v1/accounts/${account.id}/${enabled ? "enable" : "disable"}`, {});
      setMessage({ type: "success", text: `${enabled ? "Enabled" : "Disabled"} ${account.displayName}` });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not update account"
      });
    }
  }

  async function resetSuspension(accountId: string) {
    try {
      await props.api.post(`/admin/v1/accounts/${accountId}/reset-suspension`, {});
      setMessage({ type: "success", text: "Suspension cleared, account re-enabled" });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not reset suspension"
      });
    }
  }

  async function moveAccountPriority(accountId: string, direction: "up" | "down") {
    try {
      await props.api.post(`/admin/v1/accounts/${accountId}/priority`, { direction });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not change priority"
      });
    }
  }

  async function updateAccount(accountId: string, patch: { displayName?: string; maxConcurrency?: number; weight?: number }) {
    try {
      await props.api.patch(`/admin/v1/accounts/${accountId}`, patch);
      setEditAccountCandidate(null);
      setMessage({ type: "success", text: "Account updated" });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not update account"
      });
    }
  }

  async function deleteAccount(account: Account) {
    try {
      await props.api.delete(`/admin/v1/accounts/${account.id}`);
      setDeleteCandidate(null);
      setTestResult(null);
      setMessage({ type: "success", text: `Deleted account ${account.displayName}` });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not delete account"
      });
    }
  }

  async function setRoundRobin(enabled: boolean) {
    try {
      await props.api.patch(`/admin/v1/provider-instances/${instance.id}`, {
        accountSelectionStrategy: enabled ? "round_robin" : "least_busy"
      });
      setMessage({
        type: "success",
        text: enabled ? "Round Robin enabled" : "Round Robin disabled. Using least busy account selection."
      });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not update Round Robin"
      });
    }
  }

  async function testAccount(account: Account) {
    try {
      setMessage({ type: "success", text: `Testing ${account.displayName}...` });
      const model = props.models.find((item) => item.enabled);
      const result = await props.api.post<AccountTestResult>(`/admin/v1/accounts/${account.id}/test`, {
        model: model?.publicModel,
        prompt: "Health check. Reply with ok.",
        maxTokens: 64
      });
      setTestResult(result);
      setMessage({
        type: result.ok ? "success" : "error",
        text: result.ok
          ? `Account test passed: ${account.displayName}`
          : `Account test failed: ${result.error?.message ?? account.displayName}`
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not test account"
      });
    }
  }

  async function setModelEnabled(model: ModelMapping, enabled: boolean) {
    try {
      await props.api.patch(`/admin/v1/model-mappings/${model.id}`, { enabled });
      setMessage({ type: "success", text: `${enabled ? "Enabled" : "Disabled"} ${model.publicModel}` });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not update model"
      });
    }
  }

  async function disableAllModels() {
    try {
      await Promise.all(
        props.models
          .filter((model) => model.enabled)
          .map((model) => props.api.patch(`/admin/v1/model-mappings/${model.id}`, { enabled: false }))
      );
      setMessage({ type: "success", text: "Disabled all models for this provider" });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not disable models"
      });
    }
  }

  async function deleteModel(model: ModelMapping) {
    try {
      await props.api.delete(`/admin/v1/model-mappings/${model.id}`);
      setDeleteModelCandidate(null);
      setMessage({ type: "success", text: `Deleted model ${model.publicModel}` });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not delete model"
      });
    }
  }

  async function testCustomModel() {
    const normalized = modelId.trim();

    if (!normalized) {
      return;
    }

    try {
      setMessage({ type: "success", text: `Testing model ${normalized}...` });
      const result = await props.api.post<AccountTestResult>(`/admin/v1/provider-instances/${instance.id}/test-model`, {
        model: normalized,
        prompt: "Health check. Reply with ok.",
        maxTokens: 64
      });
      setTestResult(result);
      setMessage({
        type: result.ok ? "success" : "error",
        text: result.ok
          ? `Model test passed: ${normalized}`
          : `Model test failed: ${result.error?.message ?? normalized}`
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not test model"
      });
    }
  }

  async function testCustomModel2(publicModel: string) {
    try {
      setMessage({ type: "success", text: `Testing ${publicModel}...` });
      const result = await props.api.post<AccountTestResult>(`/admin/v1/provider-instances/${instance.id}/test-model`, {
        model: publicModel,
        prompt: "Health check. Reply with ok.",
        maxTokens: 64
      });
      setTestResult(result);
      setMessage({
        type: result.ok ? "success" : "error",
        text: result.ok ? `✓ ${publicModel} OK` : `✗ ${publicModel}: ${result.error?.message ?? "failed"}`
      });
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "Test failed" });
    }
  }

  async function addModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = modelId.trim();

    if (!normalized) {
      return;
    }

    try {
      await props.api.post("/admin/v1/model-mappings", {
        id: `model_${props.provider.type}_${normalized.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        publicModel: normalized,
        providerInstanceId: instance.id,
        providerType: props.provider.type,
        upstreamModel: normalized,
        enabled: true,
        capabilities: ["chat", "streaming"]
      });
      setMessage({ type: "success", text: `Added model ${normalized}` });
      setModelId("");
      setModelModalOpen(false);
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not add model"
      });
    }
  }

  return (
    <div className="providerDetail">
      <button className="backLink" type="button" onClick={props.onBack}><ChevronLeft size={18} /> {t("prov.backToProviders")}</button>

      <header className="providerDetailHeader">
        <ProviderLogo providerType={props.provider.type} displayName={props.provider.name} />
        <div className="providerDetailHeaderInfo">
          <h2>{props.provider.name}</h2>
          <p>{props.accounts.length} {t("prov.connections")} · {props.models.length} {t("prov.models")}</p>
        </div>
        <div className="providerDetailHeaderActions">
          {props.instances[0] && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => setCopyChannelModalOpen(true)}
              title="Duplicate this channel with a new id"
            >
              <Copy size={16} /> Copy
            </button>
          )}
          <button className="primaryButton" type="button" onClick={() => setAddAccountModalOpen(true)}>
            <Plus size={16} /> {t("prov.addAccountBtn")}
          </button>
        </div>
      </header>

      {/* Provider Info Banner — website link + API key URL */}
      {(() => {
        const meta = PROVIDER_META[props.provider.type];
        if (!meta) return null;
        return (
          <div className="providerInfoBanner">
            {meta.website && (
              <a href={meta.website} target="_blank" rel="noreferrer" className="providerInfoLink">
                <ExternalLink size={13} /> {meta.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {meta.apiKeyUrl && (
              <a href={meta.apiKeyUrl} target="_blank" rel="noreferrer" className="providerInfoLink providerInfoLink--key">
                <KeyRound size={13} /> Get API Key
              </a>
            )}
            {meta.deprecated && (
              <span className="providerInfoDeprecated">
                <AlertCircle size={13} /> Deprecated — may be restricted or banned
              </span>
            )}
          </div>
        );
      })()}

      {message ? <div className={message.type === "success" ? "formNotice success" : "formNotice error"}>{message.text}</div> : null}

      {/* Quick Stats */}
      <div className="providerQuickStats">
        <div className="providerStatCard">
          <span className="providerStatValue">{props.accounts.filter(a => a.status === "active").length}</span>
          <span className="providerStatLabel">{t("prov.activeAccounts")}</span>
        </div>
        <div className="providerStatCard">
          <span className="providerStatValue">{props.models.filter(m => m.enabled).length}</span>
          <span className="providerStatLabel">{t("prov.availableModels")}</span>
        </div>
        <div className="providerStatCard">
          <span className="providerStatValue">{props.accounts.reduce((s, a) => s + a.runtime.totalRequests, 0).toLocaleString()}</span>
          <span className="providerStatLabel">{t("ov.totalRequests")}</span>
        </div>
        <div className="providerStatCard">
          <span className="providerStatValue">{instance.accountSelectionStrategy === "round_robin" ? "Round Robin" : "Least Busy"}</span>
          <span className="providerStatLabel">Strategy</span>
        </div>
      </div>

      {/* Connections */}
      <section className="providerSectionCard">
        <div className="providerSectionHeader">
          <h3>{t("prov.connectionsLabel")}</h3>
          <div className="connectionControls">
            <span>{t("prov.roundRobin")}</span>
            <label className="switchControl" title={instance.accountSelectionStrategy === "round_robin" ? "Round Robin is enabled" : "Round Robin is disabled; using least busy"}>
              <input
                type="checkbox"
                checked={instance.accountSelectionStrategy === "round_robin"}
                onChange={(event) => void setRoundRobin(event.target.checked)}
              />
              <span />
            </label>
          </div>
        </div>

        {props.accounts.length ? (
          <div className="connectionList">
            {props.accounts.map((account, index) => {
              const meta = (account.metadata ?? {}) as Record<string, unknown>;
              const acct = account as unknown as { proxyPoolId?: string };
              const isUnhealthy = meta.healthCheckStatus === "unhealthy" || (account.status === "cooldown" && account.runtime.consecutiveFailures > 0);
              const isExpired = account.runtime.lastError?.toLowerCase().includes("expired") || account.runtime.lastError?.toLowerCase().includes("token");
              const isSuspended = meta.suspended === true || account.runtime.lastError?.toLowerCase().includes("suspended");
              const healthTooltip = (meta.healthCheckMessage as string | undefined) ?? account.runtime.lastError ?? "";
              const machineId = (meta.machineId as string | undefined) ?? "";
              const proxyPoolName = (meta.proxyPoolName as string | undefined) ?? (acct.proxyPoolId ? `Pool: ${acct.proxyPoolId.slice(0, 8)}...` : "");
              const tokenExpiry = account.tokenStatus?.expiresAt ? new Date(account.tokenStatus.expiresAt) : null;
              const tokenTimeLeft = tokenExpiry ? tokenExpiry.getTime() - Date.now() : null;
              const tokenIsExpired = tokenTimeLeft !== null && tokenTimeLeft <= 0;
              const tokenIsExpiringSoon = tokenTimeLeft !== null && tokenTimeLeft > 0 && tokenTimeLeft < 10 * 60 * 1000;
              const lastRefreshed = account.tokenStatus?.lastRefreshedAt ? new Date(account.tokenStatus.lastRefreshedAt) : null;
              return (
              <div className="connectionRow" key={account.id}>
                {/* Priority arrows */}
                <div className="connectionRowPriority">
                  <button
                    className="priorityArrow"
                    type="button"
                    disabled={index === 0}
                    title="Move up (higher priority)"
                    onClick={() => void moveAccountPriority(account.id, "up")}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <span className="connectionRowIndex">#{index + 1}</span>
                  <button
                    className="priorityArrow"
                    type="button"
                    disabled={index === props.accounts.length - 1}
                    title="Move down (lower priority)"
                    onClick={() => void moveAccountPriority(account.id, "down")}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="connectionRowInfo">
                  <strong>{account.displayName}</strong>
                  <span>
                    <StatusBadge status={account.status} label={account.status} />
                    {isUnhealthy && (
                      <span className="healthBadge healthBadge--unhealthy" title={healthTooltip}>
                        <AlertCircle size={12} /> unhealthy
                      </span>
                    )}
                    {isExpired && !isUnhealthy && (
                      <span className="healthBadge healthBadge--expired" title={healthTooltip}>
                        <AlertCircle size={12} /> expired
                      </span>
                    )}
                    {isSuspended && (
                      <span className="healthBadge healthBadge--unhealthy" title="Account suspended by provider">
                        <AlertCircle size={12} /> suspended
                      </span>
                    )}
                    {account.runtime.totalRequests > 0 && <span className="connectionReqCount">{account.runtime.totalRequests.toLocaleString()} reqs</span>}
                    {account.quota && account.quota.dailyRequestLimit > 0 && (
                      <span className="connectionReqCount" title={`${account.quota.requests}/${account.quota.dailyRequestLimit} daily requests`} style={account.quota.exhausted ? { color: "var(--color-danger)" } : undefined}>
                        {account.quota.requests}/{account.quota.dailyRequestLimit}
                      </span>
                    )}
                  </span>
                  {/* MachineId + Proxy info */}
                  {(machineId || proxyPoolName) && (
                    <span className="tokenStatusLine" style={{ fontSize: 11, opacity: 0.7 }}>
                      {machineId && <span title={machineId} style={{ fontFamily: "monospace" }}>ID: {machineId.slice(0, 12)}...</span>}
                      {proxyPoolName && <span style={{ marginLeft: machineId ? 8 : 0 }}>{proxyPoolName}</span>}
                    </span>
                  )}
                  {/* Token status line */}
                  {account.tokenStatus && account.tokenStatus.credentialType !== "api_key" && (
                    <span className="tokenStatusLine">
                      {tokenIsExpired ? (
                        <span className="tokenBadge tokenBadge--expired" title={`Expired ${tokenExpiry?.toLocaleString()}`}>
                          <Timer size={11} /> Token expired
                        </span>
                      ) : tokenIsExpiringSoon ? (
                        <span className="tokenBadge tokenBadge--warning" title={`Expires ${tokenExpiry?.toLocaleString()}`}>
                          <Timer size={11} /> Expires in {Math.ceil((tokenTimeLeft ?? 0) / 60000)}m
                        </span>
                      ) : tokenExpiry ? (
                        <span className="tokenBadge tokenBadge--ok" title={`Expires ${tokenExpiry.toLocaleString()}`}>
                          <Timer size={11} /> {formatTokenTimeLeft(tokenTimeLeft!)}
                        </span>
                      ) : null}
                      {lastRefreshed && (
                        <span className="tokenRefreshTime" title={`Last refreshed: ${lastRefreshed.toLocaleString()}`}>
                          <RefreshCw size={10} /> {formatRelativeTime(lastRefreshed)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="connectionActions">
                  {isSuspended && (
                    <button className="iconTextButton" type="button" title="Reset suspension" onClick={() => void resetSuspension(account.id)}>
                      <RefreshCw size={14} /> Unsuspend
                    </button>
                  )}
                  <button className="iconButton" type="button" title="Edit connection" onClick={() => setEditAccountCandidate(account)}><Pencil size={14} /></button>
                  <button className="iconTextButton" type="button" onClick={() => void testAccount(account)}><FlaskConical size={16} /> {t("common.test")}</button>
                  <label className="switchControl">
                    <input type="checkbox" checked={account.status !== "disabled"} onChange={(event) => void setAccountEnabled(account, event.target.checked)} />
                    <span />
                  </label>
                  <button className="iconButton danger" type="button" onClick={() => setDeleteCandidate(account)}><Trash2 size={16} /></button>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="emptyConnections">
            <div className="emptyConnectionsInner">
              <Lock size={28} />
              <div>
                <strong>{t("prov.noConnectionsYet")}</strong>
                <p>Add an account to start routing requests through this provider.</p>
              </div>
              <button className="primaryButton" type="button" onClick={() => setAddAccountModalOpen(true)}>
                <Plus size={16} /> {t("prov.addAccountBtn")}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Models */}
      <section className="providerSectionCard">
        <div className="providerSectionHeader">
          <h3>{t("prov.availableModels")}</h3>
          <div className="connectionControls">
            <button
              className="secondaryButton"
              type="button"
              onClick={() => setSyncOpen(true)}
              disabled={
                props.instances.length === 0 ||
                props.accounts.filter((a) => a.status === "active").length === 0
              }
              title={t("prov.syncModels")}
            >
              <RefreshCw size={16} /> {t("prov.syncModels")}
            </button>
            <button className="secondaryButton" type="button" onClick={() => setModelModalOpen(true)}><Plus size={16} /> {t("prov.addModel")}</button>
            <button className="secondaryButton" type="button" onClick={() => void disableAllModels()}><XCircle size={16} /> {t("prov.disableAll")}</button>
          </div>
        </div>
        {props.models.length > 0 ? (
          <div className="providerModelGrid">
            {props.models.map((model) => (
              <article className={model.enabled ? "providerModelCard" : "providerModelCard disabled"} key={model.id}>
                <Bot size={18} />
                <div>
                  <code>{model.publicModel}</code>
                  <span>{formatModelLabel(model.upstreamModel)}</span>
                </div>
                <button className="iconButton compact" type="button" title="Copy model id" onClick={() => { void copyText(model.publicModel); setMessage({ type: "success", text: `Copied: ${model.publicModel}` }); }}>
                  <Clipboard size={15} />
                </button>
                <button className="iconButton compact" type="button" title="Test model" onClick={() => void testCustomModel2(model.publicModel)} disabled={props.accounts.filter(a => a.status === "active").length === 0}>
                  <FlaskConical size={15} />
                </button>
                <button className="iconButton compact danger" type="button" title={t("common.delete")} onClick={() => setDeleteModelCandidate(model)}>
                  <X size={15} />
                </button>
                <label className="switchControl">
                  <input type="checkbox" checked={model.enabled} onChange={(event) => void setModelEnabled(model, event.target.checked)} />
                  <span />
                </label>
              </article>
            ))}
          </div>
        ) : (
          <div className="emptyConnections">
            <div className="emptyConnectionsInner">
              <Bot size={28} />
              <div>
                <strong>No models configured</strong>
                <p>Add a model to start routing requests.</p>
              </div>
              <button className="primaryButton" type="button" onClick={() => setModelModalOpen(true)}>
                <Plus size={16} /> {t("prov.addModel")}
              </button>
            </div>
          </div>
        )}

        {/* Known Models Catalog (like 9router) */}
        {(() => {
          const knownModels = getKnownModels(props.provider.type);
          const addedModelIds = new Set(props.models.map(m => m.upstreamModel));
          const notAdded = knownModels.filter(m => !addedModelIds.has(m.id));
          if (notAdded.length === 0) return null;
          return (
            <div className="knownModelsSection">
              <p className="knownModelsLabel">Known models for {props.provider.name}:</p>
              <div className="knownModelsChips">
                {notAdded.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className="knownModelChip"
                    title={`Add ${m.name}`}
                    onClick={async () => {
                      try {
                        await props.api.post("/admin/v1/model-mappings", {
                          id: `model_${props.provider.type}_${m.id.replace(/[^a-zA-Z0-9]+/g, "_")}`,
                          publicModel: m.id,
                          providerInstanceId: instance.id,
                          providerType: props.provider.type,
                          upstreamModel: m.id,
                          enabled: true,
                          capabilities: ["chat", "streaming"]
                        });
                        setMessage({ type: "success", text: `Added ${m.name}` });
                        await props.refresh();
                      } catch {
                        setMessage({ type: "error", text: `Failed to add ${m.name}` });
                      }
                    }}
                  >
                    <Plus size={12} /> {m.id}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

      {props.instances[0] && (
        <ChannelOverridesEditor
          instance={props.instances[0]}
          api={props.api}
          onSaved={() => void props.refresh()}
        />
      )}

      {copyChannelModalOpen && props.instances[0] && (
        <CopyChannelModal
          sourceId={props.instances[0].id}
          sourceName={props.instances[0].name ?? props.instances[0].id}
          api={props.api}
          onClose={() => setCopyChannelModalOpen(false)}
          onSuccess={async (newId) => {
            setCopyChannelModalOpen(false);
            setMessage({ type: "success", text: `Channel copied to "${newId}". The copy starts disabled — enable it after configuring credentials.` });
            await props.refresh();
          }}
        />
      )}

      {testResult ? (
        <div className={testResult.ok ? "resultBox testResult ok" : "resultBox testResult error"}>
          <strong>{testResult.ok ? "Account test passed" : "Account test failed"} - {testResult.accountId}</strong>
          <pre>{JSON.stringify(testResult, null, 2)}</pre>
        </div>
      ) : null}

      {modelModalOpen ? (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setModelModalOpen(false)}>
          <form className="addModelModal" onSubmit={(event) => void addModel(event)} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div className="windowDots"><span /><span /><span /></div>
              <h3>{t("prov.addCustomModel")}</h3>
              <button className="iconButton" type="button" onClick={() => setModelModalOpen(false)}><X size={18} /></button>
            </div>
            <label>
              {t("prov.modelId")}
              <div className="modelModalInputRow">
                <input autoFocus placeholder="e.g. claude-opus-4-5" value={modelId} onChange={(event) => setModelId(event.target.value)} />
                <button className="secondaryButton" type="button" disabled={!modelId.trim() || activeAccounts === 0} onClick={() => void testCustomModel()}><FlaskConical size={16} /> {t("prov.testModel")}</button>
              </div>
              <small>{t("prov.sentToProvider")} <code>{modelId.trim() || "model-id"}</code></small>
            </label>
            <div className="modalFooter">
              <button className="textButton" type="button" onClick={() => setModelModalOpen(false)}>{t("common.cancel")}</button>
              <button className="primaryButton" type="submit" disabled={!modelId.trim()}>{t("prov.addModel")}</button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteModelCandidate ? (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setDeleteModelCandidate(null)}>
          <div className="confirmModal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div className="windowDots"><span /><span /><span /></div>
              <h3>{t("prov.deleteModel")}</h3>
              <button className="iconButton" type="button" onClick={() => setDeleteModelCandidate(null)}><X size={18} /></button>
            </div>
            <div className="confirmBody">
              <p>Delete model <strong>{deleteModelCandidate.publicModel}</strong> from this provider?</p>
            </div>
            <div className="modalFooter">
              <button className="textButton" type="button" onClick={() => setDeleteModelCandidate(null)}>{t("common.cancel")}</button>
              <button className="dangerButton" type="button" onClick={() => void deleteModel(deleteModelCandidate)}>
                <Trash2 size={16} /> {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setDeleteCandidate(null)}>
          <div className="confirmModal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div className="windowDots"><span /><span /><span /></div>
              <h3>{t("prov.deleteAccount")}</h3>
              <button className="iconButton" type="button" onClick={() => setDeleteCandidate(null)}><X size={18} /></button>
            </div>
            <div className="confirmBody">
              <p>Delete <strong>{deleteCandidate.displayName}</strong> and remove its stored credential from the gateway?</p>
            </div>
            <div className="modalFooter">
              <button className="textButton" type="button" onClick={() => setDeleteCandidate(null)}>{t("common.cancel")}</button>
              <button className="dangerButton" type="button" onClick={() => void deleteAccount(deleteCandidate)}>
                <Trash2 size={16} /> {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Account Modal */}
      {editAccountCandidate ? (
        <EditAccountModal
          account={editAccountCandidate}
          onClose={() => setEditAccountCandidate(null)}
          onSave={(patch) => void updateAccount(editAccountCandidate.id, patch)}
        />
      ) : null}

      {addAccountModalOpen ? (
        <AddAccountModal
          providerType={props.provider.type}
          providerTypeInfo={props.providerType}
          supportedModes={getSupportedCredentialModes(props.providerType)}
          api={props.api}
          onClose={() => setAddAccountModalOpen(false)}
          onSuccess={() => {
            setAddAccountModalOpen(false);
            setMessage({ type: "success", text: "Đã thêm account thành công" });
            void props.refresh();
          }}
        />
      ) : null}

      {syncOpen && props.instances[0] && (
        <SyncModelsModal
          api={props.api}
          providerInstanceId={props.instances[0].id}
          providerInstanceName={props.instances[0].name ?? props.instances[0].id}
          onClose={() => setSyncOpen(false)}
          onApplied={async (n) => {
            setSyncOpen(false);
            setSyncToast(t("prov.syncDone").replace("{n}", String(n)));
            window.setTimeout(() => setSyncToast(null), 4000);
            await props.refresh();
          }}
        />
      )}
      {syncToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 16px",
            background: "#10b981",
            color: "white",
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {syncToast}
        </div>
      )}
    </div>
  );
}

function ProviderCatalog({ providers }: { providers: ProviderType[] }) {
  return (
    <div className="providerGrid">
      {providers.map((provider) => (
        <article className="providerCard" key={provider.type}>
          <div className="providerCardTop">
            <div className="providerIdentity">
              <ProviderLogo providerType={provider.type} displayName={provider.displayName} />
              <div>
                <h3>{provider.displayName}</h3>
                <span>{provider.adapterName}</span>
              </div>
            </div>
            <StatusBadge status="active" label="ready" />
          </div>
          <div className="providerStats">
            <span><strong>{provider.supportedProtocols.length}</strong> protocols</span>
            <span><strong>{provider.capabilities.maxInputTokens?.toLocaleString() ?? "n/a"}</strong> input</span>
          </div>
          <div className="tagRow compact">
            {provider.authMethods.slice(0, 3).map((method) => (
              <span className="tag" key={method}>{method}</span>
            ))}
          </div>
          <div className="providerMeta">
            <span>{provider.capabilities.flags.join(" / ") || "no flags"}</span>
            <span>No connections</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProviderInstances(props: {
  providerTypes: ProviderType[];
  instances: ProviderInstance[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    id: "provider_kiro_extra",
    type: "kiro",
    name: "Kiro Extra"
  });

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.api.post("/admin/v1/provider-instances", draft);
    await props.refresh();
  }

  async function toggle(instance: ProviderInstance) {
    await props.api.patch(`/admin/v1/provider-instances/${instance.id}`, {
      enabled: !instance.enabled
    });
    await props.refresh();
  }

  async function resetCircuitBreaker(instance: ProviderInstance) {
    await props.api.post(`/admin/v1/provider-instances/${instance.id}/circuit-breaker/reset`, {});
    await props.refresh();
  }

  return (
    <div className="stack">
      <form className="formPanel" onSubmit={(event) => void create(event)}>
        <label>
          ID
          <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
        </label>
        <label>
          Type
          <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>
            {(props.providerTypes.length ? props.providerTypes : [{ type: "kiro" }, { type: "windsurf" }]).map((provider) => (
              <option key={provider.type} value={provider.type}>{provider.type}</option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <button className="primaryButton" type="submit"><Plus size={16} />Create Provider</button>
      </form>
      <DataTable
        columns={["Name", "Type", "Status", "Retries", "Concurrency", "Circuit", ""]}
        rows={props.instances.map((instance) => [
          instance.name,
          instance.type,
          <StatusBadge key="status" status={instance.enabled ? "active" : "disabled"} label={instance.enabled ? "enabled" : "disabled"} />,
          instance.maxRetries,
          instance.maxConcurrentRequests,
          instance.circuitBreaker.enabled ? `on / ${instance.circuitBreaker.failureThreshold}` : "off",
          <span key="actions" style={{display:"inline-flex",gap:"4px"}}>
            <button className="actionButton" onClick={() => void toggle(instance)}>
              {instance.enabled ? "Disable" : "Enable"}
            </button>
            {instance.circuitBreaker.enabled && (
              <button className="actionButton" onClick={() => void resetCircuitBreaker(instance)} title="Reset circuit breaker">
                Reset CB
              </button>
            )}
          </span>
        ])}
      />
    </div>
  );
}

function Accounts(props: {
  accounts: Account[];
  instances: ProviderInstance[];
  providerTypes: ProviderType[];
  models: ModelMapping[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const providerInstances = props.instances.length
    ? props.instances
    : [
        { id: "provider_kiro_main", type: "kiro", name: "Kiro Main" },
        { id: "provider_windsurf_main", type: "windsurf", name: "Windsurf Main" }
      ];
  const firstInstance = providerInstances[0];
  const firstPreset = getAuthPresets(firstInstance?.type ?? "kiro")[0];
  const [draft, setDraft] = useState({
    id: makeAccountId(firstInstance?.type ?? "kiro"),
    providerInstanceId: firstInstance?.id ?? "provider_kiro_main",
    displayName: `${firstInstance?.name ?? "Kiro"} Account`,
    owner: "team",
    authPreset: firstPreset.id,
    credentialValues: getDefaultCredentialValues(firstPreset),
    maxConcurrency: "3",
    weight: "1",
    tags: "",
    allowedModels: ""
  });
  const [credentialDraft, setCredentialDraft] = useState({
    accountId: "",
    credentialType: "api_key",
    credentialPayload: "{\n  \"apiKey\": \"replace-me\"\n}"
  });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<AccountTestResult | null>(null);
  const [oauthLaunch, setOAuthLaunch] = useState<{
    state: string;
    authorizationUrl: string;
    accountId: string;
    redirectUri: string;
  } | null>(null);

  const selectedInstance =
    providerInstances.find((instance) => instance.id === draft.providerInstanceId) ?? firstInstance;
  const selectedProvider = props.providerTypes.find((provider) => provider.type === selectedInstance?.type);
  const authPresets = getAuthPresets(selectedInstance?.type ?? "kiro", selectedProvider?.authMethods);
  const selectedPreset =
    authPresets.find((preset) => preset.id === draft.authPreset) ?? authPresets[0];

  function updateProvider(providerInstanceId: string) {
    const instance = providerInstances.find((item) => item.id === providerInstanceId) ?? firstInstance;
    const preset = getAuthPresets(instance?.type ?? "kiro")[0];
    setDraft({
      ...draft,
      id: makeAccountId(instance?.type ?? "provider"),
      providerInstanceId,
      displayName: `${instance?.name ?? "Provider"} Account`,
      authPreset: preset.id,
      credentialValues: getDefaultCredentialValues(preset)
    });
    setMessage(null);
    setOAuthLaunch(null);
  }

  function updateAuthPreset(authPreset: string) {
    const preset = authPresets.find((item) => item.id === authPreset) ?? authPresets[0];
    setDraft({
      ...draft,
      authPreset,
      credentialValues: getDefaultCredentialValues(preset)
    });
    setMessage(null);
    setOAuthLaunch(null);
  }

  function updateCredentialValue(key: string, value: string) {
    setDraft({
      ...draft,
      credentialValues: {
        ...draft.credentialValues,
        [key]: value
      }
    });
    setMessage(null);
    setOAuthLaunch(null);
  }

  const authorizationUrl =
    selectedPreset.credentialType === "oauth"
      ? oauthLaunch?.authorizationUrl ?? buildAuthorizationUrl(draft.credentialValues)
      : "";

  async function createOAuthLink() {
    try {
      const response = await props.api.post<{
        data: {
          state: string;
          authorizationUrl: string;
          accountId: string;
          redirectUri: string;
        };
      }>("/admin/v1/oauth/pkce/start", {
        providerType: selectedInstance?.type ?? "kiro",
        providerInstanceId: draft.providerInstanceId,
        accountId: draft.id,
        displayName: draft.displayName,
        owner: draft.owner || undefined,
        maxConcurrency: Number(draft.maxConcurrency),
        weight: Number(draft.weight),
        allowedModels: parseCsv(draft.allowedModels),
        tags: parseCsv(draft.tags),
        authorizationEndpoint:
          draft.credentialValues.authorizationEndpoint || defaultOAuthEndpoint(selectedInstance?.type ?? "kiro"),
        redirectUri:
          draft.credentialValues.redirectUri || defaultOAuthRedirectUri(selectedInstance?.type ?? "kiro"),
        scope: draft.credentialValues.scope || undefined,
        clientId: draft.credentialValues.clientId || undefined,
        redirectFrom:
          selectedInstance?.type === "kiro"
            ? draft.credentialValues.redirectFrom || "KiroIDE"
            : draft.credentialValues.redirectFrom || undefined,
        extraParams: oauthExtraParams(selectedInstance?.type ?? "kiro", draft.credentialValues)
      });

      setOAuthLaunch(response.data);
      setDraft({
        ...draft,
        credentialValues: {
          ...draft.credentialValues,
          state: response.data.state,
          redirectUri: response.data.redirectUri
        }
      });
      setMessage({ type: "success", text: "Authorization link is ready" });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not create auth link"
      });
    }
  }

  async function checkOAuthCallback() {
    const state = draft.credentialValues.state?.trim();

    if (!state) {
      setMessage({ type: "error", text: "OAuth state is required" });
      return;
    }

    try {
      const manualCallbackUrl = draft.credentialValues.callbackQuery?.trim();
      let callback =
        manualCallbackUrl && isLikelyCallbackUrl(manualCallbackUrl)
          ? await props.api.post<{ data: OAuthCallbackRecord }>("/admin/v1/oauth/callbacks/manual", {
              state,
              callbackUrl: manualCallbackUrl
            })
          : await props.api.get<{ data: OAuthCallbackRecord }>(
              `/admin/v1/oauth/callbacks/${encodeURIComponent(state)}`
            );
      if (
        selectedInstance?.type === "kiro" &&
        callback.data.accountCreated &&
        !callback.data.tokenExchanged
      ) {
        callback = await props.api.post<{ data: OAuthCallbackRecord }>(
          `/admin/v1/oauth/callbacks/${encodeURIComponent(state)}/exchange`,
          {}
        );
      }
      const nextValues = {
        ...draft.credentialValues,
        code: callback.data.token ?? callback.data.code ?? "",
        callbackQuery: JSON.stringify(callback.data.query, null, 2)
      };
      setDraft({ ...draft, credentialValues: nextValues });
      if (callback.data.accountCreated) {
        await props.refresh();
      }
      setMessage({
        type: callback.data.error ? "error" : "success",
        text: callback.data.error
          ? `OAuth returned error: ${callback.data.error}`
          : callback.data.accountCreated
            ? callback.data.tokenExchanged
              ? `Account added and token exchanged: ${callback.data.accountId ?? "created"}`
              : `Account added: ${callback.data.accountId ?? "created"}`
            : "OAuth callback captured"
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "OAuth callback not found"
      });
    }
  }

  async function importKiroLocalToken() {
    try {
      const response = await props.api.post<{ data: Account }>(
        "/admin/v1/oauth/kiro/import-local",
        {
          providerInstanceId: draft.providerInstanceId,
          accountId: draft.id,
          displayName: draft.displayName,
          owner: draft.owner || undefined,
          maxConcurrency: Number(draft.maxConcurrency),
          weight: Number(draft.weight),
          allowedModels: parseCsv(draft.allowedModels),
          tags: parseCsv(draft.tags),
          region: draft.credentialValues.region || "us-east-1"
        }
      );
      await props.refresh();
      setMessage({
        type: "success",
        text: `Imported Kiro local token: ${response.data.id}`
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Kiro local token import failed"
      });
    }
  }

  async function importWindsurfLocalToken() {
    try {
      const response = await props.api.post<{ data: Account }>(
        "/admin/v1/oauth/windsurf/import-local",
        {
          providerInstanceId: draft.providerInstanceId,
          accountId: draft.id,
          displayName: draft.displayName,
          owner: draft.owner || undefined,
          maxConcurrency: Number(draft.maxConcurrency),
          weight: Number(draft.weight),
          allowedModels: parseCsv(draft.allowedModels),
          tags: parseCsv(draft.tags)
        }
      );
      await props.refresh();
      setMessage({
        type: "success",
        text: `Imported Windsurf local token: ${response.data.id}`
      });
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Windsurf local token import failed"
      });
    }
  }

  async function importCodexLocalToken() {
    try {
      const response = await props.api.post<{ data: Account }>(
        "/admin/v1/oauth/codex/import-local",
        {
          providerInstanceId: draft.providerInstanceId,
          accountId: draft.id,
          displayName: draft.displayName,
          owner: draft.owner || undefined,
          maxConcurrency: Number(draft.maxConcurrency),
          weight: Number(draft.weight),
          allowedModels: parseCsv(draft.allowedModels),
          tags: parseCsv(draft.tags)
        }
      );
      await props.refresh();
      setMessage({ type: "success", text: `Imported Codex local token: ${response.data.id}` });
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "Codex local token import failed. Run `codex login` first." });
    }
  }

  async function startGitHubDeviceCode() {
    try {
      const response = await props.api.post<{ data: { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number } }>(
        "/admin/v1/oauth/github-copilot/device-code/start",
        {
          providerInstanceId: draft.providerInstanceId,
          accountId: draft.id,
          displayName: draft.displayName,
          owner: draft.owner || undefined,
          maxConcurrency: Number(draft.maxConcurrency),
          weight: Number(draft.weight),
          allowedModels: parseCsv(draft.allowedModels),
          tags: parseCsv(draft.tags)
        }
      );
      const { userCode, verificationUri, deviceCode, interval } = response.data;
      setMessage({ type: "success", text: `Enter code ${userCode} at ${verificationUri}` });
      window.open(verificationUri, "_blank");

      const pollInterval = setInterval(async () => {
        try {
          const pollResult = await props.api.post<{ data: { status?: string; id?: string } }>(
            "/admin/v1/oauth/github-copilot/device-code/poll",
            {
              deviceCode,
              providerInstanceId: draft.providerInstanceId,
              accountId: draft.id,
              displayName: draft.displayName,
              owner: draft.owner || undefined,
              maxConcurrency: Number(draft.maxConcurrency),
              weight: Number(draft.weight),
              allowedModels: parseCsv(draft.allowedModels),
              tags: parseCsv(draft.tags)
            }
          );
          if (pollResult.data.status !== "pending") {
            clearInterval(pollInterval);
            setMessage({ type: "success", text: `GitHub Copilot account added: ${pollResult.data.id ?? draft.id}` });
            await props.refresh();
          }
        } catch {
          // 202 = still pending, keep polling
        }
      }, (interval || 5) * 1000);

      setTimeout(() => clearInterval(pollInterval), 600_000);
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "GitHub device code flow failed" });
    }
  }

  async function importKiroIdc() {
    const { refreshToken, clientId, clientSecret, region } = draft.credentialValues;
    if (!refreshToken || !clientId || !clientSecret) {
      setMessage({ type: "error", text: "refreshToken, clientId, and clientSecret are required for IDC import" });
      return;
    }
    try {
      const response = await props.api.post<{ data: Account }>(
        "/admin/v1/oauth/kiro/import-idc",
        {
          providerInstanceId: draft.providerInstanceId,
          accountId: draft.id,
          displayName: draft.displayName,
          refreshToken,
          clientId,
          clientSecret,
          region: region || "us-east-1",
          owner: draft.owner || undefined,
          maxConcurrency: Number(draft.maxConcurrency),
          weight: Number(draft.weight),
          allowedModels: parseCsv(draft.allowedModels),
          tags: parseCsv(draft.tags)
        }
      );
      await props.refresh();
      setMessage({ type: "success", text: `Imported Kiro IDC account: ${response.data.id}` });
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "Kiro IDC import failed" });
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const credentialPayload = buildCredentialPayload(selectedPreset, draft.credentialValues);

      await props.api.post("/admin/v1/accounts", {
        id: draft.id,
        providerInstanceId: draft.providerInstanceId,
        displayName: draft.displayName,
        owner: draft.owner || undefined,
        credentialType: selectedPreset.credentialType,
        credentialPayload,
        maxConcurrency: Number(draft.maxConcurrency),
        weight: Number(draft.weight),
        allowedModels: parseCsv(draft.allowedModels),
        tags: parseCsv(draft.tags)
      });
      setMessage({ type: "success", text: `Created ${draft.displayName}` });
      await props.refresh();
    } catch (caught) {
      setMessage({
        type: "error",
        text: caught instanceof Error ? caught.message : "Could not create account"
      });
    }
  }

  async function setEnabled(account: Account, enabled: boolean) {
    await props.api.post(`/admin/v1/accounts/${account.id}/${enabled ? "enable" : "disable"}`, {});
    await props.refresh();
  }

  async function refreshSession(account: Account) {
    try {
      const result = await props.api.post<{ refreshed: boolean; message?: string }>(
        `/admin/v1/accounts/${account.id}/refresh-session`, {}
      );
      setTestResult({
        ok: result.refreshed,
        accountId: account.id,
        providerType: account.providerType,
        providerInstanceId: account.providerInstanceId,
        upstreamModel: "session-refresh",
        durationMs: 0,
        message: result.message ?? (result.refreshed ? "Session refreshed" : "Refresh failed")
      } as unknown as typeof testResult);
      await props.refresh();
    } catch (err) {
      setTestResult({
        ok: false,
        accountId: account.id,
        providerType: account.providerType,
        providerInstanceId: account.providerInstanceId,
        upstreamModel: "session-refresh",
        durationMs: 0,
        message: err instanceof Error ? err.message : "Refresh failed"
      } as unknown as typeof testResult);
    }
  }

  async function testAccount(account: Account) {
    const model = props.models.find(
      (item) => item.enabled && item.providerInstanceId === account.providerInstanceId
    );
    const result = await props.api.post<AccountTestResult>(`/admin/v1/accounts/${account.id}/test`, {
      model: model?.publicModel,
      prompt: "Health check. Reply with ok.",
      maxTokens: 64
    });
    setTestResult(result);
  }

  async function rotateCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.api.post(`/admin/v1/accounts/${credentialDraft.accountId}/credential`, {
      credentialType: credentialDraft.credentialType,
      credentialPayload: JSON.parse(credentialDraft.credentialPayload)
    });
    await props.refresh();
  }

  return (
    <div className="stack">
      <section className="accountBuilder">
        <div className="builderHeader">
          <div className="providerIdentity">
            <ProviderLogo providerType={selectedInstance?.type ?? "kiro"} displayName={selectedInstance?.name ?? "Provider"} />
            <div>
              <h3>Add Provider Account</h3>
              <span>{selectedInstance?.name ?? "Select provider"} · {selectedProvider?.displayName ?? selectedInstance?.type}</span>
            </div>
          </div>
          {message ? (
            <span className={message.type === "success" ? "formNotice success" : "formNotice error"}>
              {message.text}
            </span>
          ) : null}
        </div>
        <form className="accountForm" onSubmit={(event) => void create(event)}>
          {selectedInstance?.type === "kiro" ? (
            <div className="quickConnectPanel">
              <div>
                <strong>Use Kiro App Session</strong>
                <span>Đăng nhập trong Kiro app trước, sau đó bấm nút này để tự lấy session local.</span>
              </div>
              <button className="primaryButton" type="button" onClick={() => void importKiroLocalToken()}>
                <KeyRound size={16} />Use Kiro App Session
              </button>
              <button className="textButton" type="button" onClick={() => void importKiroIdc()} style={{ marginTop: 8 }}>
                <KeyRound size={16} />Import IDC (clientId + clientSecret)
              </button>
            </div>
          ) : null}
          {selectedInstance?.type === "windsurf" ? (
            <div className="quickConnectPanel">
              <div>
                <strong>Use Windsurf App Session</strong>
                <span>Dang nhap Windsurf hoac Cockpit truoc, sau do bam nut nay de import session local.</span>
              </div>
              <button className="primaryButton" type="button" onClick={() => void importWindsurfLocalToken()}>
                <KeyRound size={16} />Use Windsurf App Session
              </button>
            </div>
          ) : null}
          {selectedInstance?.type === "codex" ? (
            <div className="quickConnectPanel">
              <div>
                <strong>Use Codex Local Session</strong>
                <span>Run `codex login` first, then click to import the local token.</span>
              </div>
              <button className="primaryButton" type="button" onClick={() => void importCodexLocalToken()}>
                <KeyRound size={16} />Import Codex Token
              </button>
            </div>
          ) : null}
          {(selectedInstance?.type === "github_copilot" || selectedInstance?.type === "github-copilot") ? (
            <div className="quickConnectPanel">
              <div>
                <strong>GitHub Copilot Device Code</strong>
                <span>Click to start device code flow. You'll get a code to enter on GitHub.</span>
              </div>
              <button className="primaryButton" type="button" onClick={() => void startGitHubDeviceCode()}>
                <KeyRound size={16} />Start Device Code Login
              </button>
            </div>
          ) : null}
          <div className="providerSelector">
            {providerInstances.map((instance) => (
              <button
                className={instance.id === draft.providerInstanceId ? "providerOption active" : "providerOption"}
                key={instance.id}
                type="button"
                onClick={() => updateProvider(instance.id)}
              >
                <ProviderLogo providerType={instance.type} displayName={instance.name} />
                <span>{instance.name}</span>
                <small>{instance.type}</small>
              </button>
            ))}
          </div>

          <div className="authPresetGrid">
            {authPresets.map((preset) => (
              <button
                className={preset.id === selectedPreset.id ? "authPreset active" : "authPreset"}
                key={preset.id}
                type="button"
                onClick={() => updateAuthPreset(preset.id)}
              >
                <KeyRound size={16} />
                <span>{preset.label}</span>
                <small>{preset.description}</small>
              </button>
            ))}
          </div>

          <div className="formPanel accountDetails">
            <label>
              Account ID
              <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
            </label>
            <label>
              Display Name
              <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
            </label>
            <label>
              Owner
              <input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} />
            </label>
            <label>
              Max Concurrency
              <input type="number" min="1" value={draft.maxConcurrency} onChange={(event) => setDraft({ ...draft, maxConcurrency: event.target.value })} />
            </label>
            <label>
              Weight
              <input type="number" min="1" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} />
            </label>
            <label>
              Allowed Models
              <input placeholder="kiro-sonnet, windsurf-sonnet" value={draft.allowedModels} onChange={(event) => setDraft({ ...draft, allowedModels: event.target.value })} />
            </label>
            <label>
              Tags
              <input placeholder="prod, us-east" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
            </label>
          </div>

          <div className="credentialPanel">
            <div className="sectionHeader">
              <div>
                <h3>{selectedPreset.label}</h3>
                <p>{selectedPreset.description}</p>
              </div>
              <span className="tag">{selectedPreset.credentialType}</span>
            </div>
            {selectedPreset.credentialType === "oauth" ? (
              <div className="oauthTools">
                <label>
                  Authorization URL
                  <textarea readOnly value={authorizationUrl} />
                </label>
                <div className="oauthActions">
                  <button className="primaryButton" type="button" onClick={() => void createOAuthLink()}>
                    <KeyRound size={16} />Create Auth Link
                  </button>
                  <button
                    className="textButton"
                    type="button"
                    disabled={!authorizationUrl}
                    onClick={() => void copyText(authorizationUrl)}
                  >
                    <Clipboard size={16} />Copy Link
                  </button>
                  <button
                    className="textButton"
                    type="button"
                    disabled={!authorizationUrl || selectedInstance?.type === "kiro"}
                    onClick={() => window.open(authorizationUrl, "_blank", "noopener,noreferrer")}
                    title={selectedInstance?.type === "kiro" ? "Kiro uses Import Local or API Key instead of browser OAuth" : undefined}
                  >
                    <ExternalLink size={16} />Open Browser
                  </button>
                  {selectedInstance?.type === "kiro" ? (
                    <button className="textButton" type="button" onClick={() => void importKiroLocalToken()}>
                      <KeyRound size={16} />Import Local Token
                    </button>
                  ) : null}
                  {selectedInstance?.type === "kiro" ? (
                    <button className="textButton" type="button" onClick={() => void importKiroIdc()}>
                      <KeyRound size={16} />Import IDC
                    </button>
                  ) : null}
                  {selectedInstance?.type === "windsurf" ? (
                    <button className="textButton" type="button" onClick={() => void importWindsurfLocalToken()}>
                      <KeyRound size={16} />Import Local Token
                    </button>
                  ) : null}
                  {selectedInstance?.type === "codex" ? (
                    <button className="textButton" type="button" onClick={() => void importCodexLocalToken()}>
                      <KeyRound size={16} />Import Local Token
                    </button>
                  ) : null}
                  {selectedInstance?.type === "github_copilot" || selectedInstance?.type === "github-copilot" ? (
                    <button className="textButton" type="button" onClick={() => void startGitHubDeviceCode()}>
                      <KeyRound size={16} />Device Code Login
                    </button>
                  ) : null}
                  <button className="textButton" type="button" onClick={() => void checkOAuthCallback()}>
                    <RefreshCw size={16} />Check Callback
                  </button>
                </div>
              </div>
            ) : null}
            <div className="credentialGrid">
              {selectedPreset.fields.filter((f) => f.type !== "hidden").map((field) => (
                <label className={field.type === "textarea" ? "spanTwo" : undefined} key={field.key}>
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea
                      required={field.required}
                      placeholder={field.placeholder}
                      value={draft.credentialValues[field.key] ?? ""}
                      onChange={(event) => updateCredentialValue(field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      required={field.required}
                      type={field.type ?? "text"}
                      placeholder={field.placeholder}
                      value={draft.credentialValues[field.key] ?? ""}
                      onChange={(event) => updateCredentialValue(field.key, event.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="builderFooter">
            <span>Secrets are encrypted by the gateway and only redacted references are returned.</span>
            <button className="primaryButton" type="submit"><Plus size={16} />Add Account</button>
          </div>
        </form>
      </section>
      <form className="formPanel wide" onSubmit={(event) => void rotateCredential(event)}>
        <label>
          Account
          <select value={credentialDraft.accountId} onChange={(event) => setCredentialDraft({ ...credentialDraft, accountId: event.target.value })}>
            <option value="">Select account</option>
            {props.accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Credential Type
          <select value={credentialDraft.credentialType} onChange={(event) => setCredentialDraft({ ...credentialDraft, credentialType: event.target.value })}>
            {["api_key", "bearer_token", "oauth", "refresh_token", "session_cookie", "custom_json"].map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="spanTwo">
          New Credential JSON
          <textarea value={credentialDraft.credentialPayload} onChange={(event) => setCredentialDraft({ ...credentialDraft, credentialPayload: event.target.value })} />
        </label>
        <button className="textButton" type="submit" disabled={!credentialDraft.accountId}>Rotate Credential</button>
      </form>
      <DataTable
        columns={["Account", "Provider", "Status", "Active", "Total", "Failed", "Credential", "Test", ""]}
        rows={props.accounts.map((account) => [
          account.displayName,
          account.providerType,
          <StatusBadge key="status" status={account.status} label={account.status} />,
          account.runtime.activeRequests,
          account.runtime.totalRequests,
          account.runtime.failedRequests,
          account.credentialRef ?? "[REDACTED]",
          <button className="actionButton" key="test" onClick={() => void testAccount(account)}>
            Test
          </button>,
          <button className="actionButton" key="refresh" onClick={() => void refreshSession(account)}>
            Refresh
          </button>,
          <button
            className="actionButton"
            key="toggle"
            onClick={() => void setEnabled(account, account.status === "disabled")}
          >
            {account.status === "disabled" ? "Enable" : "Disable"}
          </button>
        ])}
      />
      {testResult ? (
        <div className={testResult.ok ? "resultBox testResult ok" : "resultBox testResult error"}>
          <strong>
            {testResult.ok ? "Account test passed" : "Account test failed"} - {testResult.accountId}
          </strong>
          <pre>
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

type AccountTestResult = {
  ok: boolean;
  accountId: string;
  providerType: string;
  providerInstanceId: string;
  publicModel?: string;
  upstreamModel: string;
  durationMs: number;
  preview?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

function ModelRegistry(props: {
  models: ModelMapping[];
  instances: ProviderInstance[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [providerFilter, setProviderFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ publicModel: string; upstreamModel: string; capabilities: string }>({ publicModel: "", upstreamModel: "", capabilities: "" });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; ms?: number; preview?: string; error?: string }>>({});
  const [draft, setDraft] = useState({
    id: "model_kiro_custom",
    publicModel: "kiro-custom",
    providerInstanceId: "provider_kiro_main",
    providerType: "kiro",
    upstreamModel: "claude-sonnet-4.5",
    capabilities: "chat,streaming"
  });
  const activeInstance = props.instances.find((item) => item.id === draft.providerInstanceId);
  const activeProviderType = activeInstance?.type ?? draft.providerType;
  const presets = getModelPresets(activeProviderType);
  const upstreamWarning = getUpstreamWarning(activeProviderType, draft.upstreamModel);
  const providerFilters = Array.from(new Set(props.models.map((model) => model.providerType)));
  const visibleModels =
    providerFilter === "all"
      ? props.models
      : props.models.filter((model) => model.providerType === providerFilter);
  const enabledCount = props.models.filter((model) => model.enabled).length;

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instance = props.instances.find((item) => item.id === draft.providerInstanceId);
    await props.api.post("/admin/v1/model-mappings", {
      ...draft,
      providerType: instance?.type ?? draft.providerType,
      capabilities: parseCsv(draft.capabilities)
    });
    setShowCreate(false);
    await props.refresh();
  }

  async function setModelEnabled(model: ModelMapping, enabled: boolean) {
    await props.api.patch(`/admin/v1/model-mappings/${model.id}`, { enabled });
    await props.refresh();
  }

  async function setAllModelsEnabled(enabled: boolean) {
    await Promise.all(
      props.models
        .filter((model) => model.enabled !== enabled)
        .map((model) => props.api.patch(`/admin/v1/model-mappings/${model.id}`, { enabled }))
    );
    await props.refresh();
  }

  function startEdit(model: ModelMapping) {
    setEditingId(model.id);
    setEditDraft({
      publicModel: model.publicModel,
      upstreamModel: model.upstreamModel,
      capabilities: model.capabilities.join(",")
    });
  }

  async function saveEdit(model: ModelMapping) {
    await props.api.patch(`/admin/v1/model-mappings/${model.id}`, {
      publicModel: editDraft.publicModel.trim(),
      upstreamModel: editDraft.upstreamModel.trim(),
      capabilities: parseCsv(editDraft.capabilities)
    });
    setEditingId(null);
    await props.refresh();
  }

  async function deleteModel(model: ModelMapping) {
    if (!window.confirm(`Delete model mapping "${model.publicModel}" on ${model.providerInstanceId}?\n\nClients calling this model name will get 404 unless another channel still serves it.`)) return;
    await props.api.delete(`/admin/v1/model-mappings/${model.id}`);
    await props.refresh();
  }

  async function testModel(model: ModelMapping) {
    setTestingId(model.id);
    setTestResult((prev) => ({ ...prev, [model.id]: { ok: false } }));
    const start = performance.now();
    try {
      const result = await props.api.post(
        `/admin/v1/provider-instances/${model.providerInstanceId}/test-model`,
        { model: model.publicModel, prompt: "Say hi in 3 words.", maxTokens: 32 }
      ) as { choices?: Array<{ message?: { content?: string } }> };
      const ms = Math.round(performance.now() - start);
      const preview = result?.choices?.[0]?.message?.content?.slice(0, 80) ?? "(empty)";
      setTestResult((prev) => ({ ...prev, [model.id]: { ok: true, ms, preview } }));
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      setTestResult((prev) => ({ ...prev, [model.id]: { ok: false, ms, error: err instanceof Error ? err.message : "Test failed" } }));
    } finally {
      setTestingId(null);
    }
  }

  function applyPreset(preset: ModelPreset) {
    const instance =
      props.instances.find((item) => item.type === preset.providerType) ??
      props.instances.find((item) => item.id === draft.providerInstanceId);

    setDraft({
      id: preset.id,
      publicModel: preset.publicModel,
      providerInstanceId: instance?.id ?? draft.providerInstanceId,
      providerType: instance?.type ?? preset.providerType,
      upstreamModel: preset.upstreamModel,
      capabilities: preset.capabilities.join(",")
    });
  }

  function changeProvider(providerInstanceId: string) {
    const instance = props.instances.find((item) => item.id === providerInstanceId);
    const firstPreset = getModelPresets(instance?.type ?? draft.providerType)[0];

    setDraft({
      ...draft,
      providerInstanceId,
      providerType: instance?.type ?? draft.providerType,
      upstreamModel: firstPreset?.upstreamModel ?? draft.upstreamModel,
      capabilities: firstPreset?.capabilities.join(",") ?? draft.capabilities
    });
  }

  return (
    <div className="modelRegistryShell">
      <section className="modelBoard">
        <div className="modelBoardHeader">
          <div>
            <h3>Models</h3>
            <p>{enabledCount}/{props.models.length} enabled. Each tile is one (channel × public-model) mapping. The same public name can be served by multiple channels for failover.</p>
          </div>
          <div className="modelActions">
            <div className="modelFilters" aria-label="Provider filters">
              <button className={providerFilter === "all" ? "active" : ""} type="button" onClick={() => setProviderFilter("all")}>All</button>
              {providerFilters.map((provider) => (
                <button className={providerFilter === provider ? "active" : ""} type="button" key={provider} onClick={() => setProviderFilter(provider)}>
                  {provider}
                </button>
              ))}
            </div>
            <button className="secondaryButton" type="button" onClick={() => void setAllModelsEnabled(false)}>
              <XCircle size={16} /> Disable All
            </button>
          </div>
        </div>

        <div className="modelTileGrid">
          {visibleModels.map((model) => {
            const provider = props.instances.find((instance) => instance.id === model.providerInstanceId);
            // Phase 31 — count siblings serving the same publicModel.
            const siblingCount = props.models.filter(
              (m) => m.publicModel === model.publicModel && m.id !== model.id
            ).length;
            const isEditing = editingId === model.id;
            const isTesting = testingId === model.id;
            const lastTest = testResult[model.id];
            return (
              <article className={model.enabled ? "modelTile" : "modelTile disabled"} key={model.id}>
                <div className="modelTileIcon"><Bot size={18} /></div>
                <div className="modelTileBody">
                  {isEditing ? (
                    <div className="modelEditForm">
                      <label>
                        Public model
                        <input
                          value={editDraft.publicModel}
                          onChange={(e) => setEditDraft({ ...editDraft, publicModel: e.target.value })}
                        />
                      </label>
                      <label>
                        Upstream model
                        <input
                          value={editDraft.upstreamModel}
                          onChange={(e) => setEditDraft({ ...editDraft, upstreamModel: e.target.value })}
                        />
                      </label>
                      <label>
                        Capabilities (csv)
                        <input
                          value={editDraft.capabilities}
                          onChange={(e) => setEditDraft({ ...editDraft, capabilities: e.target.value })}
                        />
                      </label>
                      <div className="modelEditFormActions">
                        <button type="button" className="save" onClick={() => void saveEdit(model)}>Save</button>
                        <button type="button" className="cancel" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="modelNameRow">
                        <code>{model.publicModel}</code>
                        {siblingCount > 0 && (
                          <span
                            title={`Also served by ${siblingCount} other channel(s) — gateway will failover automatically`}
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 10,
                              background: "rgba(59,130,246,0.15)",
                              color: "#60a5fa",
                              marginLeft: 6
                            }}
                          >
                            +{siblingCount} more
                          </span>
                        )}
                        <button className="iconButton compact" title="Copy public model" type="button" onClick={() => void copyText(model.publicModel)}>
                          <Clipboard size={15} />
                        </button>
                      </div>
                      <span>{formatModelLabel(model.upstreamModel)}</span>
                      <div className="modelMetaLine">
                        <StatusBadge status={model.enabled ? "active" : "disabled"} label={model.enabled ? "enabled" : "disabled"} />
                        <small>{provider?.name ?? model.providerInstanceId}</small>
                      </div>
                      <div className="modelActionRow">
                        <button
                          className="modelActionBtn primary"
                          type="button"
                          title="Test this model with a tiny prompt"
                          disabled={isTesting}
                          onClick={() => void testModel(model)}
                        >
                          <Zap size={12} /> {isTesting ? "Testing..." : "Test"}
                        </button>
                        <button
                          className="modelActionBtn"
                          type="button"
                          title="Edit public/upstream/capabilities"
                          onClick={() => startEdit(model)}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        <button
                          className="modelActionBtn danger"
                          type="button"
                          title="Delete this mapping"
                          onClick={() => void deleteModel(model)}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                      {lastTest && (
                        <div className={`modelTestResult ${lastTest.ok ? "ok" : "fail"}`}>
                          {lastTest.ok ? (
                            <>
                              <strong>✓ {lastTest.ms}ms</strong>
                              <div className="preview">{lastTest.preview}</div>
                            </>
                          ) : (
                            <>
                              <strong>✗ Failed</strong>
                              <div className="errMsg">{lastTest.error}</div>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <label className="switchControl" title={model.enabled ? "Disable model" : "Enable model"}>
                    <input type="checkbox" checked={model.enabled} onChange={(event) => void setModelEnabled(model, event.target.checked)} />
                    <span />
                  </label>
                )}
              </article>
            );
          })}

          <button className="addModelTile" type="button" onClick={() => setShowCreate((value) => !value)}>
            <Plus size={20} />
            <span>Add Model</span>
          </button>
        </div>
      </section>

      {showCreate && (
        <section className="modelCreatePanel">
          <div className="sectionHeader">
            <div>
              <h3>Add Model</h3>
              <p>Pick a provider preset, then adjust only the public or upstream name if needed.</p>
            </div>
            <span className="tag">{activeProviderType}</span>
          </div>

          <div className="presetRail">
            {presets.map((preset) => (
              <button className="presetPill" type="button" key={preset.id} onClick={() => applyPreset(preset)}>
                <Bot size={15} />
                <span>{preset.publicModel}</span>
                <code>{preset.upstreamModel}</code>
              </button>
            ))}
          </div>

          <form className="modelQuickForm" onSubmit={(event) => void create(event)}>
            <label>
              Provider
              <select value={draft.providerInstanceId} onChange={(event) => changeProvider(event.target.value)}>
                {props.instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>{instance.name}</option>
                ))}
              </select>
            </label>
            <label>
              Public model
              <input value={draft.publicModel} onChange={(event) => setDraft({ ...draft, publicModel: event.target.value })} />
            </label>
            <label>
              Upstream model
              <input value={draft.upstreamModel} onChange={(event) => setDraft({ ...draft, upstreamModel: event.target.value })} />
            </label>
            <label>
              Capabilities
              <input value={draft.capabilities} onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })} />
            </label>
            <details className="advancedModelFields">
              <summary>Advanced</summary>
              <label>
                Internal ID
                <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
              </label>
            </details>
            <div className={upstreamWarning ? "modelHint warning" : "modelHint"}>
              <Info size={15} />
              <span>{upstreamWarning ?? `${draft.publicModel || "public-model"} maps to ${draft.upstreamModel || "upstream-model"} on ${activeInstance?.name ?? draft.providerInstanceId}.`}</span>
            </div>
            <button className="primaryButton" type="submit"><Plus size={16} /> Add Model</button>
          </form>
        </section>
      )}

      {/* Model Aliases */}
      <ModelAliasesSection api={props.api} />

      {/* Model Pricing */}
      <ModelPricingSection api={props.api} />
    </div>
  );
}

function ModelAliasesSection({ api }: { api: ReturnType<typeof createApiClient> }) {
  const { t } = useLang();
  const [aliases, setAliases] = useState<Array<{ alias: string; target: string }>>([]);
  const [newAlias, setNewAlias] = useState("");
  const [newTarget, setNewTarget] = useState("");

  useEffect(() => {
    void api.getList<{ alias: string; target: string }>("/admin/v1/model-aliases")
      .then(setAliases)
      .catch(() => {});
  }, [api]);

  async function addAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlias.trim() || !newTarget.trim()) return;
    try {
      await api.post("/admin/v1/model-aliases", { alias: newAlias.trim(), target: newTarget.trim() });
      setAliases([...aliases, { alias: newAlias.trim(), target: newTarget.trim() }]);
      setNewAlias("");
      setNewTarget("");
      showToast("success", `Alias "${newAlias.trim()}" → "${newTarget.trim()}" created`);
    } catch {
      showToast("error", "Failed to create alias");
    }
  }

  async function removeAlias(alias: string) {
    try {
      await api.delete(`/admin/v1/model-aliases/${encodeURIComponent(alias)}`);
      setAliases(aliases.filter((a) => a.alias !== alias));
      showToast("success", `Alias "${alias}" removed`);
    } catch {
      showToast("error", "Failed to remove alias");
    }
  }

  return (
    <section className="modelBoard">
      <div className="modelBoardHeader">
        <div>
          <h3>{t("aliases.title")}</h3>
          <p>{t("aliases.subtitle")}</p>
        </div>
      </div>

      {aliases.length > 0 && (
        <div className="aliasTable">
          {aliases.map((a) => (
            <div key={a.alias} className="aliasRow">
              <code className="aliasName">{a.alias}</code>
              <span className="aliasArrow">→</span>
              <code className="aliasTarget">{a.target}</code>
              <button className="iconButton compact" title={t("aliases.remove")} onClick={() => void removeAlias(a.alias)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="aliasForm" onSubmit={(e) => void addAlias(e)}>
        <input
          placeholder={t("aliases.aliasPlaceholder")}
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
        />
        <span className="aliasArrow">→</span>
        <input
          placeholder={t("aliases.targetPlaceholder")}
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
        />
        <button className="primaryButton" type="submit" disabled={!newAlias.trim() || !newTarget.trim()}>
          <Plus size={14} /> {t("aliases.add")}
        </button>
      </form>
    </section>
  );
}

type ModelPreset = {
  id: string;
  publicModel: string;
  providerType: string;
  providerLabel: string;
  upstreamModel: string;
  capabilities: string[];
};

function getModelPresets(providerType: string): ModelPreset[] {
  const presets: Record<string, ModelPreset[]> = {
    kiro: [
      {
        id: "model_kiro_sonnet_45",
        publicModel: "kiro-sonnet",
        providerType: "kiro",
        providerLabel: "Kiro recommended",
        upstreamModel: "claude-sonnet-4.5",
        capabilities: ["chat", "streaming"]
      }
    ],
    windsurf: [
      {
        id: "model_windsurf_sonnet",
        publicModel: "windsurf-sonnet",
        providerType: "windsurf",
        providerLabel: "Windsurf default",
        upstreamModel: "claude-sonnet-4-6-thinking",
        capabilities: ["chat", "streaming"]
      }
    ],
    mock: [
      {
        id: "model_mock_fast",
        publicModel: "mock-fast",
        providerType: "mock",
        providerLabel: "Local mock",
        upstreamModel: "mock-fast",
        capabilities: ["chat"]
      }
    ]
  };

  return presets[providerType] ?? [
    {
      id: `model_${providerType}_chat`,
      publicModel: `${providerType}-chat`,
      providerType,
      providerLabel: "Generic provider",
      upstreamModel: "provider-model-id",
      capabilities: ["chat"]
    }
  ];
}

function getUpstreamWarning(providerType: string, upstreamModel: string): string | null {
  if (providerType === "kiro" && upstreamModel.trim() === "sonnet") {
    return "Kiro không nên dùng upstream legacy `sonnet`; hãy dùng `claude-sonnet-4.5` để request đúng endpoint hiện tại.";
  }

  if (providerType === "windsurf" && upstreamModel.trim() === "sonnet") {
    return "Windsurf không dùng upstream legacy `sonnet`; hãy dùng model UID từ Cascade như `claude-sonnet-4-6-thinking`.";
  }

  if (!upstreamModel.trim()) {
    return "Upstream model không được để trống.";
  }

  return null;
}

function formatModelLabel(model: string): string {
  return model
    .replace(/^(ag|cu|kiro|windsurf)\//, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^(gpt|swe|k2|k1)$/i.test(part)) {
        return part.toUpperCase();
      }

      if (/^\d/.test(part)) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function RoutingProfiles(props: {
  profiles: RoutingProfile[];
  models: ModelMapping[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const { t } = useLang();
  const [showCreate, setShowCreate] = useState(false);
  const [editingProfile, setEditingProfile] = useState<RoutingProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoutingProfile | null>(null);

  async function deleteProfile(profile: RoutingProfile) {
    setPendingDelete(profile);
  }

  async function confirmDeleteProfile() {
    const profile = pendingDelete;
    if (!profile) return;
    setPendingDelete(null);
    try {
      await props.api.delete(`/admin/v1/routing-profiles/${profile.id}`);
      await props.refresh();
    } catch { /* ignore */ }
  }

  async function toggleEnabled(profile: RoutingProfile) {
    await props.api.patch(`/admin/v1/routing-profiles/${profile.id}`, { enabled: !profile.enabled });
    await props.refresh();
  }

  async function toggleRoundRobin(profile: RoutingProfile) {
    await props.api.patch(`/admin/v1/routing-profiles/${profile.id}`, { fallback: !profile.fallback });
    await props.refresh();
  }

  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle">{t("routes.title")}</h2>
          <p className="routesSubtitle">{t("routes.subtitle")}</p>
        </div>
        <button className="primaryButton" onClick={() => { setEditingProfile(null); setShowCreate(true); }}>
          <Plus size={16} /> {t("routes.createRoute")}
        </button>
      </div>

      {props.profiles.length === 0 ? (
        <div className="routesEmpty">
          <Route size={24} />
          <p>{t("routes.noRoutes")}</p>
          <small>{t("routes.noRoutesHint")}</small>
        </div>
      ) : (
        <div className="routesList">
          {props.profiles.map((profile) => (
            <div key={profile.id} className={`routeCard ${!profile.enabled ? "routeCard--disabled" : ""}`}>
              <div className="routeCardLeft">
                <Route size={18} className="routeIcon" />
                <div className="routeCardInfo">
                  <strong>{profile.displayName}</strong> <code style={{ fontSize: "0.75em", opacity: 0.7 }}>model: {profile.id}</code>
                  <div className="routeModelTags">
                    {profile.candidates.slice(0, 3).map((c) => (
                      <span key={c} className="routeModelTag">{c}</span>
                    ))}
                    {profile.candidates.length > 3 && (
                      <span className="routeModelTag routeModelTag--more">+{profile.candidates.length - 3} {t("routes.more")}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="routeCardRight">
                <label className="routeToggleLabel">
                  <span>{t("routes.roundRobin")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={profile.fallback}
                    className={`toggleSwitch ${profile.fallback ? "on" : "off"}`}
                    onClick={() => void toggleRoundRobin(profile)}
                  >
                    <span className="toggleSwitchKnob" />
                  </button>
                </label>
                <button className="iconButton" title={t("routes.copyId")} onClick={() => void copyText(profile.id)}>
                  <Clipboard size={16} />
                </button>
                <button className="iconButton" title={t("common.edit")} onClick={() => { setEditingProfile(profile); setShowCreate(true); }}>
                  <Settings size={16} />
                </button>
                <button className="iconButton danger" title={t("common.delete")} onClick={() => void deleteProfile(profile)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <RouteModal
          profile={editingProfile}
          models={props.models}
          profiles={props.profiles}
          api={props.api}
          refresh={props.refresh}
          onClose={() => setShowCreate(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t("routes.deleteRoute") ?? "Delete route"}
          message={`${t("routes.deleteConfirm") ?? "Delete route"} "${pendingDelete.displayName}"?`}
          confirmLabel={t("common.delete") ?? "Delete"}
          cancelLabel={t("common.cancel") ?? "Cancel"}
          onConfirm={() => void confirmDeleteProfile()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function RouteModal(props: {
  profile: RoutingProfile | null;
  models: ModelMapping[];
  profiles: RoutingProfile[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const isEdit = !!props.profile;
  const [name, setName] = useState(props.profile?.displayName ?? "");
  const [candidates, setCandidates] = useState<string[]>(props.profile?.candidates ?? []);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...candidates];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setCandidates(next);
  }

  function moveDown(index: number) {
    if (index >= candidates.length - 1) return;
    const next = [...candidates];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setCandidates(next);
  }

  function remove(index: number) {
    setCandidates(candidates.filter((_, i) => i !== index));
  }

  function addModels(models: string[]) {
    const existing = new Set(candidates);
    const toAdd = models.filter((m) => !existing.has(m));
    setCandidates([...candidates, ...toAdd]);
  }

  async function submit() {
    if (!name.trim() || candidates.length === 0) return;
    setBusy(true);
    try {
      const id = props.profile?.id ?? name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
      if (isEdit) {
        await props.api.patch(`/admin/v1/routing-profiles/${props.profile!.id}`, {
          displayName: name.trim(),
          candidates
        });
      } else {
        await props.api.post("/admin/v1/routing-profiles", {
          id,
          displayName: name.trim(),
          candidates,
          requiredCapabilities: ["chat"],
          fallback: true,
          enabled: true
        });
      }
      await props.refresh();
      props.onClose();
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent RouteModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{isEdit ? t("routes.editRoute") : t("routes.createRouteTitle")}</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>

        <div className="routeForm">
          <label className="routeFormLabel">
            {t("routes.routeName")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Standard"
              className="routeNameInput"
            />
            <small>{t("routes.routeNameHint")}</small>
          </label>

          <div className="routeFormLabel">
            <strong>{t("routes.modelsLabel")}</strong>
            <div className="routeModelList">
              {candidates.map((model, i) => (
                <div key={`${model}-${i}`} className="routeModelItem">
                  <span className="routeModelDrag">⋮⋮</span>
                  <span className="routeModelIndex">{i + 1}</span>
                  <span className="routeModelName">{model}</span>
                  <div className="routeModelActions">
                    <button className="iconButton" disabled={i === 0} onClick={() => moveUp(i)} title={t("routes.moveUp")}>↑</button>
                    <button className="iconButton" disabled={i === candidates.length - 1} onClick={() => moveDown(i)} title={t("routes.moveDown")}>↓</button>
                    <button className="iconButton" onClick={() => remove(i)} title={t("routes.remove")}>×</button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="routeAddModelBtn" onClick={() => setShowPicker(true)}>
              <Plus size={16} /> {t("routes.addModelBtn")}
            </button>
          </div>
        </div>

        <div className="RouteModalFooter">
          <button className="ghostButton" onClick={props.onClose}>{t("common.cancel")}</button>
          <button className="primaryButton" disabled={busy || !name.trim() || candidates.length === 0} onClick={() => void submit()}>
            {busy ? t("routes.saving") : isEdit ? t("common.save") : t("common.create")}
          </button>
        </div>

        {showPicker && (
          <ModelPickerModal
            models={props.models}
            profiles={props.profiles}
            selected={new Set(candidates)}
            onDone={(added) => { addModels(added); setShowPicker(false); }}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

function ModelPickerModal(props: {
  models: ModelMapping[];
  profiles: RoutingProfile[];
  selected: Set<string>;
  onDone: (added: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(props.selected));

  // Group models by provider
  const grouped = useMemo(() => {
    const map = new Map<string, ModelMapping[]>();
    for (const m of props.models) {
      const key = m.providerType || "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [props.models]);

  function toggle(publicModel: string) {
    const next = new Set(picked);
    if (next.has(publicModel)) {
      next.delete(publicModel);
    } else {
      next.add(publicModel);
    }
    setPicked(next);
  }

  function done() {
    const added = Array.from(picked).filter((m) => !props.selected.has(m));
    props.onDone(added);
  }

  const lowerSearch = search.toLowerCase();

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent pickerModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{t("routes.addModelToRoute")}</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>

        <input
          className="pickerSearch"
          placeholder={t("routes.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        <div className="pickerList">
          {/* Existing combos */}
          {props.profiles.length > 0 && (
            <div className="pickerGroup">
              <h4 className="pickerGroupTitle pickerGroupTitle--route">
                <Route size={14} /> {t("routes.routesGroup")} ({props.profiles.length})
              </h4>
              <div className="pickerChips">
                {props.profiles
                  .filter((p) => !lowerSearch || p.displayName.toLowerCase().includes(lowerSearch))
                  .map((p) => (
                    <button
                      key={p.id}
                      className={`pickerChip ${picked.has(p.id) ? "pickerChip--selected" : ""}`}
                      onClick={() => toggle(p.id)}
                    >
                      {picked.has(p.id) && <CheckCircle2 size={14} />}
                      {p.displayName}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Models grouped by provider */}
          {Array.from(grouped.entries()).map(([provider, models]) => {
            const filtered = models.filter(
              (m) => !lowerSearch || m.publicModel.toLowerCase().includes(lowerSearch) || (m.upstreamModel ?? "").toLowerCase().includes(lowerSearch)
            );
            if (filtered.length === 0) return null;
            return (
              <div key={provider} className="pickerGroup">
                <h4 className="pickerGroupTitle">
                  <span className="pickerProviderDot" style={{ background: getProviderColor(provider) }} />
                  {provider.charAt(0).toUpperCase() + provider.slice(1)} ({filtered.length})
                </h4>
                <div className="pickerChips">
                  {filtered.map((m) => (
                    <button
                      key={m.publicModel}
                      className={`pickerChip ${picked.has(m.publicModel) ? "pickerChip--selected" : ""}`}
                      onClick={() => toggle(m.publicModel)}
                    >
                      {picked.has(m.publicModel) && <CheckCircle2 size={14} />}
                      {m.publicModel}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pickerFooter">
          <button className="primaryButton pickerDoneBtn" onClick={done}>{t("routes.done")}</button>
        </div>
      </div>
    </div>
  );
}

function getProviderColor(type: string): string {
  const colors: Record<string, string> = {
    windsurf: "#06b6d4",
    kiro: "#8b5cf6",
    openai: "#10a37f",
    anthropic: "#d97706",
    google: "#4285f4",
  };
  return colors[type] ?? "#6b7280";
}

type EndpointSettings = {
  requireApiKey: boolean;
  tunnel: { enabled: boolean; url?: string };
  tailscale: { enabled: boolean; url?: string };
  tokenSaver: {
    compressToolOutput: boolean;
    compressLlmOutput: boolean;
    llmCompressionMode: "lite" | "full" | "ultra";
  };
};

const DEFAULT_ENDPOINT_SETTINGS: EndpointSettings = {
  requireApiKey: true,
  tunnel: { enabled: false },
  tailscale: { enabled: false },
  tokenSaver: {
    compressToolOutput: false,
    compressLlmOutput: false,
    llmCompressionMode: "full"
  }
};

function EndpointPage(props: {
  keys: ApiKey[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<EndpointSettings>(DEFAULT_ENDPOINT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Load token saver settings from backend on mount
  useEffect(() => {
    props.api
      .get<EndpointSettings["tokenSaver"]>("/admin/v1/token-saver")
      .then((ts) => {
        setSettings((prev) => ({ ...prev, tokenSaver: { ...prev.tokenSaver, ...ts } }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Persist token saver to backend when changed (skip initial load)
  const updateTokenSaver = useCallback(
    (partial: Partial<EndpointSettings["tokenSaver"]>) => {
      const next = { ...settings.tokenSaver, ...partial };
      setSettings((prev) => ({ ...prev, tokenSaver: next }));
      void props.api.post("/admin/v1/token-saver", next).catch(() => {
        // revert on error — silent for now
      });
    },
    [settings.tokenSaver, props.api]
  );

  // Tunnel/tailscale state stays in localStorage (PR4 will wire backend)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("gateway.tunnelSettings");
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Pick<EndpointSettings, "tunnel" | "tailscale">>;
        setSettings((prev) => ({
          ...prev,
          tunnel: { ...prev.tunnel, ...(parsed.tunnel ?? {}) },
          tailscale: { ...prev.tailscale, ...(parsed.tailscale ?? {}) }
        }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "gateway.tunnelSettings",
      JSON.stringify({ tunnel: settings.tunnel, tailscale: settings.tailscale })
    );
  }, [settings.tunnel, settings.tailscale]);

  const localUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "http://localhost:3100/v1";
    }
    const { protocol, hostname, port } = window.location;
    // Use the same port as the current page (gateway serves dashboard)
    return `${protocol}//${hostname}:${port || "3100"}/v1`;
  }, []);

  return (
    <div className="stack endpointStack">
      <ApiInfoPanel />
      <TokenSaverSection settings={settings} onUpdate={updateTokenSaver} />
      <ApiKeysSection
        keys={props.keys}
        api={props.api}
        refresh={props.refresh}
        settings={settings}
        onChange={setSettings}
      />
    </div>
  );
}

function EndpointUrlsSection(props: {
  localUrl: string;
  settings: EndpointSettings;
  onChange: (next: EndpointSettings) => void;
}) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await copyText(props.localUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // ignore clipboard errors silently — user can read the URL
    }
  }

  function toggleTunnel() {
    const enabled = !props.settings.tunnel.enabled;
    props.onChange({
      ...props.settings,
      tunnel: { ...props.settings.tunnel, enabled }
    });
  }

  function toggleTailscale() {
    const enabled = !props.settings.tailscale.enabled;
    props.onChange({
      ...props.settings,
      tailscale: { ...props.settings.tailscale, enabled }
    });
  }

  return (
    <section className="endpointCard">
      <header className="endpointCardHeader">
        <Globe size={18} />
        <h2>{t("ep.apiEndpoint")}</h2>
      </header>
      <div className="endpointUrlRows">
        <div className="endpointUrlRow">
          <span className="endpointUrlLabel">{t("ep.local")}</span>
          <code className="endpointUrlValue">{props.localUrl}</code>
          <button
            type="button"
            className="iconButton"
            title={copied ? t("ep.copied") : t("ep.copy")}
            onClick={() => void copy()}
          >
            {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
          </button>
        </div>
        {/* Tunnel + Tailscale UI hidden until backend integration is implemented */}
      </div>
      {/* QR Code */}
      <div className="endpointQrRow">
        <span className="endpointUrlLabel">{t("ep.qrCode")}</span>
        <img
          className="endpointQr"
          src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(props.localUrl)}`}
          alt="Endpoint QR Code"
          width={120}
          height={120}
        />
        <span className="endpointQrHint">{t("ep.qrHint")}</span>
      </div>
    </section>
  );
}

function TokenSaverSection(props: {
  settings: EndpointSettings;
  onUpdate: (partial: Partial<EndpointSettings["tokenSaver"]>) => void;
}) {
  const { t } = useLang();
  const { tokenSaver } = props.settings;

  function update(partial: Partial<EndpointSettings["tokenSaver"]>) {
    props.onUpdate(partial);
  }

  return (
    <section className="endpointCard">
      <header className="endpointCardHeader">
        <Zap size={18} />
        <h2>{t("ep.tokenSaver")}</h2>
      </header>
      <div className="tokenSaverRow">
        <div className="tokenSaverInfo">
          <strong>
            {t("ep.compressToolOutput")}{" "}
            <a
              className="tokenSaverHint"
              href="https://github.com/anthropics/anthropic-cookbook"
              target="_blank"
              rel="noreferrer"
            >
              (RTK)
            </a>
          </strong>
          <span>{t("ep.compressToolOutputDesc")}</span>
        </div>
        <Toggle
          checked={tokenSaver.compressToolOutput}
          onChange={(checked) => update({ compressToolOutput: checked })}
        />
      </div>
      <div className="tokenSaverDivider" />
      <div className="tokenSaverRow">
        <div className="tokenSaverInfo">
          <strong>
            {t("ep.compressLlmOutput")}{" "}
            <a
              className="tokenSaverHint"
              href="https://github.com/dwgx/WindsurfAPI"
              target="_blank"
              rel="noreferrer"
            >
              (Caveman)
            </a>
          </strong>
          <span>{t("ep.compressLlmOutputDesc")}</span>
        </div>
        <div className="tokenSaverActions">
          <div className="segmentedControl">
            {(["lite", "full", "ultra"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`segmentedItem ${
                  tokenSaver.llmCompressionMode === mode ? "active" : ""
                }`}
                disabled={!tokenSaver.compressLlmOutput}
                onClick={() => update({ llmCompressionMode: mode })}
              >
                {mode === "lite" ? "Lite" : mode === "full" ? "Full" : "Ultra"}
              </button>
            ))}
          </div>
          <Toggle
            checked={tokenSaver.compressLlmOutput}
            onChange={(checked) => update({ compressLlmOutput: checked })}
          />
        </div>
      </div>
      <p className="tokenSaverFooter">
        {t("ep.compressionFooter")}
      </p>
    </section>
  );
}

function formatBalance(balance: number | undefined): { text: string; tone: "ok" | "low" | "unlimited" } {
  if (balance === undefined) return { text: "∞", tone: "unlimited" };
  if (balance === 0) return { text: "$0.00", tone: "low" };
  if (balance < 1) return { text: `$${balance.toFixed(4)}`, tone: balance < 0.1 ? "low" : "ok" };
  return { text: `$${balance.toFixed(2)}`, tone: "ok" };
}

function ApiKeysSection(props: {
  keys: ApiKey[];
  api: ReturnType<typeof createApiClient>;
  refresh: () => Promise<void>;
  settings: EndpointSettings;
  onChange: (next: EndpointSettings) => void;
}) {
  const { t } = useLang();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [owner, setOwner] = useState("");
  const [teamId, setTeamId] = useState("");
  const [rpmLimit, setRpmLimit] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [dailyTokenLimit, setDailyTokenLimit] = useState("");
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdKeyOwner, setCreatedKeyOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editOwner, setEditOwner] = useState("");
  const [editTeamId, setEditTeamId] = useState("");
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  const [revealedKeyValue, setRevealedKeyValue] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);
  const [topupTarget, setTopupTarget] = useState<ApiKey | null>(null);
  const [topupToast, setTopupToast] = useState<string | null>(null);
  const [editFullKey, setEditFullKey] = useState<ApiKey | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);

  // Load teams for dropdown
  useEffect(() => {
    props.api.getList<{ id: string; name: string }>("/admin/v1/teams").then(setTeams).catch(() => {});
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedOwner = owner.trim();
      const created = await props.api.post<ApiKey & { key: string }>(
        "/admin/v1/api-keys",
        {
          ...(trimmedOwner ? { owner: trimmedOwner } : {}),
          ...(teamId ? { teamId } : {}),
          ...(rpmLimit ? { rpmLimit: parseInt(rpmLimit, 10) } : {}),
          ...(dailyLimit ? { dailyLimit: parseInt(dailyLimit, 10) } : {}),
          ...(dailyTokenLimit ? { dailyTokenLimit: parseInt(dailyTokenLimit, 10) } : {})
        }
      );
      setCreatedKey(created.key);
      setCreatedKeyOwner(trimmedOwner || null);
      setOwner("");
      setTeamId("");
      setRpmLimit("");
      setDailyLimit("");
      setDailyTokenLimit("");
      setShowCreateForm(false);
      await props.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  async function setKeyEnabled(key: ApiKey, enabled: boolean) {
    try {
      await props.api.post(
        `/admin/v1/api-keys/${key.id}/${enabled ? "enable" : "disable"}`,
        {}
      );
      await props.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
    }
  }

  async function deleteKey(key: ApiKey) {
    setPendingDelete(key);
  }

  async function confirmDeleteKey() {
    const key = pendingDelete;
    if (!key) return;
    setPendingDelete(null);
    try {
      await props.api.delete(`/admin/v1/api-keys/${key.id}`);
      await props.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    }
  }

  async function editKey(key: ApiKey) {
    // Open inline edit mode for this key
    setEditingKeyId(key.id);
    setEditOwner(key.owner ?? "");
    setEditTeamId((key as unknown as { teamId?: string }).teamId ?? "");
  }

  async function saveEditKey() {
    if (!editingKeyId) return;
    try {
      await props.api.patch(`/admin/v1/api-keys/${editingKeyId}`, {
        owner: editOwner || undefined,
        teamId: editTeamId || undefined
      });
      setEditingKeyId(null);
      await props.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
    }
  }

  async function revealKey(key: ApiKey) {
    try {
      const result = await props.api.get<{ key: string }>(`/admin/v1/api-keys/${key.id}/reveal`);
      if (result.key) {
        await copyText(result.key);
        setRevealedKeyId(key.id);
        setRevealedKeyValue(result.key);
        window.setTimeout(() => { setRevealedKeyId(null); setRevealedKeyValue(null); }, 8_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal key");
    }
  }

  async function copyCreatedKey() {
    if (!createdKey) {
      return;
    }
    try {
      await copyText(createdKey);
      setCopiedKeyId("created");
      window.setTimeout(() => setCopiedKeyId(null), 1_500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="endpointCard">
      <header className="endpointCardHeader endpointCardHeaderRow">
        <div>
          <KeyRound size={18} />
          <h2>{t("ep.apiKeys")}</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => {
                setBatchMode(e.target.checked);
                if (!e.target.checked) setSelectedIds(new Set());
              }}
            />
            {t("apikey.batchMode")}
          </label>
          <button
            type="button"
            className="ghostButton"
            onClick={() => setShowExport(true)}
          >
            {t("apikey.batchExport")}
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => {
              setShowCreateForm(true);
              setCreatedKey(null);
            }}
          >
            <Plus size={16} /> {t("ep.createKey")}
          </button>
        </div>
      </header>

      {batchMode && (
        <div
          style={{
            padding: "8px 16px",
            background: "var(--color-surface-2)",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            fontSize: 12,
          }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === props.keys.length}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < props.keys.length;
              }}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(props.keys.map((k) => k.id)));
                else setSelectedIds(new Set());
              }}
            />
            {t("apikey.batchSelectAll")} ({selectedIds.size})
          </label>
          <button
            type="button"
            className="ghostButton"
            disabled={selectedIds.size === 0}
            onClick={() => setPendingBatchDelete(true)}
          >
            <Trash2 size={14} /> {t("apikey.batchDelete")}
          </button>
          <button
            type="button"
            className="ghostButton"
            disabled={selectedIds.size === 0}
            onClick={async () => {
              await Promise.all(
                Array.from(selectedIds).map((id) =>
                  props.api.post(`/admin/v1/api-keys/${id}/disable`, {})
                )
              );
              setSelectedIds(new Set());
              await props.refresh();
            }}
          >
            {t("apikey.batchDisable")}
          </button>
          <button
            type="button"
            className="ghostButton"
            disabled={selectedIds.size === 0}
            onClick={async () => {
              await Promise.all(
                Array.from(selectedIds).map((id) =>
                  props.api.post(`/admin/v1/api-keys/${id}/enable`, {})
                )
              );
              setSelectedIds(new Set());
              await props.refresh();
            }}
          >
            {t("apikey.batchEnable")}
          </button>
        </div>
      )}

      <div className="endpointToggleRow">
        <div>
          <strong>{t("ep.requireApiKey")}</strong>
          <span>{t("ep.requireApiKeyDesc")}</span>
        </div>
        <Toggle
          checked={props.settings.requireApiKey}
          onChange={(checked) =>
            props.onChange({ ...props.settings, requireApiKey: checked })
          }
        />
      </div>

      {showCreateForm ? (
        <form
          className="endpointCreateForm"
          onSubmit={(event) => void create(event)}
        >
          <label>
            {t("ep.name")}
            <input
              autoFocus
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="e.g. claude-code"
            />
          </label>
          {teams.length > 0 ? (
            <label>
              {t("ep.team")}
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">{t("ep.noTeam")}</option>
                {teams.map((t2) => (
                  <option key={t2.id} value={t2.id}>{t2.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              {t("ep.team")}
              <select value="" disabled>
                <option value="">{t("ep.noTeamsYet")}</option>
              </select>
            </label>
          )}
          <div className="endpointCreateFormRow">
            <label>
              {t("ep.rpmLimit")}
              <input
                type="number"
                min="0"
                value={rpmLimit}
                onChange={(e) => setRpmLimit(e.target.value)}
                placeholder={t("ep.unlimited")}
              />
              <small>{t("ep.rpmLimitHint")}</small>
            </label>
            <label>
              {t("ep.dailyLimit")}
              <input
                type="number"
                min="0"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                placeholder={t("ep.unlimited")}
              />
              <small>{t("ep.dailyLimitHint")}</small>
            </label>
            <label>
              {t("ep.dailyTokenLimit")}
              <input
                type="number"
                min="0"
                value={dailyTokenLimit}
                onChange={(e) => setDailyTokenLimit(e.target.value)}
                placeholder={t("ep.unlimited")}
              />
              <small>{t("ep.dailyTokenLimitHint")}</small>
            </label>
          </div>
          <div className="endpointCreateFormActions">
            <button
              type="button"
              className="ghostButton"
              onClick={() => {
                setShowCreateForm(false);
                setOwner("");
                setError(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? t("ep.creating") : t("common.create")}
            </button>
          </div>
        </form>
      ) : null}

      {createdKey ? (
        <div className="endpointNewKey">
          <div className="endpointNewKeyHeader">
            <BadgeCheck size={16} />
            <strong>{t("ep.newKeyCreated")}</strong>
            <span>{t("ep.newKeyHint")}</span>
          </div>
          <div className="endpointNewKeyRow">
            <code>{createdKey}</code>
            <button
              type="button"
              className="iconButton"
              title={t("ep.copy")}
              onClick={() => void copyCreatedKey()}
            >
              {copiedKeyId === "created" ? (
                <CheckCircle2 size={16} />
              ) : (
                <Clipboard size={16} />
              )}
            </button>
            <button
              type="button"
              className="iconButton"
              title={t("ep.dismiss")}
              onClick={() => {
                setCreatedKey(null);
                setCreatedKeyOwner(null);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {createdKeyOwner ? (
            <small>{t("ep.name")}: {createdKeyOwner}</small>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="endpointError">{error}</div> : null}

      {props.keys.length === 0 ? (
        <div className="endpointEmpty">
          <KeyRound size={20} />
          <p>{t("ep.noKeysYet")}</p>
          <small>
            {t("ep.noKeysHint")}
          </small>
        </div>
      ) : (
        <ul className="endpointKeyList">
          {props.keys.map((key) => (
            <li key={key.id} className="endpointKeyItem">
              {batchMode && (
                <input
                  type="checkbox"
                  style={{ marginRight: 8 }}
                  checked={selectedIds.has(key.id)}
                  onChange={(e) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(key.id);
                      else next.delete(key.id);
                      return next;
                    });
                  }}
                />
              )}
              {editingKeyId === key.id ? (
                <div className="endpointKeyEditForm">
                  <label>
                    {t("ep.owner")}
                    <input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} placeholder={t("ep.name")} />
                  </label>
                  <label>
                    {t("ep.team")}
                    <select value={editTeamId} onChange={(e) => setEditTeamId(e.target.value)}>
                      <option value="">{t("ep.noTeam")}</option>
                      {teams.map((t2) => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
                    </select>
                  </label>
                  <button className="primaryButton" onClick={() => void saveEditKey()}>{t("common.save")}</button>
                  <button className="ghostButton" onClick={() => setEditingKeyId(null)}>{t("common.cancel")}</button>
                </div>
              ) : (
                <>
                  <div className="endpointKeyMeta">
                    <strong>
                      {key.owner ?? key.id}
                      {(key as unknown as { teamId?: string }).teamId && (
                        <span className="endpointKeyTeamBadge">
                          {teams.find((t) => t.id === (key as unknown as { teamId?: string }).teamId)?.name ?? "team"}
                        </span>
                      )}
                      {(() => {
                        const b = formatBalance(key.balance);
                        return (
                          <span
                            className="balanceBadge"
                            data-tone={b.tone}
                            title={b.tone === "unlimited" ? t("apikey.unlimited") : t("apikey.balance")}
                          >
                            {b.text}
                          </span>
                        );
                      })()}
                    </strong>
                    {revealedKeyId === key.id && revealedKeyValue ? (
                      <code className="endpointKeyRevealed">{revealedKeyValue}</code>
                    ) : (
                      <code>{`${key.keyHash.slice(0, 6)}…`}</code>
                    )}
                    <small>
                      {t("ep.created")} {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "—"}
                      {" · "}
                      {formatLimit(key.limits?.minuteRequests, key.limits?.requestsPerMinuteLimit)}/min
                      {" · "}
                      {formatLimit(key.limits?.dailyRequests, key.limits?.dailyRequestQuota)}/day
                      {key.limits?.dailyTokenQuota && key.limits.dailyTokenQuota > 0 ? (
                        <>
                          {" · "}
                          {formatLimit(key.limits?.dailyTokens, key.limits?.dailyTokenQuota)} tok/day
                        </>
                      ) : null}
                      {isQuotaExhausted(key.limits) ? (
                        <span className="endpointKeyQuotaExhausted">
                          {" · "}{t("ep.quotaExhausted")}
                        </span>
                      ) : null}
                      {key.expiresAt && (() => {
                        const expDate = new Date(key.expiresAt);
                        const expired = expDate.getTime() < Date.now();
                        return (
                          <span
                            style={{ marginLeft: 8, color: expired ? "#ef4444" : "var(--color-text-muted)" }}
                            title={expDate.toLocaleString()}
                          >
                            ⏰ {expired ? t("apikey.expired") : expDate.toLocaleDateString()}
                          </span>
                        );
                      })()}
                      {key.allowedModels && key.allowedModels.length > 0 && (
                        <span
                          style={{ marginLeft: 8, color: "var(--color-text-muted)" }}
                          title={key.allowedModels.join(", ")}
                        >
                          {t("apikey.modelsCount").replace("{n}", String(key.allowedModels.length))}
                        </span>
                      )}
                      {key.allowedIps && key.allowedIps.length > 0 && (
                        <span
                          style={{ marginLeft: 8, color: "var(--color-text-muted)" }}
                          title={key.allowedIps.join(", ")}
                        >
                          {t("apikey.ipsCount").replace("{n}", String(key.allowedIps.length))}
                        </span>
                      )}
                      {/* Phase 32 — spending caps badge */}
                      <SpendBadge scope="key" id={key.id} api={props.api} />
                    </small>
                    {/* Phase 26 — Quota progress bars */}
                    {(() => {
                      const bars: React.ReactNode[] = [];
                      const dr = key.limits?.dailyRequestQuota;
                      const dt = key.limits?.dailyTokenQuota;
                      if (dr && dr > 0) {
                        const used = key.limits?.dailyRequests ?? 0;
                        const pct = Math.min(100, Math.round((used / dr) * 100));
                        const tone = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";
                        bars.push(
                          <div key="dr" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11 }}>
                            <span style={{ minWidth: 70, color: "var(--color-text-muted)" }}>Requests</span>
                            <div style={{ flex: 1, height: 6, background: "var(--color-surface-2, #1f2937)", borderRadius: 3, overflow: "hidden", maxWidth: 200 }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: tone, transition: "width 0.3s" }} />
                            </div>
                            <span style={{ fontVariantNumeric: "tabular-nums", color: tone }}>{used}/{dr}</span>
                          </div>
                        );
                      }
                      if (dt && dt > 0) {
                        const used = key.limits?.dailyTokens ?? 0;
                        const pct = Math.min(100, Math.round((used / dt) * 100));
                        const tone = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";
                        bars.push(
                          <div key="dt" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11 }}>
                            <span style={{ minWidth: 70, color: "var(--color-text-muted)" }}>Tokens</span>
                            <div style={{ flex: 1, height: 6, background: "var(--color-surface-2, #1f2937)", borderRadius: 3, overflow: "hidden", maxWidth: 200 }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: tone, transition: "width 0.3s" }} />
                            </div>
                            <span style={{ fontVariantNumeric: "tabular-nums", color: tone }}>{(used / 1000).toFixed(1)}k/{(dt / 1000).toFixed(0)}k</span>
                          </div>
                        );
                      }
                      return bars.length > 0 ? bars : null;
                    })()}
                  </div>
                  <div className="endpointKeyActions">
                    <button
                      type="button"
                      className="endpointKeyBtn"
                      title={t("ep.copyKey")}
                      onClick={() => void revealKey(key)}
                    >
                      {revealedKeyId === key.id ? t("ep.copiedKey") : t("ep.copyKeyBtn")}
                    </button>
                    <button
                      type="button"
                      className="endpointKeyBtn"
                      title={t("ep.editTeamOwner")}
                      onClick={() => setEditFullKey(key)}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className="iconButton compact"
                      title={t("apikey.topup")}
                      onClick={() => setTopupTarget(key)}
                    >
                      <Plus size={14} />
                    </button>
                    <Toggle
                      checked={key.enabled}
                      onChange={(checked) => void setKeyEnabled(key, checked)}
                    />
                    <button
                      type="button"
                      className="iconButton danger"
                      title={t("ep.deleteKey")}
                      onClick={() => void deleteKey(key)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t("ep.deleteKey") ?? "Delete API key"}
          message={`${t("common.deleteConfirm") ?? "Delete API key"} ${pendingDelete.id}${pendingDelete.owner ? ` (${pendingDelete.owner})` : ""}? ${t("common.cannotUndo") ?? "This cannot be undone."}`}
          confirmLabel={t("common.delete") ?? "Delete"}
          cancelLabel={t("common.cancel") ?? "Cancel"}
          onConfirm={() => void confirmDeleteKey()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {topupTarget && (
        <TopupModal
          apiKeyId={topupTarget.id}
          ownerLabel={topupTarget.owner ?? topupTarget.id}
          currentBalance={topupTarget.balance}
          api={props.api}
          onClose={() => setTopupTarget(null)}
          onSuccess={async (newBalance, added) => {
            setTopupTarget(null);
            setTopupToast(
              t("apikey.topupSuccess")
                .replace("${amount}", added.toFixed(2))
                .replace("${balance}", newBalance.toFixed(2))
            );
            window.setTimeout(() => setTopupToast(null), 4000);
            await props.refresh();
          }}
        />
      )}
      {topupToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 16px",
            background: "#10b981",
            color: "white",
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          {topupToast}
        </div>
      )}
      {editFullKey && (
        <ApiKeyEditModal
          apiKey={editFullKey as ApiKeyForEdit}
          api={props.api}
          teams={teams}
          onClose={() => setEditFullKey(null)}
          onSaved={async () => {
            setEditFullKey(null);
            await props.refresh();
          }}
        />
      )}
      {showExport && (
        <ApiKeyExportModal
          fetchCsv={async () => {
            const adminKey = window.sessionStorage.getItem("gateway.adminKey") ?? "";
            const response = await fetch("/admin/v1/api-keys/export?format=csv", {
              headers: {
                authorization: `Bearer ${adminKey}`
              }
            });
            if (!response.ok) {
              throw new Error(`Export failed: ${response.status}`);
            }
            return response.text();
          }}
          onClose={() => setShowExport(false)}
        />
      )}
      {pendingBatchDelete && (
        <ConfirmDialog
          title={t("apikey.batchDelete")}
          message={t("apikey.confirmBatchDelete").replace("{n}", String(selectedIds.size))}
          variant="danger"
          confirmLabel={t("common.delete") ?? "Delete"}
          onConfirm={async () => {
            setPendingBatchDelete(false);
            try {
              await props.api.post("/admin/v1/api-keys/batch-delete", {
                ids: Array.from(selectedIds)
              });
              setSelectedIds(new Set());
              await props.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Batch delete failed");
            }
          }}
          onCancel={() => setPendingBatchDelete(false)}
        />
      )}
    </section>
  );
}

function Toggle(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      className={`toggleSwitch ${props.checked ? "on" : "off"} ${
        props.disabled ? "disabled" : ""
      }`}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
    >
      <span className="toggleSwitchKnob" />
    </button>
  );
}

function CliTools({ keys }: { keys: ApiKey[] }) {
  const { t } = useLang();
  const apiKeyHint = keys[0]?.id ?? "<your-api-key>";
  const baseUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port || "3100"}`;
  const [copied, setCopied] = useState<string | null>(null);

  function copySnippet(id: string, value: string) {
    void copyText(value);
    setCopied(id);
    showToast("success", "Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  }

  const tools = [
    {
      id: "cursor",
      name: "Cursor",
      icon: "⚡",
      description: "AI-powered code editor with built-in chat and autocomplete",
      config: `// Cursor Settings → Models → OpenAI API Key
Base URL: ${baseUrl}/v1
API Key: ${apiKeyHint}
Model: coding`,
      steps: [
        "Open Cursor Settings (⌘ + ,)",
        "Go to Models → OpenAI API Key",
        `Set Base URL to ${baseUrl}/v1`,
        `Paste your API key: ${apiKeyHint}`,
        "Select model: coding"
      ]
    },
    {
      id: "cline",
      name: "Cline",
      icon: "🔌",
      description: "Autonomous coding agent for VS Code",
      config: `// Cline Extension Settings
Provider: OpenAI Compatible
Base URL: ${baseUrl}/v1
API Key: ${apiKeyHint}
Model ID: coding`,
      steps: [
        "Install Cline extension in VS Code",
        "Open Cline settings (gear icon)",
        "Select 'OpenAI Compatible' as provider",
        `Set Base URL: ${baseUrl}/v1`,
        `Set API Key: ${apiKeyHint}`
      ]
    },
    {
      id: "claude-code",
      name: "Claude Code",
      icon: "🤖",
      description: "Anthropic's CLI coding assistant",
      config: `export ANTHROPIC_BASE_URL=${baseUrl}
export ANTHROPIC_API_KEY=${apiKeyHint}
claude`,
      steps: [
        "Set environment variables in your shell",
        `export ANTHROPIC_BASE_URL=${baseUrl}`,
        `export ANTHROPIC_API_KEY=${apiKeyHint}`,
        "Run: claude"
      ]
    },
    {
      id: "aider",
      name: "Aider",
      icon: "🛠️",
      description: "AI pair programming in your terminal",
      config: `export OPENAI_API_BASE=${baseUrl}/v1
export OPENAI_API_KEY=${apiKeyHint}
aider --model coding`,
      steps: [
        "Set environment variables",
        `export OPENAI_API_BASE=${baseUrl}/v1`,
        `export OPENAI_API_KEY=${apiKeyHint}`,
        "Run: aider --model coding"
      ]
    },
    {
      id: "continue",
      name: "Continue",
      icon: "▶️",
      description: "Open-source AI code assistant for VS Code & JetBrains",
      config: `// ~/.continue/config.json
{
  "models": [{
    "title": "Gateway",
    "provider": "openai",
    "model": "coding",
    "apiBase": "${baseUrl}/v1",
    "apiKey": "${apiKeyHint}"
  }]
}`,
      steps: [
        "Open ~/.continue/config.json",
        "Add a model entry with provider: openai",
        `Set apiBase: ${baseUrl}/v1`,
        `Set apiKey: ${apiKeyHint}`,
        "Set model: coding"
      ]
    },
    {
      id: "codex",
      name: "OpenAI Codex CLI",
      icon: "💻",
      description: "OpenAI's terminal-based coding agent",
      config: `export OPENAI_BASE_URL=${baseUrl}/v1
export OPENAI_API_KEY=${apiKeyHint}
codex`,
      steps: [
        "Set environment variables",
        `export OPENAI_BASE_URL=${baseUrl}/v1`,
        `export OPENAI_API_KEY=${apiKeyHint}`,
        "Run: codex"
      ]
    }
  ];

  return (
    <div className="cliToolsPage">
      <div className="cliToolsHeader">
        <div>
          <h2>{t("cli.title")}</h2>
          <p>{t("cli.subtitle")}</p>
        </div>
        <div className="cliToolsQuickInfo">
          <div className="cliQuickItem">
            <span className="cliQuickLabel">Endpoint</span>
            <code>{baseUrl}/v1</code>
          </div>
          <div className="cliQuickItem">
            <span className="cliQuickLabel">API Key</span>
            <code>{apiKeyHint}</code>
          </div>
        </div>
      </div>

      <div className="cliToolsGrid">
        {tools.map((tool) => (
          <article className="cliToolCard" key={tool.id}>
            <div className="cliToolCardHeader">
              <span className="cliToolIcon">{tool.icon}</span>
              <div>
                <h3>{tool.name}</h3>
                <p>{tool.description}</p>
              </div>
            </div>
            <div className="cliToolConfig">
              <div className="cliToolConfigHeader">
                <span>Configuration</span>
                <button
                  className={`cliCopyBtn ${copied === tool.id ? "copied" : ""}`}
                  onClick={() => copySnippet(tool.id, tool.config)}
                  title="Copy to clipboard"
                >
                  {copied === tool.id ? <CheckCircle2 size={14} /> : <Clipboard size={14} />}
                  {copied === tool.id ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="cliToolCode">{tool.config}</pre>
            </div>
            <div className="cliToolSteps">
              <span className="cliStepsLabel">Quick Setup</span>
              <ol>
                {tool.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Playground(props: { models: ModelMapping[]; profiles: RoutingProfile[] }) {
  const { t } = useLang();
  const modelOptions = [
    ...props.models.filter((model) => model.enabled).map((model) => model.publicModel),
    ...props.profiles.filter((profile) => profile.enabled).map((profile) => profile.id)
  ];
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem("gateway.playgroundKey") ?? "dev-key-1");
  const [model, setModel] = useState(() => window.localStorage.getItem("gateway.playgroundModel") ?? modelOptions[0] ?? "kiro-sonnet");
  const [prompt, setPrompt] = useState("Say hello from the gateway.");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);
  const [history, setHistory] = useState<Array<{ role: string; content: string }>>([]);

  useEffect(() => {
    window.localStorage.setItem("gateway.playgroundKey", apiKey);
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem("gateway.playgroundModel", model);
  }, [model]);

  async function run(event?: React.FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    if (!prompt.trim() || running) return;
    setRunning(true);
    setResult("");

    const userMsg = { role: "user", content: prompt };
    const messages = [...history, userMsg];
    // Show user message immediately
    setHistory(messages);
    setPrompt("");

    try {
      const response = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        const errText = JSON.stringify(payload, null, 2);
        setResult(errText);
        setHistory([...messages, { role: "assistant", content: errText }]);
      } else {
        const content = payload.choices?.[0]?.message?.content ?? JSON.stringify(payload, null, 2);
        setResult(content);
        setHistory([...messages, { role: "assistant", content }]);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Request failed";
      setResult(errMsg);
      setHistory([...messages, { role: "assistant", content: errMsg }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="pgPage">
      <div className="pgHeader">
        <div>
          <h2>{t("pg.title")}</h2>
          <p>{t("pg.subtitle")}</p>
        </div>
        <div className="pgHeaderActions">
          {history.length > 0 && (
            <button className="ghostButton" onClick={() => { setHistory([]); setResult(""); }}>
              <Trash2 size={14} /> {t("pg.clearChat")}
            </button>
          )}
        </div>
      </div>

      <div className="pgLayout">
        {/* Sidebar config */}
        <aside className="pgSidebar">
          <div className="pgConfigCard">
            <h3>{t("pg.config")}</h3>
            <label className="pgField">
              <span>{t("pg.apiKey")}</span>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Your internal API key" />
            </label>
            <label className="pgField">
              <span>{t("pg.modelRoute")}</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {(modelOptions.length ? modelOptions : ["coding"]).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="pgField">
              <span>{t("pg.maxTokens")} <code>{maxTokens}</code></span>
              <input type="range" min={64} max={4096} step={64} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
            </label>
            <label className="pgField">
              <span>{t("pg.temperature")} <code>{temperature.toFixed(1)}</code></span>
              <input type="range" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
            </label>
          </div>

          <div className="pgInfoCard">
            <Info size={14} />
            <span>{t("pg.info")}</span>
          </div>
        </aside>

        {/* Chat area */}
        <div className="pgChat">
          {/* Message history */}
          <div className="pgMessages">
            {history.length === 0 && !result && (
              <div className="pgEmptyChat">
                <Bot size={32} />
                <h3>{t("pg.startConversation")}</h3>
                <p>{t("pg.startSubtitle")}</p>
              </div>
            )}
            {history.map((msg, i) => (
              <div key={i} className={`pgMessage pgMessage--${msg.role}`}>
                <div className="pgMessageAvatar">
                  {msg.role === "user" ? "You" : <Bot size={14} />}
                </div>
                <div className="pgMessageContent">
                  <pre>{msg.content}</pre>
                </div>
              </div>
            ))}
            {running && (
              <div className="pgMessage pgMessage--assistant">
                <div className="pgMessageAvatar"><Bot size={14} /></div>
                <div className="pgMessageContent pgTyping">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form className="pgInputBar" onSubmit={(e) => void run(e)}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("pg.placeholder")}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <button className="pgSendBtn" type="submit" disabled={running || !prompt.trim()}>
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RequestLogs({ logs, apiKeys, api, refresh }: { logs: RequestLog[]; apiKeys: ApiKey[]; api: ReturnType<typeof createApiClient>; refresh: () => Promise<void> }) {
  const { t } = useLang();
  const [filter, setFilter] = useState<"all" | "success" | "error">("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [tokenFilter, setTokenFilter] = useState<string>("all"); // Phase 26 — filter by API key
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [visibleCols, setVisibleCols] = useState<{
    method: boolean; route: boolean; status: boolean; duration: boolean; time: boolean; actor: boolean;
  }>(() => {
    const saved = window.localStorage.getItem("rl.columns");
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return { method: true, route: true, status: true, duration: true, time: true, actor: true };
  });
  const perPage = 50;

  useEffect(() => {
    window.localStorage.setItem("rl.columns", JSON.stringify(visibleCols));
  }, [visibleCols]);

  const allMethods = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) set.add(l.method);
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    let result = logs;
    if (filter === "success") result = result.filter((l) => l.statusCode < 400);
    if (filter === "error") result = result.filter((l) => l.statusCode >= 400);
    if (methodFilter !== "all") result = result.filter((l) => l.method === methodFilter);
    if (tokenFilter !== "all") result = result.filter((l) => l.apiKeyHash === tokenFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((l) =>
        l.route.toLowerCase().includes(q) ||
        l.requestId.toLowerCase().includes(q) ||
        l.method.toLowerCase().includes(q) ||
        (l.apiKeyHash ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [logs, filter, methodFilter, tokenFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filter, methodFilter, tokenFilter, search]);

  const stats = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter((l) => l.statusCode >= 400).length;
    const avgDuration = total > 0 ? logs.reduce((s, l) => s + l.durationMs, 0) / total : 0;
    const p95 = total > 0 ? [...logs].sort((a, b) => b.durationMs - a.durationMs)[Math.floor(total * 0.05)]?.durationMs ?? 0 : 0;
    return { total, errors, avgDuration, p95 };
  }, [logs]);

  async function clearLogs() {
    setConfirmClear(true);
  }

  async function doClearLogs() {
    setConfirmClear(false);
    try {
      await api.delete("/admin/v1/request-logs");
      await refresh();
    } catch {
      // ignore
    }
  }

  function exportLogs(format: "csv" | "json") {
    const params = new URLSearchParams();
    if (filter === "success") params.set("statusFamily", "2xx");
    else if (filter === "error") params.set("statusFamily", "5xx");
    if (search.trim()) params.set("route", search.trim());
    if (format === "csv") {
      params.set("format", "csv");
      window.open(`/admin/v1/request-logs?${params.toString()}`, "_blank");
    } else {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `request-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="rlPage">
      <div className="rlHeader">
        <div>
          <h2>{t("rl.title")}</h2>
          <p>{t("rl.subtitle")}</p>
        </div>
        <button className="ghostButton" onClick={() => void clearLogs()} title={t("rl.clearLogs")}>
          <Trash2 size={14} /> {t("rl.clearLogs")}
        </button>
        <button className="ghostButton" onClick={() => exportLogs("csv")} title={t("rl.exportCsv")}>
          <Download size={14} /> CSV
        </button>
        <button className="ghostButton" onClick={() => exportLogs("json")} title={t("rl.exportJson")}>
          <Download size={14} /> JSON
        </button>
      </div>

      {/* Stats row */}
      <div className="rlStats">
        <div className="rlStatCard">
          <span className="rlStatValue">{stats.total}</span>
          <span className="rlStatLabel">{t("rl.totalRequests")}</span>
        </div>
        <div className="rlStatCard">
          <span className="rlStatValue rlStatError">{stats.errors}</span>
          <span className="rlStatLabel">{t("rl.errors")}</span>
        </div>
        <div className="rlStatCard">
          <span className="rlStatValue">{stats.avgDuration.toFixed(0)}ms</span>
          <span className="rlStatLabel">{t("rl.avgDuration")}</span>
        </div>
        <div className="rlStatCard">
          <span className="rlStatValue">{stats.p95.toFixed(0)}ms</span>
          <span className="rlStatLabel">{t("rl.p95")}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="rlFilters">
        <div className="segmentedControl">
          <button className={`segmentedItem ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>{t("rl.all")}</button>
          <button className={`segmentedItem ${filter === "success" ? "active" : ""}`} onClick={() => setFilter("success")}>{t("rl.success")}</button>
          <button className={`segmentedItem ${filter === "error" ? "active" : ""}`} onClick={() => setFilter("error")}>{t("rl.errorsFilter")}</button>
        </div>
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 12 }}>
          <option value="all">All methods</option>
          {allMethods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={tokenFilter}
          onChange={(e) => setTokenFilter(e.target.value)}
          style={{ padding: "4px 8px", fontSize: 12, maxWidth: 180 }}
          title="Filter by API key"
        >
          <option value="all">All keys</option>
          {apiKeys.map((k) => (
            <option key={k.id} value={k.keyHash}>
              {k.owner ?? k.id} ({k.keyHash.slice(0, 8)})
            </option>
          ))}
        </select>
        <input
          className="rlSearchInput"
          type="text"
          placeholder={t("rl.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="ghostButton"
            onClick={() => setShowColumnMenu((v) => !v)}
            style={{ fontSize: 12, padding: "4px 8px" }}
          >
            Columns
          </button>
          {showColumnMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: 8,
                zIndex: 50,
                minWidth: 140,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              }}
            >
              {(Object.keys(visibleCols) as Array<keyof typeof visibleCols>).map((col) => (
                <label key={col} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={visibleCols[col]}
                    onChange={(e) => setVisibleCols({ ...visibleCols, [col]: e.target.checked })}
                  />
                  {col}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="rlFilterCount">{filtered.length} {t("rl.results")}</span>
      </div>

      {/* Log list */}
      <div className="rlList">
        {paginated.length === 0 ? (
          <div className="rlEmpty">
            <ScrollText size={24} />
            <p>{t("rl.noRequests")}</p>
          </div>
        ) : (
          paginated.map((log) => (
            <div key={log.id} className="rlItem">
              <div className="rlItemLeft">
                {visibleCols.method && (
                  <span className={`rlMethod rlMethod--${log.method.toLowerCase()}`}>{log.method}</span>
                )}
                {visibleCols.route && <span className="rlRoute">{log.route}</span>}
                {visibleCols.status && (
                  <span className={`rlStatus rlStatus--${log.statusCode < 400 ? "ok" : log.statusCode < 500 ? "warn" : "err"}`}>
                    {log.statusCode}
                  </span>
                )}
              </div>
              <div className="rlItemRight">
                {visibleCols.duration && <span className="rlDuration">{log.durationMs.toFixed(1)}ms</span>}
                {visibleCols.time && <span className="rlTime">{new Date(log.createdAt).toLocaleTimeString()}</span>}
                {visibleCols.actor && log.apiKeyHash && <code className="rlActor">{log.apiKeyHash.slice(0, 8)}</code>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="rlPagination">
          <button className="rlPageBtn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("rl.prev")}</button>
          <span className="rlPageInfo">{t("rl.page")} {page} {t("rl.of")} {totalPages}</span>
          <button className="rlPageBtn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("rl.next")}</button>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title={t("rl.clearLogs") ?? "Clear logs"}
          message={t("rl.clearConfirm") ?? "Clear all request logs?"}
          confirmLabel={t("rl.clearLogs") ?? "Clear"}
          cancelLabel={t("common.cancel") ?? "Cancel"}
          onConfirm={() => void doClearLogs()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

function AuditLogs({ logs }: { logs: AuditLog[] }) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [targetFilter, setTargetFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"all" | "1h" | "24h" | "7d" | "30d">("all");

  const allActions = useMemo(() => {
    const types = new Set<string>();
    for (const l of logs) {
      // Group by family: api_key.create / api_key.update -> api_key
      const family = l.action.split(".")[0];
      types.add(family);
    }
    return Array.from(types).sort();
  }, [logs]);

  const allTargets = useMemo(() => {
    const types = new Set<string>();
    for (const l of logs) {
      if (l.targetType) types.add(l.targetType);
    }
    return Array.from(types).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff: number | null = (() => {
      if (dateRange === "all") return null;
      const ms = { "1h": 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 }[dateRange];
      return Date.now() - ms;
    })();
    return logs.filter((l) => {
      if (q) {
        const hit =
          l.action.toLowerCase().includes(q) ||
          (l.targetType ?? "").toLowerCase().includes(q) ||
          (l.targetId ?? "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (actionFilter !== "all") {
        if (!l.action.startsWith(actionFilter + ".") && l.action !== actionFilter) return false;
      }
      if (targetFilter !== "all" && l.targetType !== targetFilter) return false;
      if (cutoff !== null) {
        const ts = new Date(l.createdAt).getTime();
        if (Number.isFinite(ts) && ts < cutoff) return false;
      }
      return true;
    });
  }, [logs, search, actionFilter, targetFilter, dateRange]);

  const actionIcons: Record<string, typeof Activity> = {
    create: Plus,
    delete: Trash2,
    update: RefreshCw,
    login: Lock,
    publish: BookOpen,
  };

  function getActionIcon(action: string) {
    const key = Object.keys(actionIcons).find((k) => action.toLowerCase().includes(k));
    return key ? actionIcons[key] : Activity;
  }

  function getActionColor(action: string): string {
    if (action.toLowerCase().includes("delete")) return "var(--color-danger)";
    if (action.toLowerCase().includes("create")) return "var(--color-success)";
    if (action.toLowerCase().includes("update") || action.toLowerCase().includes("publish")) return "var(--color-primary)";
    return "var(--color-text-muted)";
  }

  return (
    <div className="alPage">
      <div className="alHeader">
        <div>
          <h2>{t("al.title")}</h2>
          <p>{t("al.subtitle")}</p>
        </div>
        <span className="alCount">{filtered.length} / {logs.length} {t("al.events")}</span>
      </div>

      <div className="alFilters" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="rlSearchInput"
          type="text"
          placeholder={t("al.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 200px" }}
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="all">All actions</option>
          {allActions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
          <option value="all">All targets</option>
          {allTargets.map((tt) => (
            <option key={tt} value={tt}>{tt}</option>
          ))}
        </select>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as typeof dateRange)}>
          <option value="all">All time</option>
          <option value="1h">Last 1h</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
        </select>
      </div>

      <div className="alTimeline">
        {filtered.length === 0 ? (
          <div className="rlEmpty">
            <ListChecks size={24} />
            <p>{t("al.noEvents")}</p>
          </div>
        ) : (
          filtered.map((log) => {
            const Icon = getActionIcon(log.action);
            return (
              <div key={log.id} className="alItem">
                <div className="alItemIcon" style={{ color: getActionColor(log.action) }}>
                  <Icon size={16} />
                </div>
                <div className="alItemBody">
                  <div className="alItemMain">
                    <strong className="alAction">{log.action}</strong>
                    {log.targetType && (
                      <span className="alTarget">
                        {log.targetType}{log.targetId ? `:${log.targetId}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="alItemMeta">
                    <span className="alTime">{new Date(log.createdAt).toLocaleString()}</span>
                    {log.actorKeyHash && <code className="alActor">{log.actorKeyHash.slice(0, 8)}…</code>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SettingsPage({ api }: { api: ReturnType<typeof createApiClient> }) {
  const { t } = useLang();
  const [current, setCurrent] = useState<Record<string, unknown>>({});
  const [revisions, setRevisions] = useState<ConfigRevision[]>([]);
  const [draft, setDraft] = useState("{\n  \"routingMode\": \"default\"\n}");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "rateLimit" | "webhooks" | "config" | "revisions">("general");
  const [runtimeSettings, setRuntimeSettings] = useState<{ requestQueue: boolean; autoPersist: boolean; circuitBreaker: boolean }>({
    requestQueue: false,
    autoPersist: true,
    circuitBreaker: true
  });
  const [changePwModal, setChangePwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [pendingRollback, setPendingRollback] = useState<ConfigRevision | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    const [currentConfig, revisionList] = await Promise.all([
      api.get<{ data: Record<string, unknown> }>("/admin/v1/config/current"),
      api.getList<ConfigRevision>("/admin/v1/config/revisions")
    ]);
    setCurrent(currentConfig.data);
    setRevisions(revisionList);
    setDraft(JSON.stringify(currentConfig.data, null, 2));

    // Load runtime settings
    try {
      const runtime = await api.get<Record<string, unknown>>("/admin/v1/settings/runtime");
      setRuntimeSettings({
        requestQueue: (runtime as { requestQueueEnabled?: boolean }).requestQueueEnabled === true,
        autoPersist: (runtime as { autoPeristEnabled?: boolean }).autoPeristEnabled !== false,
        circuitBreaker: (runtime as { circuitBreakerEnabled?: boolean }).circuitBreakerEnabled !== false
      });
    } catch {
      // Endpoint may not exist yet, use defaults
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleRuntime(key: "requestQueue" | "autoPersist" | "circuitBreaker") {
    const prev = { ...runtimeSettings };
    const updated = { ...runtimeSettings, [key]: !runtimeSettings[key] };
    setRuntimeSettings(updated);
    try {
      // Backend only supports toggling requestQueueEnabled
      await api.put("/admin/v1/settings/runtime", {
        requestQueueEnabled: updated.requestQueue
      });
      setMessage({ type: "success", text: `${key} ${updated[key] ? "enabled" : "disabled"}` });
    } catch {
      setRuntimeSettings(prev); // revert
      setMessage({ type: "error", text: "Failed to update setting" });
    }
  }

  async function validate() {
    try {
      await api.post("/admin/v1/config/validate", { config: JSON.parse(draft) });
      setMessage({ type: "success", text: "Configuration is valid ✓" });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Validation failed" });
    }
  }

  async function publish() {
    try {
      const revision = await api.post<ConfigRevision>("/admin/v1/config/publish", {
        config: JSON.parse(draft)
      });
      setMessage({ type: "success", text: `Published revision ${revision.version}` });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Publish failed" });
    }
  }

  async function rollback(revision: ConfigRevision) {
    setPendingRollback(revision);
  }

  async function doRollback() {
    const revision = pendingRollback;
    if (!revision) return;
    setPendingRollback(null);
    try {
      const next = await api.post<ConfigRevision>(`/admin/v1/config/revisions/${revision.id}/rollback`, {});
      setMessage({ type: "success", text: `Rolled back → revision ${next.version}` });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Rollback failed" });
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwForm.newPw.length < 4) {
      setMessage({ type: "error", text: "Password must be at least 4 characters" });
      return;
    }
    if (pwForm.newPw !== pwForm.confirm) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }
    try {
      await api.post("/admin/v1/settings/change-password", {
        currentPassword: pwForm.current || (window.sessionStorage.getItem("gateway.adminKey") ?? ""),
        newPassword: pwForm.newPw
      });
      setMessage({ type: "success", text: "Password changed successfully" });
      window.sessionStorage.setItem("gateway.adminKey", pwForm.newPw);
      setChangePwModal(false);
      setPwForm({ current: "", newPw: "", confirm: "" });
    } catch {
      setMessage({ type: "error", text: "Failed to change password" });
    }
  }

  async function handleResetPassword() {
    if (!window.confirm(t("settings.resetPasswordConfirm"))) return;
    try {
      const res = await api.post<{ success: boolean; defaultPassword?: string }>(
        "/admin/v1/settings/reset-password",
        {}
      );
      const def = res?.defaultPassword ?? "admin";
      window.sessionStorage.setItem("gateway.adminKey", def);
      setMessage({ type: "success", text: t("settings.resetPasswordDone").replace("{pw}", def) });
    } catch {
      setMessage({ type: "error", text: "Failed to reset password" });
    }
  }

  return (
    <div className="stack">
      <div className="settingsHeader">
        <h2>{t("settings.title")}</h2>
        <p>{t("settings.subtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="segmentedControl" style={{ alignSelf: "flex-start" }}>
        <button className={`segmentedItem ${activeTab === "general" ? "active" : ""}`} onClick={() => setActiveTab("general")}>{t("settings.general")}</button>
        <button className={`segmentedItem ${activeTab === "rateLimit" ? "active" : ""}`} onClick={() => setActiveTab("rateLimit")}>Rate limits</button>
        <button className={`segmentedItem ${activeTab === "webhooks" ? "active" : ""}`} onClick={() => setActiveTab("webhooks")}>Webhooks</button>
        <button className={`segmentedItem ${activeTab === "config" ? "active" : ""}`} onClick={() => setActiveTab("config")}>{t("settings.configuration")}</button>
        <button className={`segmentedItem ${activeTab === "revisions" ? "active" : ""}`} onClick={() => setActiveTab("revisions")}>{t("settings.revisions")} ({revisions.length})</button>
      </div>

      {message && (
        <div className={message.type === "success" ? "endpointNewKey" : "endpointError"} style={{ padding: "10px 14px" }}>
          {message.text}
          <button className="iconButton" style={{ marginLeft: "auto", width: "24px", height: "24px" }} onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      {activeTab === "general" && (
        <div className="settingsCards">
          <article className="endpointCard">
            <header className="endpointCardHeader">
              <Shield size={18} />
              <h2>{t("settings.security")}</h2>
            </header>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.adminAuth")}</strong>
                <span>{t("settings.adminAuthDesc")}</span>
              </div>
              <span className="settingsBadge settingsBadge--active">{t("common.active")}</span>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.encryption")}</strong>
                <span>{t("settings.encryptionDesc")}</span>
              </div>
              <span className="settingsBadge settingsBadge--active">{t("common.active")}</span>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.redaction")}</strong>
                <span>{t("settings.redactionDesc")}</span>
              </div>
              <span className="settingsBadge settingsBadge--active">{t("common.active")}</span>
            </div>
          </article>

          <article className="endpointCard">
            <header className="endpointCardHeader">
              <Activity size={18} />
              <h2>{t("settings.runtime")}</h2>
            </header>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.requestQueue")}</strong>
                <span>{t("settings.requestQueueDesc")}</span>
              </div>
              <label className="toggleSwitch">
                <input type="checkbox" checked={runtimeSettings.requestQueue} onChange={() => void toggleRuntime("requestQueue")} />
                <span className="toggleSlider" />
              </label>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.autoPersist")}</strong>
                <span>{t("settings.autoPersistDesc")}</span>
              </div>
              <label className="toggleSwitch">
                <input type="checkbox" checked={runtimeSettings.autoPersist} onChange={() => void toggleRuntime("autoPersist")} />
                <span className="toggleSlider" />
              </label>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.circuitBreaker")}</strong>
                <span>{t("settings.circuitBreakerDesc")}</span>
              </div>
              <label className="toggleSwitch">
                <input type="checkbox" checked={runtimeSettings.circuitBreaker} onChange={() => void toggleRuntime("circuitBreaker")} />
                <span className="toggleSlider" />
              </label>
            </div>
          </article>

          {/* Actions */}
          <article className="endpointCard">
            <header className="endpointCardHeader">
              <Settings size={18} />
              <h2>{t("settings.actions")}</h2>
            </header>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.changePassword")}</strong>
                <span>{t("settings.changePasswordDesc")}</span>
              </div>
              <button className="endpointKeyBtn" onClick={() => setChangePwModal(true)}>
                <Lock size={14} /> {t("settings.changePassword")}
              </button>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.resetPassword")}</strong>
                <span>{t("settings.resetPasswordDesc")}</span>
              </div>
              <button className="endpointKeyBtn" onClick={() => void handleResetPassword()}>
                <Lock size={14} /> {t("settings.resetPassword")}
              </button>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.exportData")}</strong>
                <span>{t("settings.exportDataDesc")}</span>
              </div>
              <button className="endpointKeyBtn" onClick={() => {
                void api.get<Record<string, unknown>>("/admin/v1/settings/export").then((data) => {
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `gateway-export-${new Date().toISOString().slice(0,10)}.json`;
                  a.click(); URL.revokeObjectURL(url);
                  showToast("success", "Data exported");
                });
              }}>
                <ExternalLink size={14} /> Export
              </button>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.importData")}</strong>
                <span>{t("settings.importDataDesc")}</span>
              </div>
              <button className="endpointKeyBtn" onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".json";
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    try {
                      const data = JSON.parse(reader.result as string);
                      void api.post<{ imported: number }>("/admin/v1/settings/import", data).then((res) => {
                        showToast("success", `Imported ${(res as { imported?: number }).imported ?? 0} items`);
                      }).catch(() => showToast("error", "Import failed"));
                    } catch {
                      showToast("error", "Invalid JSON file");
                    }
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}>
                <Database size={14} /> Import
              </button>
            </div>
            <div className="settingsRow">
              <div>
                <strong>{t("settings.resetGateway")}</strong>
                <span>{t("settings.resetGatewayDesc")}</span>
              </div>
              <button className="endpointKeyBtn settingsResetBtn" onClick={() => setConfirmReset(true)}>
                <Trash2 size={14} /> Reset
              </button>
            </div>
          </article>
        </div>
      )}

      {/* Phase 28 — Rate limits tab */}
      {activeTab === "rateLimit" && (
        <div className="settingsGrid">
          <article className="endpointCard">
            <header className="endpointCardHeader">
              <Gauge size={18} />
              <h2>Default per-key rate limits</h2>
            </header>
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                These are the gateway defaults. Per-key limits set on individual API keys override these.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: 0.5 }}>Requests / minute</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                    {String((current.internalRateLimitPerMinute as number | undefined) ?? "—")}
                  </div>
                </div>
                <div style={{ padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: 0.5 }}>Daily request quota</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                    {String((current.internalDailyRequestQuota as number | undefined) ?? "—")}
                  </div>
                </div>
                <div style={{ padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: 0.5 }}>Daily token quota</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                    {String((current.internalDailyTokenQuota as number | undefined) ?? "—")}
                  </div>
                </div>
              </div>
              <small style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                Defaults are loaded from environment variables: <code>RATE_LIMIT_PER_MIN</code>, <code>DAILY_REQUEST_QUOTA</code>, <code>DAILY_TOKEN_QUOTA</code>. Restart the gateway to apply changes.
              </small>
            </div>
          </article>

          <article className="endpointCard">
            <header className="endpointCardHeader">
              <Shield size={18} />
              <h2>Rate limit responses</h2>
            </header>
            <div style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.6 }}>
              <p>
                When a key exceeds its limits, the gateway responds with:
              </p>
              <ul style={{ marginLeft: 20, marginTop: 8 }}>
                <li><code>HTTP 429</code> with <code>code: rate_limit_exceeded</code></li>
                <li><code>code: token_quota_exhausted</code> for daily token limit</li>
                <li><code>code: daily_quota_exceeded</code> for daily request count</li>
                <li><code>HTTP 402 balance_exhausted</code> when balance reaches 0</li>
                <li><code>HTTP 401 token_expired</code> when expiresAt has passed</li>
              </ul>
            </div>
          </article>
        </div>
      )}

      {/* Phase 28 — Webhooks tab */}
      {activeTab === "webhooks" && (
        <div className="settingsGrid">
          <WebhookConfigCard api={api} />
        </div>
      )}

      {activeTab === "config" && (
        <article className="endpointCard">
          <header className="endpointCardHeader">
            <Settings size={18} />
            <h2>Live Configuration</h2>
          </header>
          <textarea
            className="settingsEditor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="settingsEditorActions">
            <button className="ghostButton" onClick={() => void validate()}>Validate</button>
            <button className="primaryButton" onClick={() => void publish()}>Publish</button>
          </div>
        </article>
      )}

      {activeTab === "revisions" && (
        <article className="endpointCard">
          <header className="endpointCardHeader">
            <BookOpen size={18} />
            <h2>Config Revisions</h2>
          </header>
          {revisions.length === 0 ? (
            <p style={{ color: "var(--color-text-subtle)", fontSize: "13px" }}>No revisions published yet.</p>
          ) : (
            <div className="settingsRevisionList">
              {revisions.map((rev) => (
                <div key={rev.id} className="settingsRevisionItem">
                  <div className="settingsRevisionMeta">
                    <strong>v{rev.version}</strong>
                    <span>{new Date(rev.publishedAt).toLocaleString()}</span>
                    {rev.actorKeyHash && <code>{rev.actorKeyHash.slice(0, 8)}…</code>}
                  </div>
                  <button className="endpointKeyBtn" onClick={() => void rollback(rev)}>Rollback</button>
                </div>
              ))}
            </div>
          )}
        </article>
      )}

      {/* Change Password Modal */}
      {changePwModal && (
        <div className="modalOverlay" onClick={() => setChangePwModal(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>Change Password</h3>
              <button className="iconButton" onClick={() => setChangePwModal(false)}><X size={18} /></button>
            </div>
            <form className="modalBody" onSubmit={(e) => void handleChangePassword(e)}>
              <label className="pgField">
                <span>Current Password</span>
                <input type="password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} placeholder="Leave blank to use stored key" />
              </label>
              <label className="pgField">
                <span>New Password</span>
                <input type="password" value={pwForm.newPw} onChange={(e) => setPwForm({ ...pwForm, newPw: e.target.value })} placeholder="Min 4 characters" required />
              </label>
              <label className="pgField">
                <span>Confirm Password</span>
                <input type="password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} placeholder="Re-enter new password" required />
              </label>
              <div className="modalActions">
                <button type="button" className="ghostButton" onClick={() => setChangePwModal(false)}>Cancel</button>
                <button type="submit" className="primaryButton">Update Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {pendingRollback && (
        <ConfirmDialog
          title="Rollback configuration"
          message={`Rollback to revision ${pendingRollback.version}?`}
          confirmLabel="Rollback"
          variant="default"
          onConfirm={() => void doRollback()}
          onCancel={() => setPendingRollback(null)}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Reset gateway"
          message="Reset gateway? This clears usage and request logs."
          confirmLabel="Reset"
          onConfirm={() => {
            setConfirmReset(false);
            void api.post("/admin/v1/settings/reset", { confirm: "RESET" }).then(() => {
              setMessage({ type: "success", text: "Gateway reset complete" });
            }).catch(() => setMessage({ type: "error", text: "Reset failed" }));
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}


function DocsPage() {
  const { lang } = useLang();
  const [activeSection, setActiveSection] = useState("getting-started");

  const sections = lang === "vi" ? [
    { id: "faq", label: "FAQ" },
    { id: "getting-started", label: "Bắt đầu nhanh" },
    { id: "architecture", label: "Kiến trúc hệ thống" },
    { id: "providers", label: "Providers & Accounts" },
    { id: "models", label: "Models & Aliases" },
    { id: "routes", label: "Routes (Tuyến fallback)" },
    { id: "endpoint", label: "Endpoint & API Keys" },
    { id: "teams", label: "Teams & Giới hạn" },
    { id: "spending", label: "💰 Hạn mức chi tiêu" },
    { id: "cache", label: "⚡ Response Cache" },
    { id: "observability", label: "📊 Giám sát & Metrics" },
    { id: "token-saver", label: "Token Saver" },
    { id: "playground", label: "Playground" },
    { id: "webhooks", label: "Webhook thông báo" },
    { id: "media-providers", label: "🎨 Media Providers" },
    { id: "proxy-pools", label: "🔀 Proxy Pools" },
    { id: "settings", label: "Cài đặt hệ thống" },
    { id: "shortcuts", label: "Phím tắt" },
    { id: "api", label: "Tham chiếu API" }
  ] : [
    { id: "faq", label: "FAQ" },
    { id: "getting-started", label: "Quick Start" },
    { id: "architecture", label: "System Architecture" },
    { id: "providers", label: "Providers & Accounts" },
    { id: "models", label: "Models & Aliases" },
    { id: "routes", label: "Routes (Fallback Chains)" },
    { id: "endpoint", label: "Endpoint & API Keys" },
    { id: "teams", label: "Teams & Limits" },
    { id: "spending", label: "💰 Spending Caps" },
    { id: "cache", label: "⚡ Response Cache" },
    { id: "observability", label: "📊 Observability & Metrics" },
    { id: "token-saver", label: "Token Saver" },
    { id: "playground", label: "Playground" },
    { id: "webhooks", label: "Webhook Notifications" },
    { id: "media-providers", label: "🎨 Media Providers" },
    { id: "proxy-pools", label: "🔀 Proxy Pools" },
    { id: "settings", label: "System Settings" },
    { id: "shortcuts", label: "Keyboard Shortcuts" },
    { id: "api", label: "API Reference" }
  ];

  return (
    <div className="docsPage">
      <div className="docsLayout">
        <nav className="docsSidebar">
          <h3>{lang === "vi" ? "Tài liệu hướng dẫn" : "Documentation"}</h3>
          {sections.map((s) => (
            <button
              key={s.id}
              className={`docsNavItem ${activeSection === s.id ? "active" : ""}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <article className="docsContent">

          {activeSection === "faq" && (
            <div className="docsSection">
              <FaqPanel />
            </div>
          )}

          {lang === "vi" && activeSection === "getting-started" && (
            <div className="docsSection">
              <h2>Bắt đầu nhanh</h2>
              <p>X-Router là một reverse proxy thông minh đứng giữa IDE của bạn và các nhà cung cấp AI (Kiro, Windsurf, OpenAI...). Thay vì mỗi IDE kết nối trực tiếp đến provider, tất cả đều đi qua gateway duy nhất này.</p>

              <h3>Gateway giải quyết vấn đề gì?</h3>
              <ul>
                <li><strong>Gộp nhiều tài khoản</strong> — Bạn có 3 account Kiro? Gateway tự động phân phối request đều giữa chúng, tăng gấp 3 throughput.</li>
                <li><strong>Tự động fallback</strong> — Kiro lỗi? Gateway chuyển sang Windsurf ngay lập tức, IDE không biết gì.</li>
                <li><strong>Một endpoint cho tất cả</strong> — Dù bạn dùng Cursor, Cline, Claude Code hay Aider, chỉ cần cấu hình 1 URL duy nhất.</li>
                <li><strong>Giám sát tập trung</strong> — Xem ai dùng bao nhiêu token, model nào tốn nhất, request nào lỗi.</li>
                <li><strong>Tiết kiệm token</strong> — Tự động nén tool output và system prompt trước khi gửi đến provider.</li>
              </ul>

              <h3>Thiết lập trong 4 bước</h3>
              <ol>
                <li><strong>Thêm Provider</strong> — Vào trang Providers, chọn Kiro hoặc Windsurf, thêm account bằng refresh token hoặc bearer token.</li>
                <li><strong>Lấy Endpoint URL</strong> — Vào trang Endpoint, copy URL hiển thị.</li>
                <li><strong>Tạo API Key</strong> — Vẫn ở trang Endpoint, bấm Create Key, copy key vừa tạo (chỉ hiện 1 lần).</li>
                <li><strong>Cấu hình IDE</strong> — Vào trang CLI Tools, chọn IDE của bạn, làm theo hướng dẫn.</li>
              </ol>

              <h3>Luồng hoạt động</h3>
              <pre className="docsCode">{`IDE (Cursor, Cline, Claude Code, Aider...)
  │
  │  POST /v1/chat/completions
  │  model: "coding", messages: [...]
  ▼
┌─────────────────────────────────┐
│  AI Gateway (localhost:3100)     │
│                                  │
│  1. Xác thực API key            │
│  2. Kiểm tra rate limit         │
│  3. Resolve model → provider    │
│  4. Chọn account (least busy)   │
│  5. Nén token (nếu bật)        │
│  6. Gửi đến provider            │
└─────────────────────────────────┘
  │
  ▼
Provider (Kiro / Windsurf / OpenAI)
  │
  │  Stream response
  ▼
IDE ← nhận response như bình thường`}</pre>
            </div>
          )}

          {lang === "en" && activeSection === "getting-started" && (
            <div className="docsSection">
              <h2>Quick Start</h2>
              <p>X-Router is a smart reverse proxy that sits between your IDE and AI providers (Kiro, Windsurf, OpenAI...). Instead of each IDE connecting directly to a provider, all traffic goes through this single gateway.</p>

              <h3>What problems does the Gateway solve?</h3>
              <ul>
                <li><strong>Pool multiple accounts</strong> — Have 3 Kiro accounts? The gateway automatically distributes requests evenly across them, tripling throughput.</li>
                <li><strong>Automatic fallback</strong> — Kiro is down? The gateway switches to Windsurf instantly, the IDE doesn't notice.</li>
                <li><strong>One endpoint for everything</strong> — Whether you use Cursor, Cline, Claude Code, or Aider, just configure a single URL.</li>
                <li><strong>Centralized monitoring</strong> — See who uses how many tokens, which model costs the most, which requests fail.</li>
                <li><strong>Token savings</strong> — Automatically compresses tool output and system prompts before sending to the provider.</li>
              </ul>

              <h3>Setup in 4 steps</h3>
              <ol>
                <li><strong>Add a Provider</strong> — Go to the Providers page, select Kiro or Windsurf, add an account using a refresh token or bearer token.</li>
                <li><strong>Get the Endpoint URL</strong> — Go to the Endpoint page, copy the displayed URL.</li>
                <li><strong>Create an API Key</strong> — Still on the Endpoint page, click Create Key, copy the generated key (shown only once).</li>
                <li><strong>Configure your IDE</strong> — Go to the CLI Tools page, select your IDE, follow the instructions.</li>
              </ol>

              <h3>Request flow</h3>
              <pre className="docsCode">{`IDE (Cursor, Cline, Claude Code, Aider...)
  │
  │  POST /v1/chat/completions
  │  model: "coding", messages: [...]
  ▼
┌─────────────────────────────────┐
│  AI Gateway (localhost:3100)     │
│                                  │
│  1. Authenticate API key        │
│  2. Check rate limit            │
│  3. Resolve model → provider    │
│  4. Pick account (least busy)   │
│  5. Compress tokens (if on)     │
│  6. Send to provider            │
└─────────────────────────────────┘
  │
  ▼
Provider (Kiro / Windsurf / OpenAI)
  │
  │  Stream response
  ▼
IDE ← receives response as normal`}</pre>
            </div>
          )}

          {lang === "vi" && activeSection === "architecture" && (
            <div className="docsSection">
              <h2>Kiến trúc hệ thống</h2>
              <p>Gateway được thiết kế theo kiến trúc module, mỗi thành phần có trách nhiệm riêng biệt.</p>

              <h3>Các thành phần chính</h3>
              <table className="docsTable">
                <thead><tr><th>Thành phần</th><th>Chức năng</th></tr></thead>
                <tbody>
                  <tr><td><strong>Provider Adapter</strong></td><td>Kết nối đến từng loại provider (Kiro, Windsurf). Mỗi provider có adapter riêng xử lý authentication và protocol.</td></tr>
                  <tr><td><strong>Account Pool</strong></td><td>Quản lý nhiều account cho mỗi provider. Tự động chọn account phù hợp nhất cho mỗi request.</td></tr>
                  <tr><td><strong>Model Registry</strong></td><td>Ánh xạ tên model công khai (IDE gọi) sang tên model thực (provider nhận). Ví dụ: "coding" → "claude-sonnet-4.5"</td></tr>
                  <tr><td><strong>Routing Engine</strong></td><td>Quyết định request đi đến provider nào. Hỗ trợ fallback chain khi provider lỗi.</td></tr>
                  <tr><td><strong>Circuit Breaker</strong></td><td>Theo dõi lỗi liên tục. Nếu 1 provider lỗi quá nhiều, tạm ngắt để tránh gửi thêm request vô ích.</td></tr>
                  <tr><td><strong>Rate Limiter</strong></td><td>Giới hạn số request/phút và request/ngày cho mỗi API key hoặc team.</td></tr>
                  <tr><td><strong>Token Saver</strong></td><td>Nén nội dung trước khi gửi đến provider để tiết kiệm token và chi phí.</td></tr>
                  <tr><td><strong>Secret Service</strong></td><td>Mã hóa credentials (AES-256-GCM). Token và key không bao giờ lưu dạng plaintext.</td></tr>
                </tbody>
              </table>

              <h3>Chiến lược chọn Account</h3>
              <ul>
                <li><strong>Least Busy (mặc định)</strong> — Chọn account đang có ít request nhất. Phân phối tải đều nhất.</li>
                <li><strong>Round Robin</strong> — Xoay vòng lần lượt qua từng account. Bật trong phần Connections của provider.</li>
              </ul>

              <h3>Circuit Breaker hoạt động thế nào?</h3>
              <ol>
                <li>Account hoạt động bình thường → trạng thái <strong>Closed</strong> (cho phép request)</li>
                <li>Account lỗi liên tục N lần → chuyển sang <strong>Open</strong> (chặn request)</li>
                <li>Sau thời gian cooldown → chuyển sang <strong>Half-Open</strong> (thử 1 request)</li>
                <li>Request thành công → quay lại Closed. Thất bại → quay lại Open.</li>
              </ol>
            </div>
          )}

          {lang === "en" && activeSection === "architecture" && (
            <div className="docsSection">
              <h2>System Architecture</h2>
              <p>The gateway is designed with a modular architecture where each component has a distinct responsibility.</p>

              <h3>Core Components</h3>
              <table className="docsTable">
                <thead><tr><th>Component</th><th>Function</th></tr></thead>
                <tbody>
                  <tr><td><strong>Provider Adapter</strong></td><td>Connects to each provider type (Kiro, Windsurf). Each provider has its own adapter handling authentication and protocol.</td></tr>
                  <tr><td><strong>Account Pool</strong></td><td>Manages multiple accounts per provider. Automatically selects the best account for each request.</td></tr>
                  <tr><td><strong>Model Registry</strong></td><td>Maps public model names (called by IDE) to actual provider model names. Example: "coding" → "claude-sonnet-4.5"</td></tr>
                  <tr><td><strong>Routing Engine</strong></td><td>Decides which provider receives the request. Supports fallback chains when a provider fails.</td></tr>
                  <tr><td><strong>Circuit Breaker</strong></td><td>Tracks consecutive failures. If a provider fails too many times, temporarily disconnects to avoid sending more useless requests.</td></tr>
                  <tr><td><strong>Rate Limiter</strong></td><td>Limits requests/minute and requests/day per API key or team.</td></tr>
                  <tr><td><strong>Token Saver</strong></td><td>Compresses content before sending to the provider to save tokens and costs.</td></tr>
                  <tr><td><strong>Secret Service</strong></td><td>Encrypts credentials (AES-256-GCM). Tokens and keys are never stored in plaintext.</td></tr>
                </tbody>
              </table>

              <h3>Account Selection Strategy</h3>
              <ul>
                <li><strong>Least Busy (default)</strong> — Selects the account with the fewest active requests. Most even load distribution.</li>
                <li><strong>Round Robin</strong> — Cycles through accounts in order. Enable in the provider's Connections section.</li>
              </ul>

              <h3>How does the Circuit Breaker work?</h3>
              <ol>
                <li>Account operating normally → state is <strong>Closed</strong> (allows requests)</li>
                <li>Account fails N consecutive times → switches to <strong>Open</strong> (blocks requests)</li>
                <li>After cooldown period → switches to <strong>Half-Open</strong> (tries 1 request)</li>
                <li>Request succeeds → back to Closed. Fails → back to Open.</li>
              </ol>
            </div>
          )}

          {lang === "vi" && activeSection === "providers" && (
            <div className="docsSection">
              <h2>Providers & Accounts</h2>
              <p>Provider là dịch vụ AI bên ngoài mà gateway kết nối đến. Mỗi provider có thể có nhiều account để tăng throughput và độ tin cậy.</p>

              <h3>Danh sách Provider hỗ trợ</h3>
              <table className="docsTable">
                <thead><tr><th>Provider</th><th>Phương thức xác thực</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  <tr><td><strong>Kiro AI</strong></td><td>Refresh Token, OAuth, Bearer Token</td><td>✅ Hoạt động</td><td>Hỗ trợ auto-refresh token khi hết hạn</td></tr>
                  <tr><td><strong>Windsurf</strong></td><td>Bearer Token, Local gRPC</td><td>✅ Hoạt động</td><td>Kết nối qua language server local</td></tr>
                  <tr><td><strong>OpenAI</strong></td><td>API Key</td><td>🔜 Sắp có</td><td>Cần API key từ platform.openai.com</td></tr>
                  <tr><td><strong>Anthropic</strong></td><td>API Key</td><td>🔜 Sắp có</td><td>Cần API key từ console.anthropic.com</td></tr>
                  <tr><td><strong>GitHub Copilot</strong></td><td>OAuth</td><td>🔜 Sắp có</td><td>Cần GitHub account có Copilot subscription</td></tr>
                </tbody>
              </table>

              <h3>Cách thêm Account mới</h3>
              <ol>
                <li>Vào trang <strong>Providers</strong> từ sidebar (mục Setup)</li>
                <li>Click vào provider bạn muốn (ví dụ: Kiro AI)</li>
                <li>Bấm nút <strong>Add Account</strong> ở phần Connections</li>
                <li>Chọn phương thức xác thực:
                  <ul>
                    <li><strong>Refresh Token</strong> — Lấy từ IDE settings (Kiro: Settings → Developer → Copy Refresh Token)</li>
                    <li><strong>Bearer Token</strong> — Token truy cập hiện tại, sẽ hết hạn sau một thời gian</li>
                    <li><strong>Import Local Session</strong> — Tự động lấy token từ IDE đang chạy trên máy</li>
                  </ul>
                </li>
                <li>Nhập thông tin → bấm Submit</li>
              </ol>

              <h3>Quản lý Account Pool</h3>
              <p>Khi bạn có nhiều account cho cùng 1 provider, gateway tự động phân phối request:</p>
              <ul>
                <li><strong>Bật/Tắt account</strong> — Toggle switch bên phải mỗi account. Account tắt sẽ không nhận request.</li>
                <li><strong>Test account</strong> — Bấm nút Test để kiểm tra account còn hoạt động không.</li>
                <li><strong>Xóa account</strong> — Bấm Delete để xóa vĩnh viễn.</li>
                <li><strong>Round Robin</strong> — Bật toggle Round Robin ở header để xoay vòng đều thay vì chọn account ít bận nhất.</li>
                <li><strong>Refresh Session</strong> — Với Kiro, bấm Refresh để gia hạn token khi sắp hết hạn.</li>
              </ul>

              <h3>Trạng thái Account</h3>
              <table className="docsTable">
                <thead><tr><th>Trạng thái</th><th>Ý nghĩa</th><th>Hành động</th></tr></thead>
                <tbody>
                  <tr><td>🟢 Active</td><td>Hoạt động bình thường, nhận request</td><td>Không cần làm gì</td></tr>
                  <tr><td>🟡 Cooldown</td><td>Đang tạm nghỉ sau lỗi, sẽ tự phục hồi</td><td>Đợi hoặc bấm Reset Circuit Breaker</td></tr>
                  <tr><td>🔴 Disabled</td><td>Đã bị tắt thủ công hoặc lỗi quá nhiều</td><td>Bật lại bằng toggle hoặc kiểm tra credentials</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {lang === "en" && activeSection === "providers" && (
            <div className="docsSection">
              <h2>Providers & Accounts</h2>
              <p>A Provider is an external AI service that the gateway connects to. Each provider can have multiple accounts to increase throughput and reliability.</p>

              <h3>Supported Providers</h3>
              <table className="docsTable">
                <thead><tr><th>Provider</th><th>Authentication Method</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>
                  <tr><td><strong>Kiro AI</strong></td><td>Refresh Token, OAuth, Bearer Token</td><td>✅ Active</td><td>Supports auto-refresh when token expires</td></tr>
                  <tr><td><strong>Windsurf</strong></td><td>Bearer Token, Local gRPC</td><td>✅ Active</td><td>Connects via local language server</td></tr>
                  <tr><td><strong>OpenAI</strong></td><td>API Key</td><td>🔜 Coming soon</td><td>Requires API key from platform.openai.com</td></tr>
                  <tr><td><strong>Anthropic</strong></td><td>API Key</td><td>🔜 Coming soon</td><td>Requires API key from console.anthropic.com</td></tr>
                  <tr><td><strong>GitHub Copilot</strong></td><td>OAuth</td><td>🔜 Coming soon</td><td>Requires GitHub account with Copilot subscription</td></tr>
                </tbody>
              </table>

              <h3>How to add a new Account</h3>
              <ol>
                <li>Go to the <strong>Providers</strong> page from the sidebar (Setup section)</li>
                <li>Click on the provider you want (e.g., Kiro AI)</li>
                <li>Click the <strong>Add Account</strong> button in the Connections section</li>
                <li>Choose the authentication method:
                  <ul>
                    <li><strong>Refresh Token</strong> — Get from IDE settings (Kiro: Settings → Developer → Copy Refresh Token)</li>
                    <li><strong>Bearer Token</strong> — Current access token, will expire after some time</li>
                    <li><strong>Import Local Session</strong> — Automatically retrieves token from the IDE running on your machine</li>
                  </ul>
                </li>
                <li>Enter the information → click Submit</li>
              </ol>

              <h3>Managing the Account Pool</h3>
              <p>When you have multiple accounts for the same provider, the gateway automatically distributes requests:</p>
              <ul>
                <li><strong>Enable/Disable account</strong> — Toggle switch on the right of each account. Disabled accounts won't receive requests.</li>
                <li><strong>Test account</strong> — Click the Test button to check if the account is still working.</li>
                <li><strong>Delete account</strong> — Click Delete to permanently remove.</li>
                <li><strong>Round Robin</strong> — Enable the Round Robin toggle in the header to cycle evenly instead of picking the least busy account.</li>
                <li><strong>Refresh Session</strong> — For Kiro, click Refresh to renew the token before it expires.</li>
              </ul>

              <h3>Account Status</h3>
              <table className="docsTable">
                <thead><tr><th>Status</th><th>Meaning</th><th>Action</th></tr></thead>
                <tbody>
                  <tr><td>🟢 Active</td><td>Operating normally, receiving requests</td><td>No action needed</td></tr>
                  <tr><td>🟡 Cooldown</td><td>Temporarily resting after errors, will self-recover</td><td>Wait or click Reset Circuit Breaker</td></tr>
                  <tr><td>🔴 Disabled</td><td>Manually disabled or too many errors</td><td>Re-enable with toggle or check credentials</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {lang === "vi" && activeSection === "models" && (
            <div className="docsSection">
              <h2>Models & Aliases</h2>
              <p>Model Registry quản lý ánh xạ giữa tên model mà IDE gọi và tên model thực mà provider nhận.</p>

              <h3>Model Mapping là gì?</h3>
              <p>Khi IDE gửi request với <code>model: "kiro-sonnet"</code>, gateway cần biết:</p>
              <ul>
                <li>Gửi đến provider nào? → Kiro</li>
                <li>Tên model thực trên provider là gì? → claude-sonnet-4.5</li>
                <li>Model này hỗ trợ gì? → chat, streaming</li>
              </ul>
              <pre className="docsCode">{`Model Mapping:
┌─────────────────────────────────────────────┐
│ Public Model:  "kiro-sonnet"                │  ← IDE gọi tên này
│ Provider:      kiro                         │  ← gửi đến provider này
│ Upstream:      "claude-sonnet-4.5"          │  ← provider nhận tên này
│ Capabilities:  chat, streaming              │  ← model hỗ trợ gì
│ Enabled:       true                         │  ← có đang hoạt động không
└─────────────────────────────────────────────┘`}</pre>

              <h3>Cách thêm Model mới</h3>
              <ol>
                <li>Vào trang Providers → click provider → phần Models</li>
                <li>Bấm <strong>+ Add Model</strong></li>
                <li>Nhập tên public (IDE sẽ gọi tên này)</li>
                <li>Nhập tên upstream (tên thực trên provider)</li>
                <li>Bấm Test để kiểm tra model có hoạt động không</li>
                <li>Bấm Add Model để lưu</li>
              </ol>

              <h3>Model Aliases</h3>
              <p>Alias cho phép bạn tạo nhiều tên khác nhau trỏ đến cùng 1 model hoặc route. Rất hữu ích khi:</p>
              <ul>
                <li>IDE bắt buộc dùng tên model cụ thể (ví dụ Cursor chỉ cho chọn "gpt-4o")</li>
                <li>Bạn muốn đổi backend model mà không cần sửa config ở tất cả IDE</li>
                <li>Nhiều team dùng tên model khác nhau nhưng cùng route về 1 provider</li>
              </ul>
              <pre className="docsCode">{`Ví dụ Aliases:
  "coding"        → "kiro-sonnet"       (tên ngắn gọn)
  "gpt-4"         → "kiro-sonnet"       (trick IDE chỉ hỗ trợ OpenAI)
  "claude-sonnet" → "kiro-sonnet"       (tương thích tên Anthropic)
  "fast"          → "route-fallback"    (trỏ đến route thay vì model)`}</pre>

              <h3>Cách tạo Alias</h3>
              <ol>
                <li>Vào trang <strong>Routes</strong> từ sidebar</li>
                <li>Cuộn xuống phần <strong>Model Aliases</strong></li>
                <li>Nhập tên alias (ví dụ: <code>coding</code>)</li>
                <li>Nhập target (ví dụ: <code>kiro-sonnet</code>)</li>
                <li>Bấm Add</li>
              </ol>

              <h3>Thứ tự resolve khi nhận request</h3>
              <pre className="docsCode">{`IDE gửi: model = "coding"

Gateway resolve theo thứ tự:
  1. Tìm trong Model Registry → không có "coding"
  2. Tìm trong Routing Profiles → không có "coding"  
  3. Tìm trong Aliases → có! "coding" → "kiro-sonnet"
  4. Resolve lại "kiro-sonnet" → tìm thấy trong Model Registry
  5. Route đến provider Kiro với upstream "claude-sonnet-4.5"`}</pre>
            </div>
          )}

          {lang === "en" && activeSection === "models" && (
            <div className="docsSection">
              <h2>Models & Aliases</h2>
              <p>The Model Registry manages the mapping between model names that IDEs call and actual model names that providers receive.</p>

              <h3>What is Model Mapping?</h3>
              <p>When an IDE sends a request with <code>model: "kiro-sonnet"</code>, the gateway needs to know:</p>
              <ul>
                <li>Which provider to send to? → Kiro</li>
                <li>What is the actual model name on the provider? → claude-sonnet-4.5</li>
                <li>What does this model support? → chat, streaming</li>
              </ul>
              <pre className="docsCode">{`Model Mapping:
┌─────────────────────────────────────────────┐
│ Public Model:  "kiro-sonnet"                │  ← IDE calls this name
│ Provider:      kiro                         │  ← sends to this provider
│ Upstream:      "claude-sonnet-4.5"          │  ← provider receives this name
│ Capabilities:  chat, streaming              │  ← what the model supports
│ Enabled:       true                         │  ← is it currently active
└─────────────────────────────────────────────┘`}</pre>

              <h3>How to add a new Model</h3>
              <ol>
                <li>Go to Providers → click provider → Models section</li>
                <li>Click <strong>+ Add Model</strong></li>
                <li>Enter the public name (IDE will call this name)</li>
                <li>Enter the upstream name (actual name on the provider)</li>
                <li>Click Test to check if the model works</li>
                <li>Click Add Model to save</li>
              </ol>

              <h3>Model Aliases</h3>
              <p>Aliases let you create multiple names pointing to the same model or route. Very useful when:</p>
              <ul>
                <li>IDE requires a specific model name (e.g., Cursor only allows selecting "gpt-4o")</li>
                <li>You want to change the backend model without modifying config in all IDEs</li>
                <li>Multiple teams use different model names but route to the same provider</li>
              </ul>
              <pre className="docsCode">{`Example Aliases:
  "coding"        → "kiro-sonnet"       (short name)
  "gpt-4"         → "kiro-sonnet"       (trick IDE that only supports OpenAI)
  "claude-sonnet" → "kiro-sonnet"       (compatible with Anthropic naming)
  "fast"          → "route-fallback"    (points to a route instead of model)`}</pre>

              <h3>How to create an Alias</h3>
              <ol>
                <li>Go to the <strong>Routes</strong> page from the sidebar</li>
                <li>Scroll down to the <strong>Model Aliases</strong> section</li>
                <li>Enter the alias name (e.g., <code>coding</code>)</li>
                <li>Enter the target (e.g., <code>kiro-sonnet</code>)</li>
                <li>Click Add</li>
              </ol>

              <h3>Resolution order when receiving a request</h3>
              <pre className="docsCode">{`IDE sends: model = "coding"

Gateway resolves in order:
  1. Search Model Registry → no "coding" found
  2. Search Routing Profiles → no "coding" found
  3. Search Aliases → found! "coding" → "kiro-sonnet"
  4. Re-resolve "kiro-sonnet" → found in Model Registry
  5. Route to provider Kiro with upstream "claude-sonnet-4.5"`}</pre>
            </div>
          )}

          {lang === "vi" && activeSection === "routes" && (
            <div className="docsSection">
              <h2>Routes (Tuyến fallback)</h2>
              <p>Route là một chuỗi model được sắp xếp theo thứ tự ưu tiên. Khi model đầu tiên lỗi, gateway tự động thử model tiếp theo trong chuỗi.</p>

              <h3>Khi nào cần dùng Route?</h3>
              <ul>
                <li>Bạn có nhiều provider và muốn tự động chuyển đổi khi 1 provider down</li>
                <li>Bạn muốn ưu tiên provider rẻ hơn, chỉ dùng provider đắt khi cần</li>
                <li>Bạn muốn 1 tên model duy nhất trong IDE mà gateway tự xử lý fallback</li>
              </ul>

              <h3>Cách tạo Route</h3>
              <ol>
                <li>Vào trang <strong>Routes</strong> từ sidebar (mục Setup)</li>
                <li>Bấm <strong>Create Route</strong></li>
                <li>Đặt tên cho route (ví dụ: "coding")</li>
                <li>Chọn các model theo thứ tự ưu tiên (model đầu tiên được thử trước)</li>
                <li>Kéo thả để sắp xếp lại thứ tự nếu cần</li>
                <li>Bấm Create</li>
              </ol>

              <h3>Cách hoạt động chi tiết</h3>
              <pre className="docsCode">{`Route "coding" = [kiro-sonnet, windsurf-sonnet]

Khi IDE gửi request với model="coding":

Bước 1: Thử kiro-sonnet
  ├─ Chọn account Kiro ít bận nhất
  ├─ Gửi request đến Kiro
  ├─ ✅ Thành công → trả response cho IDE (kết thúc)
  └─ ❌ Lỗi → ghi nhận lỗi, chuyển sang bước 2

Bước 2: Thử windsurf-sonnet  
  ├─ Chọn account Windsurf ít bận nhất
  ├─ Gửi request đến Windsurf
  ├─ ✅ Thành công → trả response cho IDE (kết thúc)
  └─ ❌ Lỗi → tất cả đều lỗi

Kết quả: Trả 503 Service Unavailable cho IDE`}</pre>

              <h3>Sử dụng Route trong IDE</h3>
              <p>Trong cấu hình IDE, đặt <code>model</code> = tên route (ví dụ: <code>coding</code>). Gateway sẽ tự động xử lý fallback mà IDE không cần biết.</p>

              <h3>Lưu ý quan trọng</h3>
              <ul>
                <li>Route chỉ fallback khi provider trả lỗi (5xx, timeout, circuit breaker open)</li>
                <li>Lỗi 4xx (bad request, unauthorized) KHÔNG trigger fallback vì đó là lỗi từ phía client</li>
                <li>Mỗi model trong route phải đã được đăng ký trong Model Registry</li>
              </ul>
            </div>
          )}

          {lang === "en" && activeSection === "routes" && (
            <div className="docsSection">
              <h2>Routes (Fallback Chains)</h2>
              <p>A Route is a chain of models arranged by priority. When the first model fails, the gateway automatically tries the next model in the chain.</p>

              <h3>When do you need Routes?</h3>
              <ul>
                <li>You have multiple providers and want automatic switching when one goes down</li>
                <li>You want to prioritize a cheaper provider, only using the expensive one when needed</li>
                <li>You want a single model name in the IDE while the gateway handles fallback</li>
              </ul>

              <h3>How to create a Route</h3>
              <ol>
                <li>Go to the <strong>Routes</strong> page from the sidebar (Setup section)</li>
                <li>Click <strong>Create Route</strong></li>
                <li>Name the route (e.g., "coding")</li>
                <li>Select models in priority order (first model is tried first)</li>
                <li>Drag and drop to reorder if needed</li>
                <li>Click Create</li>
              </ol>

              <h3>Detailed operation</h3>
              <pre className="docsCode">{`Route "coding" = [kiro-sonnet, windsurf-sonnet]

When IDE sends request with model="coding":

Step 1: Try kiro-sonnet
  ├─ Pick least busy Kiro account
  ├─ Send request to Kiro
  ├─ ✅ Success → return response to IDE (done)
  └─ ❌ Error → log error, move to step 2

Step 2: Try windsurf-sonnet
  ├─ Pick least busy Windsurf account
  ├─ Send request to Windsurf
  ├─ ✅ Success → return response to IDE (done)
  └─ ❌ Error → all failed

Result: Return 503 Service Unavailable to IDE`}</pre>

              <h3>Using Routes in your IDE</h3>
              <p>In your IDE configuration, set <code>model</code> = route name (e.g., <code>coding</code>). The gateway will automatically handle fallback without the IDE knowing.</p>

              <h3>Important notes</h3>
              <ul>
                <li>Routes only fallback when the provider returns an error (5xx, timeout, circuit breaker open)</li>
                <li>4xx errors (bad request, unauthorized) do NOT trigger fallback because they are client-side errors</li>
                <li>Each model in a route must already be registered in the Model Registry</li>
              </ul>
            </div>
          )}

          {lang === "vi" && activeSection === "endpoint" && (
            <div className="docsSection">
              <h2>Endpoint & API Keys</h2>

              <h3>Endpoint URL</h3>
              <p>Gateway cung cấp API tương thích OpenAI tại địa chỉ:</p>
              <pre className="docsCode">http://localhost:3100/v1</pre>
              <p>Tất cả IDE hỗ trợ "OpenAI Compatible" đều có thể kết nối bằng URL này. Gateway nhận request theo chuẩn OpenAI và tự động route đến provider phù hợp.</p>

              <h3>API Keys</h3>
              <p>Mỗi IDE hoặc user cần 1 API key nội bộ để xác thực với gateway. Key này KHÔNG phải key của provider — nó chỉ dùng để gateway nhận diện ai đang gửi request.</p>

              <h4>Tạo API Key</h4>
              <ol>
                <li>Vào trang <strong>Endpoint</strong> từ sidebar</li>
                <li>Cuộn xuống phần API Keys → bấm <strong>Create Key</strong></li>
                <li>Nhập tên (ví dụ: "cursor-laptop", "cline-work")</li>
                <li>Chọn Team nếu muốn áp dụng giới hạn team</li>
                <li>Đặt RPM Limit và Daily Limit nếu muốn giới hạn riêng cho key này</li>
                <li>Bấm Create → <strong>Copy key ngay lập tức</strong> (chỉ hiện 1 lần, không xem lại được)</li>
              </ol>

              <h4>Giới hạn per-key</h4>
              <table className="docsTable">
                <thead><tr><th>Trường</th><th>Ý nghĩa</th><th>Giá trị mặc định</th></tr></thead>
                <tbody>
                  <tr><td><strong>RPM Limit</strong></td><td>Số request tối đa mỗi phút cho key này</td><td>0 (dùng giới hạn global)</td></tr>
                  <tr><td><strong>Daily Limit</strong></td><td>Số request tối đa mỗi ngày cho key này</td><td>0 (dùng giới hạn global)</td></tr>
                  <tr><td><strong>Team</strong></td><td>Gán key vào team để áp dụng allowed models và team limits</td><td>Không có team</td></tr>
                </tbody>
              </table>

              <h3>QR Code</h3>
              <p>Ở cuối phần Endpoint URL có QR code chứa địa chỉ gateway. Scan bằng điện thoại để copy nhanh khi demo hoặc chia sẻ cho đồng nghiệp.</p>

              <h3>Token Saver</h3>
              <p>Nằm ở giữa trang Endpoint, Token Saver giúp giảm số token gửi đến provider:</p>
              <ul>
                <li><strong>Compress Tool Output</strong> — Tự động loại bỏ ANSI escape codes, whitespace thừa, và truncate output quá dài từ terminal/file.</li>
                <li><strong>Caveman Mode</strong> — Rút gọn system prompt theo 3 cấp độ (Lite / Full / Ultra) để tiết kiệm input tokens.</li>
              </ul>
            </div>
          )}

          {lang === "en" && activeSection === "endpoint" && (
            <div className="docsSection">
              <h2>Endpoint & API Keys</h2>

              <h3>Endpoint URL</h3>
              <p>The gateway provides an OpenAI-compatible API at:</p>
              <pre className="docsCode">http://localhost:3100/v1</pre>
              <p>All IDEs that support "OpenAI Compatible" can connect using this URL. The gateway receives requests in OpenAI format and automatically routes them to the appropriate provider.</p>

              <h3>API Keys</h3>
              <p>Each IDE or user needs an internal API key to authenticate with the gateway. This key is NOT a provider key — it's only used for the gateway to identify who is sending the request.</p>

              <h4>Creating an API Key</h4>
              <ol>
                <li>Go to the <strong>Endpoint</strong> page from the sidebar</li>
                <li>Scroll down to API Keys → click <strong>Create Key</strong></li>
                <li>Enter a name (e.g., "cursor-laptop", "cline-work")</li>
                <li>Select a Team if you want to apply team limits</li>
                <li>Set RPM Limit and Daily Limit if you want per-key limits</li>
                <li>Click Create → <strong>Copy the key immediately</strong> (shown only once, cannot be viewed again)</li>
              </ol>

              <h4>Per-key limits</h4>
              <table className="docsTable">
                <thead><tr><th>Field</th><th>Meaning</th><th>Default Value</th></tr></thead>
                <tbody>
                  <tr><td><strong>RPM Limit</strong></td><td>Maximum requests per minute for this key</td><td>0 (uses global limit)</td></tr>
                  <tr><td><strong>Daily Limit</strong></td><td>Maximum requests per day for this key</td><td>0 (uses global limit)</td></tr>
                  <tr><td><strong>Team</strong></td><td>Assign key to a team to apply allowed models and team limits</td><td>No team</td></tr>
                </tbody>
              </table>

              <h3>QR Code</h3>
              <p>At the bottom of the Endpoint URL section there's a QR code containing the gateway address. Scan with your phone to quickly copy when demoing or sharing with colleagues.</p>

              <h3>Token Saver</h3>
              <p>Located in the middle of the Endpoint page, Token Saver reduces the number of tokens sent to the provider:</p>
              <ul>
                <li><strong>Compress Tool Output</strong> — Automatically removes ANSI escape codes, excess whitespace, and truncates overly long output from terminal/files.</li>
                <li><strong>Caveman Mode</strong> — Shortens system prompts in 3 levels (Lite / Full / Ultra) to save input tokens.</li>
              </ul>
            </div>
          )}

          {lang === "vi" && activeSection === "teams" && (
            <div className="docsSection">
              <h2>Teams & Giới hạn</h2>
              <p>Team cho phép bạn nhóm nhiều API key lại và áp dụng chính sách chung: giới hạn request, giới hạn model được phép dùng.</p>

              <h3>Tạo Team</h3>
              <ol>
                <li>Vào trang <strong>Teams</strong> từ sidebar (mục Admin)</li>
                <li>Bấm <strong>Create Team</strong></li>
                <li>Điền thông tin:
                  <ul>
                    <li><strong>Tên team</strong> — Ví dụ: "Frontend Team", "Backend Team"</li>
                    <li><strong>RPM Limit</strong> — Số request/phút tối đa cho cả team (0 = không giới hạn)</li>
                    <li><strong>Daily Limit</strong> — Số request/ngày tối đa (0 = không giới hạn)</li>
                    <li><strong>Monthly Limit</strong> — Số request/tháng tối đa (0 = không giới hạn)</li>
                    <li><strong>Allowed Models</strong> — Danh sách model team được phép dùng. Để trống = dùng tất cả.</li>
                  </ul>
                </li>
                <li>Bấm Create</li>
              </ol>

              <h3>Gán API Key vào Team</h3>
              <p>Khi tạo API key ở trang Endpoint, chọn team từ dropdown. Key đó sẽ chịu giới hạn của team.</p>

              <h3>Thứ tự áp dụng giới hạn</h3>
              <pre className="docsCode">{`Khi nhận request, gateway kiểm tra theo thứ tự:

1. Per-key limit (nếu key có rpmLimit hoặc dailyLimit riêng)
   → Vượt? Trả 429 Too Many Requests

2. Team allowed models (nếu key thuộc team có allowedModels)
   → Model không nằm trong danh sách? Trả 403 Forbidden

3. Global rate limit (cấu hình chung cho toàn gateway)
   → Vượt? Trả 429 Too Many Requests

4. Tất cả OK → tiếp tục route request đến provider`}</pre>

              <h3>Ví dụ thực tế</h3>
              <pre className="docsCode">{`Team "Intern":
  RPM Limit: 10        (tối đa 10 request/phút)
  Daily Limit: 200     (tối đa 200 request/ngày)
  Allowed Models: ["kiro-sonnet"]  (chỉ được dùng model rẻ)

Team "Senior Dev":
  RPM Limit: 0         (không giới hạn/phút)
  Daily Limit: 0       (không giới hạn/ngày)
  Allowed Models: []   (dùng tất cả model)`}</pre>
            </div>
          )}

          {lang === "en" && activeSection === "teams" && (
            <div className="docsSection">
              <h2>Teams & Limits</h2>
              <p>Teams let you group multiple API keys together and apply shared policies: request limits, allowed models.</p>

              <h3>Creating a Team</h3>
              <ol>
                <li>Go to the <strong>Teams</strong> page from the sidebar (Admin section)</li>
                <li>Click <strong>Create Team</strong></li>
                <li>Fill in the details:
                  <ul>
                    <li><strong>Team name</strong> — e.g., "Frontend Team", "Backend Team"</li>
                    <li><strong>RPM Limit</strong> — Max requests/minute for the entire team (0 = unlimited)</li>
                    <li><strong>Daily Limit</strong> — Max requests/day (0 = unlimited)</li>
                    <li><strong>Monthly Limit</strong> — Max requests/month (0 = unlimited)</li>
                    <li><strong>Allowed Models</strong> — List of models the team can use. Leave empty = use all.</li>
                  </ul>
                </li>
                <li>Click Create</li>
              </ol>

              <h3>Assigning API Keys to a Team</h3>
              <p>When creating an API key on the Endpoint page, select a team from the dropdown. That key will be subject to the team's limits.</p>

              <h3>Limit enforcement order</h3>
              <pre className="docsCode">{`When receiving a request, the gateway checks in order:

1. Per-key limit (if key has its own rpmLimit or dailyLimit)
   → Exceeded? Return 429 Too Many Requests

2. Team allowed models (if key belongs to a team with allowedModels)
   → Model not in the list? Return 403 Forbidden

3. Global rate limit (shared configuration for the entire gateway)
   → Exceeded? Return 429 Too Many Requests

4. All OK → continue routing request to provider`}</pre>

              <h3>Practical example</h3>
              <pre className="docsCode">{`Team "Intern":
  RPM Limit: 10        (max 10 requests/minute)
  Daily Limit: 200     (max 200 requests/day)
  Allowed Models: ["kiro-sonnet"]  (can only use the cheaper model)

Team "Senior Dev":
  RPM Limit: 0         (unlimited/minute)
  Daily Limit: 0       (unlimited/day)
  Allowed Models: []   (can use all models)`}</pre>
            </div>
          )}

          {lang === "vi" && activeSection === "spending" && (
            <div className="docsSection">
              <h2>Hạn mức chi tiêu (Spending Caps)</h2>
              <p>Đặt giới hạn chi tiêu cứng bằng USD cho từng API key và từng team. Gateway kiểm tra <strong>trước khi</strong> gọi provider — nếu vượt sẽ trả về <code>429 spend_limit_exceeded</code>, không tốn tiền oan.</p>

              <h3>Cách hoạt động</h3>
              <ul>
                <li><strong>Hold-and-settle</strong> — Trước khi gửi request, gateway ước tính chi phí tối đa và "giữ chỗ" số tiền đó. Sau khi hoàn tất, điều chỉnh về chi phí thực (hoàn lại phần chênh). Hai request đồng thời gần ngưỡng sẽ không cùng vượt cap.</li>
                <li><strong>Theo ngày & theo tháng</strong> — Cả hai mốc đều được kiểm tra; mốc nào chặt hơn sẽ thắng. Reset theo lịch UTC.</li>
                <li><strong>Kế thừa từ team</strong> — Nếu key không có cap riêng mà thuộc team có cap, cap của team được áp dụng.</li>
                <li><strong>Lưu bền</strong> — Số liệu chi tiêu được lưu xuống đĩa, không mất khi restart gateway.</li>
              </ul>

              <h3>Thiết lập</h3>
              <ol>
                <li>Vào <strong>Endpoint &amp; Keys</strong> → sửa một API key → tab <strong>Limits</strong>.</li>
                <li>Điền <strong>Daily spend cap (USD)</strong> và/hoặc <strong>Monthly spend cap (USD)</strong>. Để trống = không giới hạn.</li>
                <li>Với team: vào trang <strong>Teams</strong>, điền 2 trường spend cap tương tự.</li>
              </ol>

              <h3>Theo dõi</h3>
              <p>Danh sách API key hiển thị badge <code>$đã_dùng / $cap</code> theo ngày và tháng, đổi màu xanh → vàng → đỏ khi tiến gần ngưỡng. API: <code>GET /admin/v1/spend/key/:id</code> và <code>/admin/v1/spend/team/:id</code>.</p>
            </div>
          )}

          {lang === "en" && activeSection === "spending" && (
            <div className="docsSection">
              <h2>Spending Caps</h2>
              <p>Set hard USD spending limits per API key and per team. The gateway checks them <strong>before</strong> calling the provider — exceeding a cap returns <code>429 spend_limit_exceeded</code> so you never overspend.</p>

              <h3>How it works</h3>
              <ul>
                <li><strong>Hold-and-settle</strong> — before dispatch, the gateway estimates the worst-case cost and reserves it; after completion it adjusts to the actual cost (refunding the difference). Two concurrent requests near the cap can't both slip through.</li>
                <li><strong>Daily &amp; monthly</strong> — both windows are enforced; whichever caps tighter wins. Resets on the UTC calendar.</li>
                <li><strong>Team inheritance</strong> — if a key has no own cap but belongs to a team that does, the team cap applies.</li>
                <li><strong>Persisted</strong> — spend totals are written to disk and survive gateway restarts.</li>
              </ul>

              <h3>Setup</h3>
              <ol>
                <li>Go to <strong>Endpoint &amp; Keys</strong> → edit an API key → <strong>Limits</strong> tab.</li>
                <li>Fill in <strong>Daily spend cap (USD)</strong> and/or <strong>Monthly spend cap (USD)</strong>. Empty = unlimited.</li>
                <li>For teams: open the <strong>Teams</strong> page and fill the same two spend-cap fields.</li>
              </ol>

              <h3>Monitoring</h3>
              <p>The API key list shows a <code>$spent / $cap</code> badge for day and month, colored green → amber → red as it approaches the limit. API: <code>GET /admin/v1/spend/key/:id</code> and <code>/admin/v1/spend/team/:id</code>.</p>
            </div>
          )}

          {lang === "vi" && activeSection === "cache" && (
            <div className="docsSection">
              <h2>Response Cache</h2>
              <p>Cache phản hồi cho các request giống hệt nhau. Khi bật, request trùng <code>(model + messages + tham số)</code> trả về ngay lập tức với chi phí token bằng 0. Hữu ích cho prompt lặp lại, batch job, retry sau lỗi mạng.</p>

              <h3>Bật cache cho một request</h3>
              <p>Thêm trường <code>cache_control</code> vào body, hoặc gửi header <code>x-gateway-cache-control</code>:</p>
              <pre className="docsCode">{`{
  "model": "claude-opus-4-7",
  "messages": [ ... ],
  "cache_control": { "mode": "use" }
}`}</pre>
              <ul>
                <li><code>skip</code> (mặc định) — bỏ qua cache hoàn toàn.</li>
                <li><code>use</code> — đọc cache; trúng thì trả ngay, trượt thì gọi provider rồi lưu lại.</li>
                <li><code>refresh</code> — bỏ qua bản cũ, gọi provider, ghi đè cache.</li>
                <li><code>ttl</code> (tuỳ chọn) — thời gian sống của entry tính bằng giây (mặc định 1 giờ, tối đa 24 giờ).</li>
              </ul>

              <h3>Các trường hợp KHÔNG cache</h3>
              <ul>
                <li>Request streaming (<code>stream: true</code>).</li>
                <li>Phản hồi có <code>tool_calls</code> (kết quả tool không an toàn để phát lại).</li>
                <li><code>temperature &gt; 0</code> kèm <code>top_p</code>/<code>top_k</code> ngẫu nhiên (không deterministic).</li>
                <li>Phản hồi lỗi (không phải 2xx).</li>
              </ul>

              <h3>Điều khiển theo key & giám sát</h3>
              <p>Trong tab <strong>Limits</strong> của API key, đặt <strong>Cache mode</strong>: <code>client_choice</code> (theo request), <code>force_use</code> (luôn cache), <code>force_skip</code> (không bao giờ cache). Thẻ <strong>Response cache</strong> ở trang Overview hiển thị hit ratio, số entry, bộ nhớ dùng. API: <code>GET /admin/v1/cache/stats</code>, <code>DELETE /admin/v1/cache</code>.</p>
            </div>
          )}

          {lang === "en" && activeSection === "cache" && (
            <div className="docsSection">
              <h2>Response Cache</h2>
              <p>Cache responses for identical requests. When enabled, a repeat request with the same <code>(model + messages + params)</code> returns instantly at zero token cost. Great for repeated prompts, batch jobs, and retries after a network blip.</p>

              <h3>Enable cache for a request</h3>
              <p>Add a <code>cache_control</code> field to the body, or send the <code>x-gateway-cache-control</code> header:</p>
              <pre className="docsCode">{`{
  "model": "claude-opus-4-7",
  "messages": [ ... ],
  "cache_control": { "mode": "use" }
}`}</pre>
              <ul>
                <li><code>skip</code> (default) — bypass the cache entirely.</li>
                <li><code>use</code> — read cache; on hit return it, on miss call the provider and store the result.</li>
                <li><code>refresh</code> — ignore any existing entry, call the provider, overwrite the cache.</li>
                <li><code>ttl</code> (optional) — entry lifetime in seconds (default 1 hour, max 24 hours).</li>
              </ul>

              <h3>What is NOT cached</h3>
              <ul>
                <li>Streaming requests (<code>stream: true</code>).</li>
                <li>Responses containing <code>tool_calls</code> (tool results are unsafe to replay).</li>
                <li><code>temperature &gt; 0</code> with random <code>top_p</code>/<code>top_k</code> (non-deterministic).</li>
                <li>Non-2xx error responses.</li>
              </ul>

              <h3>Per-key control &amp; monitoring</h3>
              <p>In an API key's <strong>Limits</strong> tab, set <strong>Cache mode</strong>: <code>client_choice</code> (respect the request), <code>force_use</code> (always cache), <code>force_skip</code> (never cache). The <strong>Response cache</strong> card on the Overview page shows hit ratio, entry count, and memory used. API: <code>GET /admin/v1/cache/stats</code>, <code>DELETE /admin/v1/cache</code>.</p>
            </div>
          )}

          {lang === "vi" && activeSection === "observability" && (
            <div className="docsSection">
              <h2>Giám sát &amp; Metrics</h2>
              <p>X-Router ghi lại latency, usage và lỗi cho mọi request để bạn biết hệ thống đang chạy thế nào.</p>

              <h3>Biểu đồ Usage</h3>
              <p>Trang <strong>Usage</strong> (dưới bảng model leaderboard) có panel "Usage trends" với 3 tab:</p>
              <ul>
                <li><strong>Trend</strong> — biểu đồ vùng theo thời gian, mỗi model một dải.</li>
                <li><strong>Proportion</strong> — biểu đồ tròn tỉ lệ theo model.</li>
                <li><strong>Top</strong> — biểu đồ cột model tốn nhất.</li>
              </ul>
              <p>Nút chuyển chỉ số: chi phí (USD) / token / số request. API: <code>GET /admin/v1/usage/aggregate</code>.</p>

              <h3>Latency (p50/p95/p99)</h3>
              <p>Thẻ <strong>Slowest channels</strong> ở trang Overview hiển thị top-10 channel chậm nhất theo p95 trong 5 phút gần nhất, kèm số request thành công/lỗi. API: <code>GET /admin/v1/metrics/latency</code>.</p>

              <h3>Prometheus</h3>
              <p>Endpoint <code>GET /metrics</code> xuất histogram <code>gateway_request_duration_ms</code> theo provider/model/account cho Grafana hoặc Datadog. Mặc định cần admin auth; đặt biến môi trường <code>METRICS_PUBLIC=true</code> để cho phép scrape không cần auth (chỉ nên dùng trong mạng nội bộ).</p>

              <h3>Logs</h3>
              <ul>
                <li><strong>Request Logs</strong> — luồng metadata của từng request (method, route, status, thời gian, key hash).</li>
                <li><strong>Audit Logs</strong> — mọi thao tác quản trị (tạo/sửa/xoá provider, key, team...).</li>
              </ul>
            </div>
          )}

          {lang === "en" && activeSection === "observability" && (
            <div className="docsSection">
              <h2>Observability &amp; Metrics</h2>
              <p>X-Router records latency, usage, and errors for every request so you always know how the system is performing.</p>

              <h3>Usage charts</h3>
              <p>The <strong>Usage</strong> page (below the model leaderboard) has a "Usage trends" panel with three tabs:</p>
              <ul>
                <li><strong>Trend</strong> — stacked area chart over time, one band per model.</li>
                <li><strong>Proportion</strong> — pie chart of share by model.</li>
                <li><strong>Top</strong> — horizontal bar chart of the costliest models.</li>
              </ul>
              <p>A metric switcher toggles cost (USD) / tokens / requests. API: <code>GET /admin/v1/usage/aggregate</code>.</p>

              <h3>Latency (p50/p95/p99)</h3>
              <p>The <strong>Slowest channels</strong> card on the Overview page shows the top-10 channels by p95 over the last 5 minutes, with ok/error request counts. API: <code>GET /admin/v1/metrics/latency</code>.</p>

              <h3>Prometheus</h3>
              <p>The <code>GET /metrics</code> endpoint exports a <code>gateway_request_duration_ms</code> histogram by provider/model/account for Grafana or Datadog. It requires admin auth by default; set <code>METRICS_PUBLIC=true</code> to allow unauthenticated scrapes (use only on a private network).</p>

              <h3>Logs</h3>
              <ul>
                <li><strong>Request Logs</strong> — a metadata-only stream per request (method, route, status, duration, key hash).</li>
                <li><strong>Audit Logs</strong> — every admin action (create/update/delete provider, key, team, ...).</li>
              </ul>
            </div>
          )}

          {lang === "vi" && activeSection === "token-saver" && (
            <div className="docsSection">
              <h2>Token Saver</h2>
              <p>Token Saver tự động giảm số token trong mỗi request trước khi gửi đến provider. Giúp tiết kiệm chi phí và tăng tốc response (ít token = xử lý nhanh hơn).</p>

              <h3>Compress Tool Output</h3>
              <p>Khi IDE gửi kết quả từ terminal, file content, hoặc tool output, nội dung thường chứa rất nhiều "rác":</p>
              <ul>
                <li>ANSI escape codes (màu sắc terminal) — bị loại bỏ hoàn toàn</li>
                <li>Whitespace thừa (nhiều dòng trống liên tiếp) — gộp lại còn 1</li>
                <li>Output quá dài (hàng nghìn dòng log) — chỉ giữ phần đầu + phần cuối</li>
              </ul>
              <p>Kết quả: giảm 30-70% token cho tool output mà không mất thông tin quan trọng.</p>

              <h3>Caveman Mode</h3>
              <p>Rút gọn system prompt (phần hướng dẫn dài mà IDE gửi kèm mỗi request):</p>
              <table className="docsTable">
                <thead><tr><th>Cấp độ</th><th>Mô tả</th><th>Tiết kiệm</th></tr></thead>
                <tbody>
                  <tr><td><strong>Lite</strong></td><td>Giữ nguyên ý chính, bỏ ví dụ dài và giải thích chi tiết</td><td>~20-30%</td></tr>
                  <tr><td><strong>Full</strong></td><td>Tóm tắt mạnh, chỉ giữ rules và constraints quan trọng</td><td>~40-60%</td></tr>
                  <tr><td><strong>Ultra</strong></td><td>Tối giản tối đa, chỉ giữ core instructions cốt lõi</td><td>~60-80%</td></tr>
                </tbody>
              </table>

              <h3>Cách bật/tắt</h3>
              <ol>
                <li>Vào trang <strong>Endpoint</strong></li>
                <li>Phần <strong>Token Saver</strong> ở giữa trang</li>
                <li>Bật/tắt từng tính năng bằng toggle</li>
                <li>Chọn cấp độ Caveman nếu bật</li>
              </ol>

              <h3>Lưu ý</h3>
              <ul>
                <li>Token Saver chỉ ảnh hưởng đến input (request gửi đi), không thay đổi output (response nhận về)</li>
                <li>Nếu AI trả lời kém chất lượng sau khi bật Caveman Ultra, hãy giảm xuống Full hoặc Lite</li>
                <li>Compress Tool Output an toàn để bật mọi lúc — không ảnh hưởng chất lượng AI</li>
              </ul>
            </div>
          )}

          {lang === "en" && activeSection === "token-saver" && (
            <div className="docsSection">
              <h2>Token Saver</h2>
              <p>Token Saver automatically reduces the number of tokens in each request before sending to the provider. Saves costs and speeds up responses (fewer tokens = faster processing).</p>

              <h3>Compress Tool Output</h3>
              <p>When the IDE sends results from terminal, file content, or tool output, the content often contains a lot of "noise":</p>
              <ul>
                <li>ANSI escape codes (terminal colors) — completely removed</li>
                <li>Excess whitespace (multiple consecutive blank lines) — merged into one</li>
                <li>Overly long output (thousands of log lines) — keeps only the beginning + end</li>
              </ul>
              <p>Result: 30-70% token reduction for tool output without losing important information.</p>

              <h3>Caveman Mode</h3>
              <p>Shortens the system prompt (the long instructions that IDEs send with every request):</p>
              <table className="docsTable">
                <thead><tr><th>Level</th><th>Description</th><th>Savings</th></tr></thead>
                <tbody>
                  <tr><td><strong>Lite</strong></td><td>Keeps main ideas, removes long examples and detailed explanations</td><td>~20-30%</td></tr>
                  <tr><td><strong>Full</strong></td><td>Strong summarization, keeps only important rules and constraints</td><td>~40-60%</td></tr>
                  <tr><td><strong>Ultra</strong></td><td>Maximum minimization, keeps only core instructions</td><td>~60-80%</td></tr>
                </tbody>
              </table>

              <h3>How to enable/disable</h3>
              <ol>
                <li>Go to the <strong>Endpoint</strong> page</li>
                <li><strong>Token Saver</strong> section in the middle of the page</li>
                <li>Toggle each feature on/off</li>
                <li>Select Caveman level if enabled</li>
              </ol>

              <h3>Notes</h3>
              <ul>
                <li>Token Saver only affects input (outgoing requests), does not change output (incoming responses)</li>
                <li>If AI quality drops after enabling Caveman Ultra, reduce to Full or Lite</li>
                <li>Compress Tool Output is safe to enable at all times — does not affect AI quality</li>
              </ul>
            </div>
          )}

          {lang === "vi" && activeSection === "playground" && (
            <div className="docsSection">
              <h2>Playground</h2>
              <p>Playground cho phép bạn test gateway routing trực tiếp từ dashboard mà không cần mở IDE.</p>

              <h3>Cách sử dụng</h3>
              <ol>
                <li>Vào trang <strong>Playground</strong> từ sidebar (mục Monitor)</li>
                <li>Cấu hình bên trái:
                  <ul>
                    <li><strong>API Key</strong> — Key để xác thực (mặc định: dev-key-1)</li>
                    <li><strong>Model / Route</strong> — Chọn model hoặc route muốn test</li>
                    <li><strong>Max Tokens</strong> — Giới hạn độ dài response (64 - 4096)</li>
                    <li><strong>Temperature</strong> — Độ sáng tạo (0.0 = chính xác, 2.0 = ngẫu nhiên)</li>
                  </ul>
                </li>
                <li>Gõ message vào ô chat bên phải</li>
                <li>Bấm Enter hoặc nút Send để gửi</li>
                <li>Response hiện ngay trong chat</li>
              </ol>

              <h3>Tính năng</h3>
              <ul>
                <li><strong>Multi-turn</strong> — Hỗ trợ hội thoại nhiều lượt, giữ context</li>
                <li><strong>Clear Chat</strong> — Bấm nút Clear Chat để xóa lịch sử và bắt đầu lại</li>
                <li><strong>Shift+Enter</strong> — Xuống dòng mà không gửi message</li>
                <li><strong>Error display</strong> — Nếu request lỗi, error message hiện ngay trong chat</li>
              </ul>

              <h3>Playground vs IDE thật</h3>
              <p>Playground gửi request qua đúng routing engine của gateway, giống hệt khi IDE gửi. Nếu Playground hoạt động, IDE cũng sẽ hoạt động.</p>
            </div>
          )}

          {lang === "en" && activeSection === "playground" && (
            <div className="docsSection">
              <h2>Playground</h2>
              <p>Playground lets you test gateway routing directly from the dashboard without opening an IDE.</p>

              <h3>How to use</h3>
              <ol>
                <li>Go to the <strong>Playground</strong> page from the sidebar (Monitor section)</li>
                <li>Configure on the left:
                  <ul>
                    <li><strong>API Key</strong> — Key for authentication (default: dev-key-1)</li>
                    <li><strong>Model / Route</strong> — Select the model or route to test</li>
                    <li><strong>Max Tokens</strong> — Limit response length (64 - 4096)</li>
                    <li><strong>Temperature</strong> — Creativity level (0.0 = precise, 2.0 = random)</li>
                  </ul>
                </li>
                <li>Type a message in the chat box on the right</li>
                <li>Press Enter or click Send to submit</li>
                <li>Response appears immediately in the chat</li>
              </ol>

              <h3>Features</h3>
              <ul>
                <li><strong>Multi-turn</strong> — Supports multi-turn conversations, maintains context</li>
                <li><strong>Clear Chat</strong> — Click the Clear Chat button to erase history and start over</li>
                <li><strong>Shift+Enter</strong> — New line without sending the message</li>
                <li><strong>Error display</strong> — If a request fails, the error message appears directly in chat</li>
              </ul>

              <h3>Playground vs real IDE</h3>
              <p>Playground sends requests through the exact same routing engine as the gateway uses for IDEs. If Playground works, your IDE will work too.</p>
            </div>
          )}

          {lang === "vi" && activeSection === "webhooks" && (
            <div className="docsSection">
              <h2>Webhook thông báo</h2>
              <p>Webhook gửi thông báo real-time đến Discord hoặc Slack khi có sự kiện quan trọng xảy ra trong gateway.</p>

              <h3>Các sự kiện được hỗ trợ</h3>
              <table className="docsTable">
                <thead><tr><th>Sự kiện</th><th>Khi nào xảy ra</th><th>Mức độ</th></tr></thead>
                <tbody>
                  <tr><td><code>circuit_breaker.open</code></td><td>Provider lỗi liên tục, bị tạm ngắt</td><td>🔴 Nghiêm trọng</td></tr>
                  <tr><td><code>circuit_breaker.close</code></td><td>Provider phục hồi, hoạt động lại</td><td>🟢 Thông tin</td></tr>
                  <tr><td><code>account.cooldown</code></td><td>Account vào trạng thái nghỉ tạm</td><td>🟡 Cảnh báo</td></tr>
                  <tr><td><code>account.disabled</code></td><td>Account bị vô hiệu hóa</td><td>🔴 Nghiêm trọng</td></tr>
                  <tr><td><code>rate_limit.exceeded</code></td><td>API key hoặc team vượt giới hạn</td><td>🟡 Cảnh báo</td></tr>
                  <tr><td><code>provider.error</code></td><td>Provider trả lỗi (5xx, timeout)</td><td>🟡 Cảnh báo</td></tr>
                </tbody>
              </table>

              <h3>Cách cấu hình</h3>
              <ol>
                <li>Vào trang <strong>Settings</strong> → tab General</li>
                <li>Cuộn xuống card <strong>Webhook Notifications</strong></li>
                <li>Bật toggle để kích hoạt</li>
                <li>Nhập Webhook URL:
                  <ul>
                    <li><strong>Discord</strong>: Server Settings → Integrations → Webhooks → Copy URL</li>
                    <li><strong>Slack</strong>: Apps → Incoming Webhooks → Add → Copy URL</li>
                  </ul>
                </li>
                <li>Bấm <strong>Save</strong> để lưu</li>
                <li>Bấm <strong>Test</strong> để gửi thông báo thử</li>
              </ol>

              <h3>Format thông báo</h3>
              <p>Gateway tự động phát hiện loại webhook (Discord hay Slack) dựa trên URL và format message phù hợp:</p>
              <ul>
                <li><strong>Discord</strong> — Embed với màu sắc theo mức độ (đỏ/vàng/xanh), timestamp, footer</li>
                <li><strong>Slack</strong> — Block Kit format với emoji, bullet points, context</li>
              </ul>
            </div>
          )}

          {lang === "en" && activeSection === "webhooks" && (
            <div className="docsSection">
              <h2>Webhook Notifications</h2>
              <p>Webhooks send real-time notifications to Discord or Slack when important events occur in the gateway.</p>

              <h3>Supported events</h3>
              <table className="docsTable">
                <thead><tr><th>Event</th><th>When it occurs</th><th>Severity</th></tr></thead>
                <tbody>
                  <tr><td><code>circuit_breaker.open</code></td><td>Provider fails consecutively, temporarily disconnected</td><td>🔴 Critical</td></tr>
                  <tr><td><code>circuit_breaker.close</code></td><td>Provider recovered, operating again</td><td>🟢 Info</td></tr>
                  <tr><td><code>account.cooldown</code></td><td>Account enters temporary rest state</td><td>🟡 Warning</td></tr>
                  <tr><td><code>account.disabled</code></td><td>Account has been disabled</td><td>🔴 Critical</td></tr>
                  <tr><td><code>rate_limit.exceeded</code></td><td>API key or team exceeded limit</td><td>🟡 Warning</td></tr>
                  <tr><td><code>provider.error</code></td><td>Provider returned error (5xx, timeout)</td><td>🟡 Warning</td></tr>
                </tbody>
              </table>

              <h3>How to configure</h3>
              <ol>
                <li>Go to <strong>Settings</strong> → General tab</li>
                <li>Scroll down to the <strong>Webhook Notifications</strong> card</li>
                <li>Enable the toggle to activate</li>
                <li>Enter the Webhook URL:
                  <ul>
                    <li><strong>Discord</strong>: Server Settings → Integrations → Webhooks → Copy URL</li>
                    <li><strong>Slack</strong>: Apps → Incoming Webhooks → Add → Copy URL</li>
                  </ul>
                </li>
                <li>Click <strong>Save</strong> to save</li>
                <li>Click <strong>Test</strong> to send a test notification</li>
              </ol>

              <h3>Notification format</h3>
              <p>The gateway automatically detects the webhook type (Discord or Slack) based on the URL and formats the message accordingly:</p>
              <ul>
                <li><strong>Discord</strong> — Embed with color-coded severity (red/yellow/green), timestamp, footer</li>
                <li><strong>Slack</strong> — Block Kit format with emoji, bullet points, context</li>
              </ul>
            </div>
          )}

          {lang === "vi" && activeSection === "settings" && (
            <div className="docsSection">
              <h2>Cài đặt hệ thống</h2>
              <p>Trang Settings quản lý cấu hình runtime, bảo mật, và dữ liệu của gateway.</p>

              <h3>Tab General</h3>
              <h4>Security (Bảo mật)</h4>
              <ul>
                <li><strong>Admin Authentication</strong> — Tất cả API admin yêu cầu Bearer token. Luôn bật.</li>
                <li><strong>Credential Encryption</strong> — Mọi credentials (token, key) được mã hóa AES-256-GCM. Luôn bật.</li>
                <li><strong>Sensitive Data Redaction</strong> — Token và key bị ẩn trong logs và API responses. Luôn bật.</li>
              </ul>

              <h4>Runtime (Toggles)</h4>
              <ul>
                <li><strong>Request Queue</strong> — Khi bật, request vượt concurrency limit sẽ được xếp hàng chờ thay vì bị reject ngay. Tắt mặc định.</li>
                <li><strong>Auto-persist</strong> — Tự động lưu state ra file sau mỗi thay đổi admin. Luôn bật.</li>
                <li><strong>Circuit Breaker</strong> — Tự động ngắt provider lỗi liên tục. Luôn bật.</li>
              </ul>

              <h4>Actions (Hành động)</h4>
              <ul>
                <li><strong>Change Password</strong> — Đổi mật khẩu admin đăng nhập dashboard</li>
                <li><strong>Export Data</strong> — Tải toàn bộ state gateway (providers, accounts, models, teams) dạng JSON</li>
                <li><strong>Import Data</strong> — Khôi phục từ file JSON đã export trước đó</li>
                <li><strong>Reset Gateway</strong> — Xóa usage logs và request logs. Providers và accounts được giữ nguyên.</li>
              </ul>

              <h3>Tab Configuration</h3>
              <p>Editor JSON cho phép chỉnh sửa cấu hình gateway trực tiếp. Bấm Validate để kiểm tra, Publish để áp dụng.</p>

              <h3>Tab Revisions</h3>
              <p>Lịch sử các phiên bản cấu hình đã publish. Có thể Rollback về bất kỳ phiên bản nào trước đó.</p>
            </div>
          )}

          {lang === "en" && activeSection === "settings" && (
            <div className="docsSection">
              <h2>System Settings</h2>
              <p>The Settings page manages runtime configuration, security, and gateway data.</p>

              <h3>General Tab</h3>
              <h4>Security</h4>
              <ul>
                <li><strong>Admin Authentication</strong> — All admin APIs require Bearer token. Always enabled.</li>
                <li><strong>Credential Encryption</strong> — All credentials (tokens, keys) are encrypted with AES-256-GCM. Always enabled.</li>
                <li><strong>Sensitive Data Redaction</strong> — Tokens and keys are hidden in logs and API responses. Always enabled.</li>
              </ul>

              <h4>Runtime (Toggles)</h4>
              <ul>
                <li><strong>Request Queue</strong> — When enabled, requests exceeding concurrency limit are queued instead of rejected immediately. Off by default.</li>
                <li><strong>Auto-persist</strong> — Automatically saves state to file after each admin change. Always enabled.</li>
                <li><strong>Circuit Breaker</strong> — Automatically disconnects providers with consecutive failures. Always enabled.</li>
              </ul>

              <h4>Actions</h4>
              <ul>
                <li><strong>Change Password</strong> — Change the admin dashboard login password</li>
                <li><strong>Export Data</strong> — Download entire gateway state (providers, accounts, models, teams) as JSON</li>
                <li><strong>Import Data</strong> — Restore from a previously exported JSON file</li>
                <li><strong>Reset Gateway</strong> — Clear usage logs and request logs. Providers and accounts are preserved.</li>
              </ul>

              <h3>Configuration Tab</h3>
              <p>JSON editor for directly editing gateway configuration. Click Validate to check, Publish to apply.</p>

              <h3>Revisions Tab</h3>
              <p>History of published configuration versions. You can Rollback to any previous version.</p>
            </div>
          )}

          {lang === "vi" && activeSection === "shortcuts" && (
            <div className="docsSection">
              <h2>Phím tắt</h2>
              <p>Dashboard hỗ trợ các phím tắt để thao tác nhanh hơn.</p>

              <table className="docsTable">
                <thead><tr><th>Phím tắt</th><th>Chức năng</th><th>Hoạt động ở đâu</th></tr></thead>
                <tbody>
                  <tr><td><kbd>Ctrl+K</kbd> hoặc <kbd>⌘K</kbd></td><td>Mở Command Palette — tìm kiếm và chuyển nhanh giữa các trang</td><td>Mọi nơi</td></tr>
                  <tr><td><kbd>Escape</kbd></td><td>Đóng Command Palette, đóng Modal</td><td>Mọi nơi</td></tr>
                  <tr><td><kbd>Enter</kbd></td><td>Gửi message</td><td>Playground</td></tr>
                  <tr><td><kbd>Shift+Enter</kbd></td><td>Xuống dòng mới (không gửi)</td><td>Playground</td></tr>
                </tbody>
              </table>

              <h3>Command Palette</h3>
              <p>Bấm <kbd>Ctrl+K</kbd> hoặc click vào thanh "Search..." trên topbar để mở. Gõ tên trang muốn đến, bấm Enter hoặc click để chuyển trang ngay lập tức.</p>
            </div>
          )}

          {lang === "en" && activeSection === "shortcuts" && (
            <div className="docsSection">
              <h2>Keyboard Shortcuts</h2>
              <p>The dashboard supports keyboard shortcuts for faster navigation.</p>

              <table className="docsTable">
                <thead><tr><th>Shortcut</th><th>Function</th><th>Where it works</th></tr></thead>
                <tbody>
                  <tr><td><kbd>Ctrl+K</kbd> or <kbd>⌘K</kbd></td><td>Open Command Palette — search and quickly navigate between pages</td><td>Everywhere</td></tr>
                  <tr><td><kbd>Escape</kbd></td><td>Close Command Palette, close Modal</td><td>Everywhere</td></tr>
                  <tr><td><kbd>Enter</kbd></td><td>Send message</td><td>Playground</td></tr>
                  <tr><td><kbd>Shift+Enter</kbd></td><td>New line (without sending)</td><td>Playground</td></tr>
                </tbody>
              </table>

              <h3>Command Palette</h3>
              <p>Press <kbd>Ctrl+K</kbd> or click the "Search..." bar on the topbar to open. Type the page name you want to go to, press Enter or click to navigate instantly.</p>
            </div>
          )}

          {lang === "vi" && activeSection === "api" && (
            <div className="docsSection">
              <h2>Tham chiếu Admin API</h2>
              <p>Tất cả endpoint admin yêu cầu header xác thực:</p>
              <pre className="docsCode">Authorization: Bearer your-admin-key</pre>
              <p>Mật khẩu admin là giá trị bạn set trong biến môi trường <code>ADMIN_API_KEYS</code> khi khởi động gateway.</p>

              <h3>Providers & Accounts</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/provider-types</td><td>Danh sách loại provider đã đăng ký</td></tr>
                  <tr><td>GET</td><td>/admin/v1/provider-instances</td><td>Danh sách instance provider đang chạy</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/provider-instances/:id</td><td>Cập nhật cấu hình instance</td></tr>
                  <tr><td>GET</td><td>/admin/v1/accounts</td><td>Danh sách tất cả accounts</td></tr>
                  <tr><td>POST</td><td>/admin/v1/providers/:type/accounts</td><td>Thêm account mới cho provider</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/enable</td><td>Bật account</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/disable</td><td>Tắt account</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/accounts/:id</td><td>Xóa account</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/test</td><td>Test account có hoạt động không</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/refresh-session</td><td>Refresh token cho account</td></tr>
                </tbody>
              </table>

              <h3>Models & Aliases</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/model-mappings</td><td>Danh sách model mappings</td></tr>
                  <tr><td>POST</td><td>/admin/v1/model-mappings</td><td>Tạo model mapping mới</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/model-mappings/:id</td><td>Cập nhật model (bật/tắt, đổi upstream)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/model-mappings/:id</td><td>Xóa model mapping</td></tr>
                  <tr><td>GET</td><td>/admin/v1/model-aliases</td><td>Danh sách aliases</td></tr>
                  <tr><td>POST</td><td>/admin/v1/model-aliases</td><td>Tạo alias mới (body: alias, target)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/model-aliases/:alias</td><td>Xóa alias</td></tr>
                </tbody>
              </table>

              <h3>Routes</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/routing-profiles</td><td>Danh sách routes</td></tr>
                  <tr><td>POST</td><td>/admin/v1/routing-profiles</td><td>Tạo route mới</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/routing-profiles/:id</td><td>Cập nhật route</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/routing-profiles/:id</td><td>Xóa route</td></tr>
                </tbody>
              </table>

              <h3>API Keys & Teams</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/api-keys</td><td>Danh sách API keys</td></tr>
                  <tr><td>POST</td><td>/admin/v1/api-keys</td><td>Tạo key mới (body: owner, teamId, rpmLimit, dailyLimit)</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/api-keys/:id</td><td>Cập nhật key (owner, teamId)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/api-keys/:id</td><td>Xóa key</td></tr>
                  <tr><td>GET</td><td>/admin/v1/api-keys/:id/reveal</td><td>Xem lại giá trị key</td></tr>
                  <tr><td>GET</td><td>/admin/v1/teams</td><td>Danh sách teams</td></tr>
                  <tr><td>POST</td><td>/admin/v1/teams</td><td>Tạo team mới</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/teams/:id</td><td>Cập nhật team</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/teams/:id</td><td>Xóa team</td></tr>
                </tbody>
              </table>

              <h3>Giám sát</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/usage</td><td>Lịch sử sử dụng token</td></tr>
                  <tr><td>GET</td><td>/admin/v1/request-logs</td><td>Danh sách request logs</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/request-logs</td><td>Xóa tất cả request logs</td></tr>
                  <tr><td>GET</td><td>/admin/v1/audit-logs</td><td>Lịch sử thao tác admin</td></tr>
                </tbody>
              </table>

              <h3>Public endpoints (không cần auth)</h3>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>
                Các endpoint công khai cho end-user / khách hàng tra cứu trước khi xin API key.
              </p>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr>
                    <td>GET</td>
                    <td><a href="/pricing.html" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/pricing.html</a></td>
                    <td>Trang HTML tra cứu giá model — share link cho team / khách hàng</td>
                  </tr>
                  <tr>
                    <td>GET</td>
                    <td><a href="/v1/pricing" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/v1/pricing</a></td>
                    <td>JSON API list pricing — fetch để build UI riêng</td>
                  </tr>
                  <tr>
                    <td>GET</td>
                    <td><a href="/v1/public/models" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/v1/public/models</a></td>
                    <td>Public model list — không cần API key, dùng cho landing page</td>
                  </tr>
                </tbody>
              </table>

              <h3>Cài đặt & Webhooks</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/settings/runtime</td><td>Trạng thái các toggle runtime</td></tr>
                  <tr><td>PUT</td><td>/admin/v1/settings/runtime</td><td>Bật/tắt Request Queue</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/change-password</td><td>Đổi mật khẩu admin</td></tr>
                  <tr><td>GET</td><td>/admin/v1/settings/export</td><td>Export toàn bộ state</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/import</td><td>Import state từ JSON</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/reset</td><td>Reset logs (giữ config)</td></tr>
                  <tr><td>GET</td><td>/admin/v1/webhooks</td><td>Cấu hình webhook hiện tại</td></tr>
                  <tr><td>PUT</td><td>/admin/v1/webhooks</td><td>Cập nhật webhook (enabled, url, events)</td></tr>
                  <tr><td>POST</td><td>/admin/v1/webhooks/test</td><td>Gửi thông báo test</td></tr>
                </tbody>
              </table>

              <h3>Chat Completions (User API)</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Mô tả</th></tr></thead>
                <tbody>
                  <tr><td>POST</td><td>/v1/chat/completions</td><td>Gửi chat request (OpenAI-compatible). Header: Authorization: Bearer internal-api-key</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {lang === "en" && activeSection === "api" && (
            <div className="docsSection">
              <h2>Admin API Reference</h2>
              <p>All admin endpoints require an authentication header:</p>
              <pre className="docsCode">Authorization: Bearer your-admin-key</pre>
              <p>The admin password is the value you set in the <code>ADMIN_API_KEYS</code> environment variable when starting the gateway.</p>

              <h3>Providers & Accounts</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/provider-types</td><td>List registered provider types</td></tr>
                  <tr><td>GET</td><td>/admin/v1/provider-instances</td><td>List running provider instances</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/provider-instances/:id</td><td>Update instance configuration</td></tr>
                  <tr><td>GET</td><td>/admin/v1/accounts</td><td>List all accounts</td></tr>
                  <tr><td>POST</td><td>/admin/v1/providers/:type/accounts</td><td>Add new account for a provider</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/enable</td><td>Enable account</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/disable</td><td>Disable account</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/accounts/:id</td><td>Delete account</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/test</td><td>Test if account is working</td></tr>
                  <tr><td>POST</td><td>/admin/v1/accounts/:id/refresh-session</td><td>Refresh token for account</td></tr>
                </tbody>
              </table>

              <h3>Models & Aliases</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/model-mappings</td><td>List model mappings</td></tr>
                  <tr><td>POST</td><td>/admin/v1/model-mappings</td><td>Create new model mapping</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/model-mappings/:id</td><td>Update model (enable/disable, change upstream)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/model-mappings/:id</td><td>Delete model mapping</td></tr>
                  <tr><td>GET</td><td>/admin/v1/model-aliases</td><td>List aliases</td></tr>
                  <tr><td>POST</td><td>/admin/v1/model-aliases</td><td>Create new alias (body: alias, target)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/model-aliases/:alias</td><td>Delete alias</td></tr>
                </tbody>
              </table>

              <h3>Routes</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/routing-profiles</td><td>List routes</td></tr>
                  <tr><td>POST</td><td>/admin/v1/routing-profiles</td><td>Create new route</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/routing-profiles/:id</td><td>Update route</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/routing-profiles/:id</td><td>Delete route</td></tr>
                </tbody>
              </table>

              <h3>API Keys & Teams</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/api-keys</td><td>List API keys</td></tr>
                  <tr><td>POST</td><td>/admin/v1/api-keys</td><td>Create new key (body: owner, teamId, rpmLimit, dailyLimit)</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/api-keys/:id</td><td>Update key (owner, teamId)</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/api-keys/:id</td><td>Delete key</td></tr>
                  <tr><td>GET</td><td>/admin/v1/api-keys/:id/reveal</td><td>Reveal key value</td></tr>
                  <tr><td>GET</td><td>/admin/v1/teams</td><td>List teams</td></tr>
                  <tr><td>POST</td><td>/admin/v1/teams</td><td>Create new team</td></tr>
                  <tr><td>PATCH</td><td>/admin/v1/teams/:id</td><td>Update team</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/teams/:id</td><td>Delete team</td></tr>
                </tbody>
              </table>

              <h3>Monitoring</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/usage</td><td>Token usage history</td></tr>
                  <tr><td>GET</td><td>/admin/v1/request-logs</td><td>List request logs</td></tr>
                  <tr><td>DELETE</td><td>/admin/v1/request-logs</td><td>Delete all request logs</td></tr>
                  <tr><td>GET</td><td>/admin/v1/audit-logs</td><td>Admin action history</td></tr>
                </tbody>
              </table>

              <h3>Public endpoints (no auth required)</h3>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>
                Public endpoints for end-users to inspect before requesting an API key.
              </p>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr>
                    <td>GET</td>
                    <td><a href="/pricing.html" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/pricing.html</a></td>
                    <td>Pricing lookup HTML page — shareable link for team / customers</td>
                  </tr>
                  <tr>
                    <td>GET</td>
                    <td><a href="/v1/pricing" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/v1/pricing</a></td>
                    <td>Pricing JSON API — fetch to build your own UI</td>
                  </tr>
                  <tr>
                    <td>GET</td>
                    <td><a href="/v1/public/models" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary, #3b82f6)" }}>/v1/public/models</a></td>
                    <td>Public model list — no API key needed, useful for landing pages</td>
                  </tr>
                </tbody>
              </table>

              <h3>Settings & Webhooks</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>GET</td><td>/admin/v1/settings/runtime</td><td>Runtime toggle states</td></tr>
                  <tr><td>PUT</td><td>/admin/v1/settings/runtime</td><td>Enable/disable Request Queue</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/change-password</td><td>Change admin password</td></tr>
                  <tr><td>GET</td><td>/admin/v1/settings/export</td><td>Export entire state</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/import</td><td>Import state from JSON</td></tr>
                  <tr><td>POST</td><td>/admin/v1/settings/reset</td><td>Reset logs (keep config)</td></tr>
                  <tr><td>GET</td><td>/admin/v1/webhooks</td><td>Current webhook configuration</td></tr>
                  <tr><td>PUT</td><td>/admin/v1/webhooks</td><td>Update webhook (enabled, url, events)</td></tr>
                  <tr><td>POST</td><td>/admin/v1/webhooks/test</td><td>Send test notification</td></tr>
                </tbody>
              </table>

              <h3>Chat Completions (User API)</h3>
              <table className="docsTable docsTable--api">
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                  <tr><td>POST</td><td>/v1/chat/completions</td><td>Send chat request (OpenAI-compatible). Header: Authorization: Bearer internal-api-key</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeSection === "media-providers" && (
            <div className="docsSection">
              <h2>🎨 Media Providers</h2>
              <p>{lang === "vi" ? "AI Gateway hỗ trợ routing media requests qua cùng hạ tầng multi-account pooling và proxy như LLM chat. Tất cả media endpoints sử dụng OpenAI-compatible request/response format." : "AI Gateway supports routing media requests through the same multi-account pooling and proxy infrastructure as LLM chat. All media endpoints use OpenAI-compatible request/response formats."}</p>

              <h3>{lang === "vi" ? "Các loại Media hỗ trợ" : "Supported Media Types"}</h3>
              <table className="docsTable">
                <thead><tr><th>{lang === "vi" ? "Loại" : "Kind"}</th><th>Endpoint</th><th>{lang === "vi" ? "Providers hỗ trợ" : "Supported Providers"}</th></tr></thead>
                <tbody>
                  <tr><td><strong>Embedding</strong></td><td><code>POST /v1/embeddings</code></td><td>OpenAI, Gemini, Voyage AI, Jina AI, Fireworks, Together, Nebius, NVIDIA</td></tr>
                  <tr><td><strong>Image Generation</strong></td><td><code>POST /v1/images/generations</code></td><td>Codex (ChatGPT), OpenAI, Gemini, Stability AI, BFL, Fal.ai, Cloudflare, HuggingFace, Runway, NanoBanana</td></tr>
                  <tr><td><strong>Text to Speech</strong></td><td><code>POST /v1/audio/speech</code></td><td>OpenAI, ElevenLabs, Deepgram, MiniMax, Gemini, NVIDIA, Cartesia, PlayHT, Google TTS*, Edge TTS*</td></tr>
                  <tr><td><strong>Speech to Text</strong></td><td><code>POST /v1/audio/transcriptions</code></td><td>OpenAI, Groq, Deepgram, Gemini, HuggingFace, NVIDIA</td></tr>
                  <tr><td><strong>Web Search</strong></td><td><code>POST /v1/search</code></td><td>Tavily, Brave, Serper, Exa, Perplexity, SearXNG*, Google PSE, Linkup, SearchAPI, You.com</td></tr>
                  <tr><td><strong>Web Fetch</strong></td><td><code>POST /v1/web/fetch</code></td><td>Firecrawl, Jina Reader, Tavily Extract, Exa</td></tr>
                </tbody>
              </table>
              <p><em>* {lang === "vi" ? "Provider miễn phí (không cần API key)" : "Free providers (no API key required)"}</em></p>

              <h3>{lang === "vi" ? "Quy tắc đặt tên Model" : "Model Naming Convention"}</h3>
              <p>{lang === "vi" ? "Models sử dụng format" : "Models use"} <code>provider-alias/model-id</code>{lang === "vi" ? " để routing:" : " format for routing:"}</p>
              <pre className="docsCode">{`# Provider Aliases
cx  = Codex (ChatGPT)     oa  = OpenAI        gm  = Gemini
an  = Anthropic           cf  = Cloudflare    gh  = GitHub
el  = ElevenLabs          dg  = Deepgram      st  = Stability AI
bf  = Black Forest Labs   fa  = Fal.ai        hf  = HuggingFace
rw  = Runway              tv  = Tavily        bv  = Brave
sp  = Serper              sx  = SearXNG       fc  = Firecrawl
ja  = Jina AI             va  = Voyage AI     mm  = MiniMax

# Examples
cx/gpt-5.5-image            → Codex image generation
oa/dall-e-3                 → OpenAI DALL-E 3
gm/gemini-2.5-flash-image   → Gemini image generation
st/sd3-large                → Stability AI SD3
oa/tts-1                    → OpenAI TTS
el/eleven_multilingual_v2   → ElevenLabs
google-tts/vi               → Google TTS Vietnamese (free)
edge-tts/vi-VN-HoaiMyNeural → Edge TTS Vietnamese (free)
oa/text-embedding-3-small   → OpenAI Embedding
tv/search                   → Tavily Search
sx/general                  → SearXNG (free)`}</pre>

              <h3>{lang === "vi" ? "Provider miễn phí (không cần API key)" : "Free Providers (No API Key)"}</h3>
              <table className="docsTable">
                <thead><tr><th>Provider</th><th>{lang === "vi" ? "Loại" : "Kind"}</th><th>{lang === "vi" ? "Ghi chú" : "Notes"}</th></tr></thead>
                <tbody>
                  <tr><td><strong>Google TTS</strong></td><td>Text to Speech</td><td>{lang === "vi" ? "58 ngôn ngữ, sử dụng Google Translate API" : "58 languages, uses Google Translate API"}</td></tr>
                  <tr><td><strong>Edge TTS</strong></td><td>Text to Speech</td><td>{lang === "vi" ? "400+ giọng neural, sử dụng Microsoft Edge" : "400+ neural voices, uses Microsoft Edge"}</td></tr>
                  <tr><td><strong>SearXNG</strong></td><td>Web Search</td><td>{lang === "vi" ? "Self-hosted, không cần auth" : "Self-hosted, no auth required"}</td></tr>
                </tbody>
              </table>

              <h3>{lang === "vi" ? "Ví dụ Request" : "Request Examples"}</h3>

              <h4>Image Generation (Codex SSE)</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{
    "model": "cx/gpt-5.5-image",
    "prompt": "A cute cat wearing a hat",
    "size": "1024x1024",
    "quality": "hd",
    "output_format": "png"
  }'

# Response: {"created": 1234567890, "data": [{"b64_json": "iVBORw0KGgo..."}]}`}</pre>

              <h4>Text to Speech (Google TTS — Free)</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{"model": "google-tts/vi", "input": "Xin chào thế giới"}' \\
  --output speech.mp3

# Response: Binary MP3 audio`}</pre>

              <h4>Speech to Text (Multipart)</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/audio/transcriptions \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -F "file=@audio.wav" \\
  -F "model=oa/whisper-1" \\
  -F "language=en"

# Response: {"text": "Hello, this is a transcription."}`}</pre>

              <h4>Embeddings</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{"model": "oa/text-embedding-3-small", "input": "Hello world", "dimensions": 512}'

# Response: {"data": [{"embedding": [0.1, -0.2, ...], "index": 0}], "model": "...", "usage": {...}}`}</pre>

              <h4>Web Search</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/search \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{"query": "latest AI news", "max_results": 5, "search_type": "news"}'

# Response: {"results": [{"title": "...", "url": "...", "snippet": "..."}], "provider": "tavily"}`}</pre>

              <h4>Web Fetch</h4>
              <pre className="docsCode">{`curl -X POST http://localhost:3100/v1/web/fetch \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -d '{"url": "https://example.com", "format": "markdown"}'

# Response: {"provider": "firecrawl", "content": {"format": "markdown", "text": "...", "length": 1234}}`}</pre>

              <h3>{lang === "vi" ? "Xử lý lỗi" : "Error Handling"}</h3>
              <pre className="docsCode">{`# Common error responses:
{"error": {"type": "no_provider_available", "code": "no_provider_available"}}
  → No provider configured for this media kind

{"error": {"type": "model_not_found", "code": "model_not_found", "available_models": [...]}}
  → Model not found, response includes available alternatives

{"error": {"type": "no_provider_available", "code": "no_available_account"}}
  → All accounts exhausted or rate limited

{"error": {"type": "upstream_error", "code": "upstream_error"}}
  → Provider API returned an error`}</pre>

              <h3>{lang === "vi" ? "Tính năng Dashboard" : "Dashboard Features"}</h3>
              <ul>
                <li><strong>{lang === "vi" ? "Catalog 50+ providers" : "50+ Provider Catalog"}</strong> — {lang === "vi" ? "Duyệt providers theo loại media" : "Browse providers by media kind"}</li>
                <li><strong>{lang === "vi" ? "Quản lý Account" : "Account Management"}</strong> — {lang === "vi" ? "Thêm API keys, test kết nối, health check" : "Add API keys, test connections, health check"}</li>
                <li><strong>{lang === "vi" ? "Live Testing" : "Live Testing"}</strong> — {lang === "vi" ? "Playground tương tác với preview ảnh, audio player" : "Interactive playground with image preview, audio player"}</li>
                <li><strong>{lang === "vi" ? "Tích hợp Proxy" : "Proxy Integration"}</strong> — {lang === "vi" ? "Route qua SOCKS5/HTTP proxies" : "Route through SOCKS5/HTTP proxies per account"}</li>
                <li><strong>{lang === "vi" ? "Auto-sync" : "Auto-sync"}</strong> — {lang === "vi" ? "Provider configs tự động cập nhật khi khởi động" : "Provider configs auto-update on startup"}</li>
              </ul>
            </div>
          )}

          {activeSection === "proxy-pools" && (
            <div className="docsSection">
              <h2>🔀 Proxy Pools</h2>
              <p>{lang === "vi" ? "Proxy pools cho phép route gateway requests qua SOCKS5/HTTP proxies hoặc Vercel relay endpoints. Hữu ích để bypass IP-based rate limits hoặc geo-restrictions." : "Proxy pools let you route gateway requests through SOCKS5/HTTP proxies or Vercel relay endpoints. Useful for bypassing IP-based rate limits or geo-restrictions."}</p>

              <h3>{lang === "vi" ? "Khái niệm" : "Concepts"}</h3>
              <table className="docsTable">
                <thead><tr><th>{lang === "vi" ? "Thuật ngữ" : "Term"}</th><th>{lang === "vi" ? "Mô tả" : "Description"}</th></tr></thead>
                <tbody>
                  <tr><td><strong>Proxy Pool</strong></td><td>{lang === "vi" ? "Tập hợp proxy URLs có tên, với health tracking" : "A named collection of proxy URLs with health tracking"}</td></tr>
                  <tr><td><strong>Vercel Relay</strong></td><td>{lang === "vi" ? "Serverless relay trên Vercel chuyển tiếp requests" : "A serverless relay deployed on Vercel that forwards requests"}</td></tr>
                  <tr><td><strong>Strict mode</strong></td><td>{lang === "vi" ? "Proxy lỗi → request lỗi (không fallback direct)" : "If proxy fails, request fails (no direct fallback)"}</td></tr>
                  <tr><td><strong>Non-strict mode</strong></td><td>{lang === "vi" ? "Proxy lỗi → fallback kết nối trực tiếp" : "If proxy fails, falls back to direct connection"}</td></tr>
                </tbody>
              </table>

              <h3>{lang === "vi" ? "Tạo Proxy Pool" : "Creating a Proxy Pool"}</h3>
              <p>{lang === "vi" ? "Dashboard → Proxy Pools → Add Pool, hoặc qua API:" : "Dashboard → Proxy Pools → Add Pool, or via API:"}</p>
              <pre className="docsCode">{`# SOCKS5 Proxy
curl -X POST http://localhost:3100/admin/v1/proxy-pools \\
  -H "Authorization: Bearer ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Proxies",
    "type": "socks5",
    "proxyUrl": "socks5://user:pass@proxy.example.com:1080",
    "strictProxy": false
  }'

# Vercel Relay
curl -X POST http://localhost:3100/admin/v1/proxy-pools \\
  -H "Authorization: Bearer ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Vercel Relay",
    "type": "vercel",
    "proxyUrl": "https://my-relay.vercel.app",
    "strictProxy": false
  }'`}</pre>

              <h3>{lang === "vi" ? "Batch Import" : "Batch Import"}</h3>
              <p>{lang === "vi" ? "Dashboard → Proxy Pools → Batch Import — paste danh sách proxy URLs (mỗi dòng 1 URL):" : "Dashboard → Proxy Pools → Batch Import — paste a list of proxy URLs (one per line):"}</p>
              <pre className="docsCode">{`socks5://user:pass@1.2.3.4:1080
http://user:pass@5.6.7.8:8080
socks5://9.10.11.12:1080
https://my-relay-1.vercel.app
https://my-relay-2.vercel.app`}</pre>

              <h3>{lang === "vi" ? "Health Testing" : "Health Testing"}</h3>
              <p>{lang === "vi" ? "Dashboard → Proxy Pools → chọn pool → Health Check. Gateway test mỗi proxy bằng request đến endpoint đã biết và đánh dấu proxy active/dead. Dead proxies tự động bị disable." : "Dashboard → Proxy Pools → select pool → Health Check. The gateway tests each proxy by making a request to a known endpoint and marks proxies as active/dead. Dead proxies are automatically disabled."}</p>

              <h3>{lang === "vi" ? "Gán cho Provider Account" : "Assigning to Provider Accounts"}</h3>
              <p>{lang === "vi" ? "Dashboard → Providers → chọn provider → chọn account → Proxy Pool dropdown. Tất cả requests từ account đó sẽ route qua proxy pool được gán." : "Dashboard → Providers → select provider → select account → Proxy Pool dropdown. All requests from that account will route through the assigned proxy pool."}</p>

              <h3>{lang === "vi" ? "No-Proxy Patterns" : "No-Proxy Patterns"}</h3>
              <p>{lang === "vi" ? "Loại trừ domains cụ thể khỏi proxy routing:" : "Exclude specific domains from proxy routing:"}</p>
              <pre className="docsCode">{`{
  "noProxy": "localhost,127.0.0.1,*.internal.company.com"
}`}</pre>

              <h3>{lang === "vi" ? "Cách hoạt động" : "How It Works"}</h3>
              <pre className="docsCode">{`Request → MediaRouter/ChatRouter
  │
  ├─ Account has proxyPoolId?
  │   ├─ YES → Resolve pool → proxyAwareFetch(url, proxyOptions)
  │   │         ├─ Pool type "vercel" → Forward via Vercel relay URL
  │   │         └─ Pool type "socks5"/"http" → Connect via SOCKS5/HTTP proxy
  │   │
  │   └─ NO → Direct fetch (no proxy)
  │
  └─ strictProxy?
      ├─ true  → Proxy fails = request fails
      └─ false → Proxy fails = retry direct`}</pre>
            </div>
          )}

        </article>
      </div>
    </div>
  );
}
function WebhookConfigCard({ api }: { api: ReturnType<typeof createApiClient> }) {
  const { t } = useLang();
  const [config, setConfig] = useState({ enabled: false, url: "", events: [] as string[] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.get<{ enabled: boolean; url: string; events: string[] }>("/admin/v1/webhooks")
      .then((c) => { setConfig(c); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [api]);

  async function save() {
    try {
      await api.put("/admin/v1/webhooks", config);
      showToast("success", t("webhook.saved"));
    } catch {
      showToast("error", t("webhook.saveFailed"));
    }
  }

  async function test() {
    try {
      await api.post("/admin/v1/webhooks/test", {});
      showToast("info", t("webhook.testSent"));
    } catch {
      showToast("error", t("webhook.testFailed"));
    }
  }

  if (!loaded) return null;

  return (
    <article className="endpointCard">
      <header className="endpointCardHeader">
        <Zap size={18} />
        <h2>{t("webhook.title")}</h2>
      </header>
      <div className="settingsRow">
        <div>
          <strong>{t("webhook.enable")}</strong>
          <span>{t("webhook.enableDesc")}</span>
        </div>
        <label className="toggleSwitch">
          <input type="checkbox" checked={config.enabled} onChange={() => setConfig({ ...config, enabled: !config.enabled })} />
          <span className="toggleSlider" />
        </label>
      </div>
      {config.enabled && (
        <>
          <div className="settingsRow" style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
            <label className="pgField">
              <span>{t("webhook.url")}</span>
              <input
                type="text"
                value={config.url}
                onChange={(e) => setConfig({ ...config, url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/... or https://hooks.slack.com/..."
              />
            </label>
          </div>
          <div className="settingsRow" style={{ gap: "8px" }}>
            <button className="endpointKeyBtn" onClick={() => void save()}>{t("webhook.save")}</button>
            <button className="endpointKeyBtn" onClick={() => void test()} disabled={!config.url}>{t("webhook.test")}</button>
          </div>
        </>
      )}
    </article>
  );
}

function EmptyDataset(props: { icon: typeof Activity; title: string; rows: number }) {
  const Icon = props.icon;
  return (
    <section className="emptyState">
      <Icon size={24} />
      <h3>{props.title}</h3>
      <p>{props.rows} rows</p>
    </section>
  );
}

function Metric(props: { icon: typeof Activity; label: string; value: number; detail: string }) {
  const Icon = props.icon;
  return (
    <div className="metric">
      <div className="metricHeader">
        <span>{props.label}</span>
        <div className="metricIcon"><Icon size={18} /></div>
      </div>
      <strong>{props.value.toLocaleString()}</strong>
      <p>{props.detail}</p>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0 || data.every((v) => v === 0)) return null;
  const w = 120, h = 28, pad = 2;
  const max = Math.max(...data, 1);
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => ({
    x: pad + i * step,
    y: h - pad - (v / max) * (h - pad * 2)
  }));
  const line = pts.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const cpx = (prev.x + p.x) / 2;
    return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
  }).join(" ");
  const area = `${line} L ${pts[pts.length - 1].x} ${h} L ${pad} ${h} Z`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill="url(#sparkGrad)" />
      <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function StatusBadge(props: {
  status: "active" | "cooldown" | "disabled";
  label: string;
}) {
  const Icon = props.status === "active" ? CheckCircle2 : props.status === "cooldown" ? Activity : XCircle;
  return <span className={`statusBadge ${props.status}`}><Icon size={13} />{props.label}</span>;
}

function StatusCode({ code }: { code: number }) {
  const status = code >= 500 ? "disabled" : code >= 400 ? "cooldown" : "active";
  return <StatusBadge status={status} label={String(code)} />;
}

function ProviderLogo(props: { providerType: string; displayName: string }) {
  const logoMap: Record<string, string> = {
    kiro: "/provider-logos/kiro.png",
    mock: "/provider-logos/mock.png"
  };
  const logo = logoMap[props.providerType];

  return (
    <div className="providerIconTile">
      {logo ? (
        <img src={logo} alt="" aria-hidden="true" />
      ) : (
        <span>{props.displayName.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}

function DataTable(props: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column}>
                <span className="thContent">
                  {columnIcon(column)}
                  {column}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellClass(cell, props.columns[cellIndex])}>
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="tableEmpty" colSpan={props.columns.length}>
                <div>
                  <Database size={18} />
                  <span>No records yet</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function cellClass(cell: React.ReactNode, column: string): string | undefined {
  if (typeof cell !== "string") {
    return undefined;
  }

  const lowerColumn = column.toLowerCase();
  if (
    lowerColumn.includes("id") ||
    lowerColumn.includes("hash") ||
    lowerColumn.includes("key") ||
    lowerColumn.includes("actor") ||
    lowerColumn.includes("request")
  ) {
    return "monoCell";
  }

  return undefined;
}

function formatCell(cell: React.ReactNode) {
  if (typeof cell !== "string") {
    return cell;
  }

  if (cell.length > 42) {
    return <code title={cell}>{cell}</code>;
  }

  return cell;
}

function columnIcon(column: string) {
  const normalized = column.toLowerCase();

  if (!column.trim()) {
    return null;
  }

  if (normalized.includes("status")) {
    return <Activity size={13} />;
  }

  if (normalized.includes("key") || normalized.includes("hash") || normalized.includes("actor")) {
    return <KeyRound size={13} />;
  }

  if (normalized.includes("provider") || normalized.includes("instance")) {
    return <Network size={13} />;
  }

  if (normalized.includes("request") || normalized.includes("route")) {
    return <Route size={13} />;
  }

  if (normalized.includes("time") || normalized.includes("published")) {
    return <ScrollText size={13} />;
  }

  if (normalized.includes("prompt") || normalized.includes("completion") || normalized.includes("total")) {
    return <Gauge size={13} />;
  }

  if (normalized.includes("version") || normalized.includes("config")) {
    return <Hash size={13} />;
  }

  return null;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatLimit(used = 0, limit = 0): string {
  return limit > 0 ? `${used}/${limit}` : `${used}/unlimited`;
}

function isQuotaExhausted(
  limits?: {
    minuteRequests?: number;
    requestsPerMinuteLimit?: number;
    dailyRequests?: number;
    dailyRequestQuota?: number;
    dailyTokens?: number;
    dailyTokenQuota?: number;
  }
): boolean {
  if (!limits) return false;
  const rpmHit = (limits.requestsPerMinuteLimit ?? 0) > 0 &&
    (limits.minuteRequests ?? 0) >= (limits.requestsPerMinuteLimit ?? 0);
  const dailyHit = (limits.dailyRequestQuota ?? 0) > 0 &&
    (limits.dailyRequests ?? 0) >= (limits.dailyRequestQuota ?? 0);
  const tokenHit = (limits.dailyTokenQuota ?? 0) > 0 &&
    (limits.dailyTokens ?? 0) >= (limits.dailyTokenQuota ?? 0);
  return rpmHit || dailyHit || tokenHit;
}

function formatTokenTimeLeft(ms: number): string {
  if (ms <= 0) return "Expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function makeAccountId(providerType: string): string {
  return `account_${providerType}_${Date.now().toString(36)}`;
}

function getAuthPresets(providerType: string, authMethods: string[] = []): AuthPreset[] {
  const presetsByProvider: Record<string, AuthPreset[]> = {
    kiro: [
      oauthPreset("kiro"),
      {
        id: "kiro_api_key",
        label: "Kiro API Key (ksk_)",
        credentialType: "custom_json",
        description: "Use a Kiro API key generated from app.kiro.dev portal. Works directly without token refresh.",
        fields: [
          { key: "kiroApiKey", label: "Kiro API Key", type: "password", required: true, placeholder: "ksk_..." },
          { key: "authMethod", label: "Auth Method", type: "hidden", placeholder: "api_key" }
        ]
      },
      {
        id: "kiro_refresh",
        label: "Refresh Token",
        credentialType: "refresh_token",
        description: "Best for long-lived Kiro sessions with automatic token refresh.",
        fields: [
          { key: "refreshToken", label: "Refresh Token", type: "password", required: true },
          { key: "accessToken", label: "Access Token", type: "password", placeholder: "Optional current access token" },
          { key: "region", label: "Region", placeholder: "us-east-1" },
          { key: "expiresAt", label: "Access Token Expires", type: "datetime-local" }
        ]
      },
      {
        id: "kiro_idc",
        label: "IDC (Enterprise)",
        credentialType: "custom_json",
        description: "IAM Identity Center — requires refreshToken + clientId + clientSecret from AWS SSO.",
        fields: [
          { key: "refreshToken", label: "Refresh Token", type: "password", required: true },
          { key: "clientId", label: "Client ID", type: "text", required: true },
          { key: "clientSecret", label: "Client Secret", type: "password", required: true },
          { key: "region", label: "Region", placeholder: "us-east-1" },
          { key: "authMethod", label: "Auth Method", type: "hidden", placeholder: "idc" }
        ]
      },
      {
        id: "kiro_bearer",
        label: "Bearer Token",
        credentialType: "bearer_token",
        description: "Use a current Kiro access token. Rotate it when expired.",
        fields: [
          { key: "accessToken", label: "Bearer / Access Token", type: "password", required: true },
          { key: "region", label: "Region", placeholder: "us-east-1" },
          { key: "expiresAt", label: "Expires At", type: "datetime-local" }
        ]
      },
      customJsonPreset()
    ],
    windsurf: [
      oauthPreset("windsurf"),
      {
        id: "windsurf_bearer",
        label: "Bearer Token",
        credentialType: "bearer_token",
        description: "Use the active Windsurf token from your local/client session.",
        fields: [
          { key: "token", label: "Token", type: "password", required: true },
          { key: "expiresAt", label: "Expires At", type: "datetime-local" }
        ]
      },
      {
        id: "windsurf_refresh",
        label: "Refresh Token",
        credentialType: "refresh_token",
        description: "Store refresh credentials for a reusable Windsurf account.",
        fields: [
          { key: "refreshToken", label: "Refresh Token", type: "password", required: true },
          { key: "accessToken", label: "Access Token", type: "password", placeholder: "Optional current access token" },
          { key: "expiresAt", label: "Access Token Expires", type: "datetime-local" }
        ]
      },
      customJsonPreset()
    ],
    mock: [
      {
        id: "mock_api_key",
        label: "API Key",
        credentialType: "api_key",
        description: "Simple API-key credential for local mock testing.",
        fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }]
      }
    ]
  };

  const basePresets = presetsByProvider[providerType] ?? genericAuthPresets(authMethods);
  return basePresets.filter((preset) => authMethods.length === 0 || authMethods.includes(preset.credentialType));
}

function genericAuthPresets(authMethods: string[]): AuthPreset[] {
  const presets: AuthPreset[] = [
    {
      id: "oauth",
      label: "OAuth Link",
      credentialType: "oauth",
      description: "Generate an authorization link and capture the local callback code.",
      fields: oauthFields()
    },
    {
      id: "api_key",
      label: "API Key",
      credentialType: "api_key",
      description: "Store a provider API key.",
      fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }]
    },
    {
      id: "bearer_token",
      label: "Bearer Token",
      credentialType: "bearer_token",
      description: "Store a bearer access token.",
      fields: [
        { key: "token", label: "Bearer Token", type: "password", required: true },
        { key: "expiresAt", label: "Expires At", type: "datetime-local" }
      ]
    },
    {
      id: "refresh_token",
      label: "Refresh Token",
      credentialType: "refresh_token",
      description: "Store refresh-token based login material.",
      fields: [
        { key: "refreshToken", label: "Refresh Token", type: "password", required: true },
        { key: "accessToken", label: "Access Token", type: "password" }
      ]
    },
    {
      id: "session_cookie",
      label: "Session Cookie",
      credentialType: "session_cookie",
      description: "Store cookie/session material exported from a logged-in browser.",
      fields: [{ key: "cookie", label: "Cookie", type: "textarea", required: true }]
    },
    customJsonPreset()
  ];

  return authMethods.length
    ? presets.filter((preset) => authMethods.includes(preset.credentialType))
    : presets;
}

function customJsonPreset(): AuthPreset {
  return {
    id: "custom_json",
    label: "Custom JSON",
    credentialType: "custom_json",
    description: "Paste an exact provider credential payload when using an advanced login flow.",
    fields: [
      {
        key: "json",
        label: "Credential JSON",
        type: "textarea",
        required: true,
        placeholder: "{\n  \"accessToken\": \"...\",\n  \"refreshToken\": \"...\"\n}"
      }
    ]
  };
}

function oauthPreset(providerType: string): AuthPreset {
  return {
    id: `${providerType}_oauth`,
    label: "OAuth Link",
    credentialType: "oauth",
    description: "Open an authorization URL in a signed-in browser, then capture the callback code locally.",
    fields: oauthFields(providerType)
  };
}

function oauthFields(providerType = "provider"): AuthPreset["fields"] {
  if (providerType === "windsurf") {
    return [
      {
        key: "authorizationEndpoint",
        label: "Authorization Endpoint",
        placeholder: "https://www.windsurf.com/windsurf/signin",
        required: true
      },
      {
        key: "clientId",
        label: "Client ID",
        placeholder: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
        required: true
      },
      {
        key: "redirectUri",
        label: "Redirect URI",
        placeholder: "http://127.0.0.1:3100/windsurf-auth-callback",
        required: true
      },
      { key: "prompt", label: "Prompt", placeholder: "login" },
      { key: "redirectParametersType", label: "Redirect Parameters Type", placeholder: "query" },
      { key: "workflow", label: "Workflow", placeholder: "onboarding" },
      { key: "state", label: "State", required: true },
      { key: "code", label: "Token / Code", placeholder: "Captured after callback" },
      { key: "callbackQuery", label: "Callback Query", type: "textarea", placeholder: "Captured callback payload" }
    ];
  }

  return [
      {
        key: "authorizationEndpoint",
        label: "Authorization Endpoint",
        placeholder:
          providerType === "kiro"
            ? "https://app.kiro.dev/signin"
            : `https://auth.${providerType}.example/oauth/authorize`,
        required: true
      },
      ...(providerType === "kiro"
        ? [{ key: "idp", label: "Identity Provider", placeholder: "Google" }]
        : []),
      { key: "clientId", label: "Client ID" },
      {
        key: "redirectUri",
        label: "Redirect URI",
        placeholder:
          providerType === "kiro"
            ? "http://localhost:3128"
            : "http://127.0.0.1:3100/oauth/callback",
        required: true
      },
    { key: "scope", label: "Scope", placeholder: "openid profile offline_access" },
    { key: "redirectFrom", label: "Redirect From", placeholder: "KiroIDE" },
    { key: "state", label: "State", required: true },
    { key: "code", label: "Authorization Code", placeholder: "Captured after callback" },
    { key: "callbackQuery", label: "Callback Query", type: "textarea", placeholder: "Captured callback payload" }
  ];
}

function getDefaultCredentialValues(preset: AuthPreset): Record<string, string> {
  return Object.fromEntries(
    preset.fields.map((field) => [
      field.key,
      defaultCredentialFieldValue(field)
    ])
  );
}

function defaultCredentialFieldValue(field: AuthPreset["fields"][number]): string {
  if (field.key === "json") {
    return field.placeholder ?? "{\n}";
  }

  if (field.key === "redirectUri") {
    return field.placeholder ?? "http://127.0.0.1:3100/oauth/callback";
  }

  if (field.key === "authorizationEndpoint" && field.placeholder?.startsWith("https://")) {
    return field.placeholder;
  }

  if (field.key === "redirectFrom") {
    return field.placeholder ?? "";
  }

  if (
    ["clientId", "prompt", "redirectParametersType", "workflow"].includes(field.key)
  ) {
    return field.placeholder ?? "";
  }

  if (field.key === "state") {
    return crypto.randomUUID();
  }

  return "";
}

function defaultOAuthEndpoint(providerType: string): string {
  return providerType === "windsurf"
    ? "https://www.windsurf.com/windsurf/signin"
    : "https://app.kiro.dev/signin";
}

function defaultOAuthRedirectUri(providerType: string): string {
  if (providerType === "kiro") {
    return "http://localhost:3128";
  }
  if (providerType === "codex") {
    return "http://127.0.0.1:1455/auth/callback";
  }

  return providerType === "windsurf"
    ? "http://127.0.0.1:3100/windsurf-auth-callback"
    : "http://127.0.0.1:3100/oauth/callback";
}

function defaultOAuthClientId(providerType: string): string {
  return providerType === "windsurf" ? "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u" : "";
}

function oauthExtraParams(providerType: string, values: Record<string, string>): Record<string, string> | undefined {
  if (providerType === "kiro") {
    return {
      idp: values.idp || "Google",
      prompt: "select_account"
    };
  }

  if (providerType === "windsurf") {
    return {
      prompt: values.prompt || "login",
      redirect_parameters_type: values.redirectParametersType || "query",
      workflow: values.workflow || "onboarding"
    };
  }

  return undefined;
}

function isLikelyCallbackUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function buildCredentialPayload(preset: AuthPreset, values: Record<string, string>): Record<string, unknown> {
  if (preset.credentialType === "custom_json" && preset.fields.length === 1 && preset.fields[0].key === "json") {
    return JSON.parse(values.json || "{}") as Record<string, unknown>;
  }

  const payload: Record<string, unknown> = {};

  for (const field of preset.fields) {
    const value = values[field.key]?.trim();
    if (!value && field.type === "hidden") {
      // Use placeholder as default for hidden fields
      if (field.placeholder) {
        payload[field.key] = field.placeholder;
      }
      continue;
    }
    if (!value) {
      continue;
    }

    if (field.key === "expiresAt" && value) {
      payload.expiresAt = new Date(value).toISOString();
      continue;
    }

    payload[field.key] = value;
  }

  if (preset.credentialType === "bearer_token" && typeof payload.accessToken === "string" && !payload.token) {
    payload.token = payload.accessToken;
  }

  return payload;
}

function buildAuthorizationUrl(values: Record<string, string>): string {
  const authorizationEndpoint = values.authorizationEndpoint?.trim();

  if (!authorizationEndpoint) {
    return "";
  }

  try {
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    if (values.clientId?.trim()) {
      url.searchParams.set("client_id", values.clientId.trim());
    }
    if (values.redirectUri?.trim()) {
      url.searchParams.set("redirect_uri", values.redirectUri.trim());
    }
    if (values.scope?.trim()) {
      url.searchParams.set("scope", values.scope.trim());
    }
    if (values.state?.trim()) {
      url.searchParams.set("state", values.state.trim());
    }
    return url.toString();
  } catch {
    return "";
  }
}

function createApiClient(adminKey: string) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${adminKey}`);

    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    async getList<T>(path: string): Promise<T[]> {
      const payload = await request<{ data: T[] }>(path);
      return payload.data;
    },
    get<T>(path: string): Promise<T> {
      return request<T>(path);
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return request<T>(path, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
    },
    put<T>(path: string, body: unknown): Promise<T> {
      return request<T>(path, {
        method: "PUT",
        body: JSON.stringify(body)
      });
    },
    post<T>(path: string, body: unknown): Promise<T> {
      return request<T>(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
    },
    delete<T>(path: string): Promise<T> {
      return request<T>(path, {
        method: "DELETE"
      });
    }
  };
}
