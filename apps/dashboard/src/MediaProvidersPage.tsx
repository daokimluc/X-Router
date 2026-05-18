/**
 * Media Providers Page — overview of all provider instances with media capabilities.
 * Shows summary stats and a grid of provider cards grouped by kind.
 */

import { useState } from "react";
import {
  Boxes, Database, Image, Volume2, Mic, Globe, Search,
  CheckCircle, XCircle, Settings,
} from "lucide-react";

type MediaKind = "embedding" | "image" | "imageToText" | "tts" | "stt" | "webSearch" | "webFetch";

type MediaModelConfig = {
  id: string;
  displayName?: string;
  isDefault?: boolean;
};

type MediaServiceConfig = {
  baseUrl: string;
  authType: string;
  authHeader?: string;
  format?: string;
  models: MediaModelConfig[];
};

type MediaProvider = {
  id: string;
  name: string;
  type: string;
  enabled?: boolean;
  serviceKinds?: MediaKind[];
  mediaConfig?: Partial<Record<MediaKind, MediaServiceConfig>>;
};

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

const KIND_META: Record<MediaKind, { label: string; icon: typeof Boxes; page: string }> = {
  embedding: { label: "Embedding", icon: Database, page: "mediaEmbedding" },
  image: { label: "Image Generation", icon: Image, page: "mediaImage" },
  imageToText: { label: "Image-to-Text", icon: Image, page: "mediaImage" },
  tts: { label: "Text-to-Speech", icon: Volume2, page: "mediaTTS" },
  stt: { label: "Speech-to-Text", icon: Mic, page: "mediaSTT" },
  webSearch: { label: "Web Search", icon: Search, page: "mediaWeb" },
  webFetch: { label: "Web Fetch", icon: Globe, page: "mediaWeb" },
};

function navigateTo(pageId: string) {
  window.history.pushState(null, "", `/dashboard/${pageId}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function MediaProvidersPage(props: { api: ApiClient; refresh: () => Promise<void> }) {
  const [providers, setProviders] = useState<MediaProvider[]>([]);
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    props.api
      .getList<MediaProvider>("/admin/v1/media-providers")
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }

  // Group providers by kind
  const byKind = new Map<MediaKind, MediaProvider[]>();
  for (const kind of Object.keys(KIND_META) as MediaKind[]) {
    byKind.set(kind, []);
  }
  for (const provider of providers) {
    for (const kind of provider.serviceKinds ?? []) {
      byKind.get(kind)?.push(provider);
    }
  }

  // Stats
  const totalProviders = providers.length;
  const enabledProviders = providers.filter((p) => p.enabled !== false).length;
  const totalModels = providers.reduce((sum, p) => {
    if (!p.mediaConfig) return sum;
    for (const cfg of Object.values(p.mediaConfig)) {
      if (cfg?.models) sum += cfg.models.length;
    }
    return sum;
  }, 0);
  const activeKinds = (Object.keys(KIND_META) as MediaKind[]).filter(
    (k) => (byKind.get(k)?.length ?? 0) > 0
  ).length;

  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle">Media Providers</h2>
          <p className="routesSubtitle">
            Provider instances with non-LLM AI capabilities (embeddings, images, audio, web)
          </p>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="metricGrid">
        <div className="metric">
          <div className="metricHeader">
            <span>Total Providers</span>
            <div className="metricIcon"><Boxes size={16} /></div>
          </div>
          <strong>{totalProviders}</strong>
          <p>{enabledProviders} enabled</p>
        </div>
        <div className="metric">
          <div className="metricHeader">
            <span>Active Kinds</span>
            <div className="metricIcon"><Settings size={16} /></div>
          </div>
          <strong>{activeKinds}</strong>
          <p>of {Object.keys(KIND_META).length} possible</p>
        </div>
        <div className="metric">
          <div className="metricHeader">
            <span>Total Models</span>
            <div className="metricIcon"><Database size={16} /></div>
          </div>
          <strong>{totalModels}</strong>
          <p>across all kinds</p>
        </div>
        <div className="metric">
          <div className="metricHeader">
            <span>Enabled</span>
            <div className="metricIcon"><CheckCircle size={16} /></div>
          </div>
          <strong>{enabledProviders}</strong>
          <p>{totalProviders - enabledProviders} disabled</p>
        </div>
      </div>

      {providers.length === 0 && loaded ? (
        <div className="routesEmpty">
          <Boxes size={24} />
          <p>No media providers configured</p>
          <small>
            Add media capabilities (serviceKinds) to your provider instances to enable media routing
          </small>
        </div>
      ) : (
        <div className="stack">
          {(Object.keys(KIND_META) as MediaKind[]).map((kind) => {
            const kindProviders = byKind.get(kind) ?? [];
            if (kindProviders.length === 0) return null;
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <article key={kind} className="card" style={{ padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon size={16} style={{ color: "var(--color-primary)" }} />
                    {meta.label}
                    <span style={{ fontWeight: 400, color: "#9ca3af" }}>
                      {kindProviders.length} provider{kindProviders.length !== 1 ? "s" : ""}
                    </span>
                  </h3>
                  <button
                    className="actionButton"
                    onClick={() => navigateTo(meta.page)}
                  >
                    Manage →
                  </button>
                </div>
                <div className="providerGrid">
                  {kindProviders.map((provider) => {
                    const config = provider.mediaConfig?.[kind];
                    const modelCount = config?.models?.length ?? 0;
                    return (
                      <div
                        key={`${kind}-${provider.id}`}
                        className="providerCard"
                        style={{ cursor: "pointer" }}
                        onClick={() => navigateTo(meta.page)}
                      >
                        <div className="providerCardTop">
                          <div className="providerIdentity">
                            <div className="providerIconTile">
                              <Icon size={16} />
                            </div>
                            <div>
                              <h3>{provider.name}</h3>
                              <span>{provider.type}</span>
                            </div>
                          </div>
                          {provider.enabled !== false ? (
                            <span className="statusBadge active"><CheckCircle size={12} /> Enabled</span>
                          ) : (
                            <span className="statusBadge disabled"><XCircle size={12} /> Disabled</span>
                          )}
                        </div>
                        <div className="providerStats">
                          <span>
                            Models
                            <strong>{modelCount}</strong>
                          </span>
                          <span>
                            Auth
                            <strong>{config?.authType ?? "—"}</strong>
                          </span>
                        </div>
                        <div className="providerMeta">
                          <div className="tagRow compact">
                            {(provider.serviceKinds ?? []).map((sk) => (
                              <span key={sk} className="tag">{KIND_META[sk]?.label ?? sk}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
