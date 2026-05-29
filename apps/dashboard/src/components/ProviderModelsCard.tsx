/**
 * ProviderModelsCard — list of models exposed by the provider for a given
 * service kind. Pulls models from:
 *   1. Catalog `embeddingConfig.models` (built-in, read-only — shown first)
 *   2. The provider instance's mediaConfig (set up via /admin/v1/media-providers)
 *   3. Model mappings filtered by provider type
 * Supports adding a custom model via inline form. Built-in models cannot be
 * edited or removed — they always reflect the catalog values.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Plus, X } from "lucide-react";
import { copyText } from "../clipboard";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type ModelSource = "builtin" | "media" | "mapping" | "custom";

type ModelEntry = {
  id: string;
  name?: string;
  dimensions?: number;
  source: ModelSource;
};

type MediaModelConfig = {
  id: string;
  displayName?: string;
  name?: string;
};

type MediaProvider = {
  id: string;
  type: string;
  name: string;
  mediaConfig?: Partial<
    Record<ServiceKind, { models?: MediaModelConfig[] } | undefined>
  >;
};

type ModelMapping = {
  id: string;
  publicModel: string;
  providerType: string;
  upstreamModel: string;
  enabled?: boolean;
};

type Props = {
  api: ApiClient;
  provider: CatalogProvider;
  kind: ServiceKind;
  kindLabel: string;
};

/**
 * Returns built-in catalog models for the given kind, if any.
 * `embedding`, `image`, `tts`, and `stt` ship catalog-defined models.
 * `webSearch` and `webFetch` providers do not expose models in the same
 * sense — they are surfaced through their config rather than a model list.
 */
function getBuiltinModels(provider: CatalogProvider, kind: ServiceKind): ModelEntry[] {
  if (kind === "embedding" && provider.embeddingConfig?.models) {
    return provider.embeddingConfig.models.map((m) => ({
      id: m.id,
      name: m.name,
      dimensions: m.dimensions,
      source: "builtin" as const,
    }));
  }
  if (kind === "image" && provider.imageConfig?.models) {
    return provider.imageConfig.models.map((m) => ({
      id: m.id,
      name: m.name,
      source: "builtin" as const,
    }));
  }
  if (kind === "tts" && provider.ttsConfig?.models) {
    return provider.ttsConfig.models.map((m) => ({
      id: m.id,
      name: m.name,
      source: "builtin" as const,
    }));
  }
  if (kind === "stt" && provider.sttConfig?.models) {
    return provider.sttConfig.models.map((m) => ({
      id: m.id,
      name: m.name,
      source: "builtin" as const,
    }));
  }
  return [];
}

export function ProviderModelsCard({ api, provider, kind, kindLabel }: Props) {
  const [dynamicModels, setDynamicModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");

  const builtinModels = useMemo(
    () => getBuiltinModels(provider, kind),
    [provider, kind]
  );
  const builtinIds = useMemo(
    () => new Set(builtinModels.map((m) => m.id)),
    [builtinModels]
  );

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mediaProviders, mappings] = await Promise.all([
        api.getList<MediaProvider>("/admin/v1/media-providers").catch(() => []),
        api.getList<ModelMapping>("/admin/v1/model-mappings").catch(() => []),
      ]);

      const collected = new Map<string, ModelEntry>();

      // Source 1: provider instance mediaConfig models for this kind.
      const matchingProvider = mediaProviders.find((p) => p.type === provider.id);
      const mediaModels = matchingProvider?.mediaConfig?.[kind]?.models ?? [];
      for (const m of mediaModels) {
        if (!m?.id || builtinIds.has(m.id)) continue;
        collected.set(m.id, {
          id: m.id,
          name: m.displayName ?? m.name,
          source: "media",
        });
      }

      // Source 2: model mappings filtered by provider type.
      for (const mapping of mappings) {
        if (mapping.providerType !== provider.id) continue;
        const id = mapping.upstreamModel || mapping.publicModel;
        if (!id || collected.has(id) || builtinIds.has(id)) continue;
        collected.set(id, {
          id,
          name: mapping.publicModel !== id ? mapping.publicModel : undefined,
          source: "mapping",
        });
      }

      setDynamicModels(Array.from(collected.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [api, kind, provider.id, builtinIds]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const id = newId.trim();
    if (!id) return;
    setDynamicModels((prev) =>
      prev.some((m) => m.id === id) || builtinIds.has(id)
        ? prev
        : [...prev, { id, name: newName.trim() || undefined, source: "custom" }]
    );
    setNewId("");
    setNewName("");
    setShowAdd(false);
  }

  return (
    <article className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Models — {kindLabel.toUpperCase()}
        </h3>
      </div>

      {error && (
        <p
          style={{
            margin: "0 0 10px",
            color: "var(--color-danger, #ef4444)",
            fontSize: 12,
          }}
        >
          {error}
        </p>
      )}

      {builtinModels.length > 0 && (
        <ModelSection
          title="Built-in models"
          subtitle={`From ${provider.name} catalog`}
          models={builtinModels}
          provider={provider}
        />
      )}

      <ModelSection
        title={builtinModels.length > 0 ? "Other models" : undefined}
        models={dynamicModels}
        provider={provider}
        loading={loading}
        emptyText={
          builtinModels.length === 0
            ? "No models configured. Add one below."
            : null
        }
      />

      <div style={{ marginTop: 14 }}>
        {showAdd ? (
          <form
            onSubmit={handleAdd}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
              <span style={labelStyle}>Model ID</span>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="e.g. text-embedding-3-small"
                autoFocus
                required
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
              <span style={labelStyle}>Display Name (optional)</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Text Embedding 3 Small"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="submit" className="primaryButton" style={{ fontSize: 12, padding: "6px 12px" }}>
                <Check size={14} />
                Add
              </button>
              <button
                type="button"
                className="ghostButton"
                onClick={() => {
                  setShowAdd(false);
                  setNewId("");
                  setNewName("");
                }}
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="actionButton"
            onClick={() => setShowAdd(true)}
            style={{
              fontSize: 12,
              border: "1px dashed var(--color-border, #d1d5db)",
              background: "transparent",
            }}
          >
            <Plus size={14} />
            Add Model
          </button>
        )}
      </div>
    </article>
  );
}

function ModelSection({
  title,
  subtitle,
  models,
  provider,
  loading,
  emptyText,
}: {
  title?: string;
  subtitle?: string;
  models: ModelEntry[];
  provider: CatalogProvider;
  loading?: boolean;
  emptyText?: string | null;
}) {
  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
        Loading models...
      </p>
    );
  }
  if (models.length === 0 && !emptyText) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {title && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: 0.6,
              fontWeight: 700,
              color: "var(--color-text-muted, #6b7280)",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted, #6b7280)" }}>
              {subtitle}
            </span>
          )}
        </div>
      )}
      {models.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted, #6b7280)" }}>
          {emptyText}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {models.map((m) => (
            <ModelPill key={m.id} model={m} provider={provider} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelPill({ model, provider }: { model: ModelEntry; provider: CatalogProvider }) {
  const [copied, setCopied] = useState(false);
  const fullId = `${provider.alias}/${model.id}`;
  const isBuiltin = model.source === "builtin";

  async function copyId() {
    try {
      await copyText(fullId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 10,
        borderRadius: 10,
        border: isBuiltin
          ? "1px solid var(--color-primary, #3b82f6)"
          : "1px solid var(--color-border, #e5e7eb)",
        background: isBuiltin
          ? "var(--color-surface-accent, #eff6ff)"
          : "var(--color-surface, #ffffff)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <code
          style={{
            flex: 1,
            fontSize: 11,
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--color-surface-2, #f3f4f6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={model.id}
        >
          {model.id}
        </code>
        <button
          type="button"
          className="iconButton"
          onClick={() => void copyId()}
          title={copied ? "Copied" : `Copy ${fullId}`}
          style={{ padding: 4 }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          minHeight: 14,
        }}
      >
        {model.name && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted, #6b7280)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
            title={model.name}
          >
            {model.name}
          </span>
        )}
        {model.dimensions != null && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-muted, #6b7280)",
              padding: "1px 6px",
              borderRadius: 999,
              background: "var(--color-surface-2, #f3f4f6)",
              fontWeight: 500,
            }}
          >
            {model.dimensions} dims
          </span>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 6,
  background: "var(--color-surface, #ffffff)",
  color: "var(--color-text-main)",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted, #6b7280)",
  fontWeight: 500,
};
