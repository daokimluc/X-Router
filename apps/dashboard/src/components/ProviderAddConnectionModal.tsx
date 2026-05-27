/**
 * ProviderAddConnectionModal — form to add a new account/connection for a
 * given catalog provider. If no provider instance exists yet for this
 * provider type, one is created automatically before the account is added.
 *
 * When the catalog provider declares built-in service kind configs (e.g.
 * `embeddingConfig`), the new instance's mediaConfig is auto-populated via
 * PATCH /admin/v1/provider-instances/:id/media so the gateway has
 * everything it needs to dispatch requests. PATCH failures are non-fatal —
 * the connection still saves successfully.
 */

import { useState } from "react";
import { X } from "lucide-react";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
};

type Props = {
  api: ApiClient;
  provider: CatalogProvider;
  /** Existing provider instance for this provider type (if any). */
  existingInstance: ProviderInstance | null;
  onClose: () => void;
  onSaved: () => void;
};

type AuthType = "api_key" | "bearer_token" | "oauth";

const AUTH_OPTIONS: Array<{ value: AuthType; label: string; disabled?: boolean }> = [
  { value: "api_key", label: "API Key" },
  { value: "bearer_token", label: "Bearer Token" },
  { value: "oauth", label: "OAuth (coming soon)", disabled: true },
];

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Build the partial mediaConfig payload for a catalog provider, picking up
 * any catalog-defined kind configs (currently only `embeddingConfig`).
 * Returns `null` when the provider has no built-in media configs.
 */
function buildMediaConfigPayload(provider: CatalogProvider): {
  serviceKinds: ServiceKind[];
  mediaConfig: Partial<Record<ServiceKind, unknown>>;
} | null {
  const serviceKinds: ServiceKind[] = [];
  const mediaConfig: Partial<Record<ServiceKind, unknown>> = {};

  if (provider.embeddingConfig) {
    serviceKinds.push("embedding");
    // Strip dimensions before sending — the backend's MediaModelConfig
    // doesn't include it (the backend uses dimensions hints from the
    // upstream response), so we keep id + displayName only.
    mediaConfig.embedding = {
      baseUrl: provider.embeddingConfig.baseUrl,
      authType: provider.embeddingConfig.authType,
      authHeader: provider.embeddingConfig.authHeader,
      format: provider.embeddingConfig.format,
      models: provider.embeddingConfig.models.map((m) => ({
        id: m.id,
        displayName: m.name,
      })),
    };
  }

  if (provider.imageConfig) {
    serviceKinds.push("image");
    mediaConfig.image = {
      baseUrl: provider.imageConfig.baseUrl,
      authType: provider.imageConfig.authType,
      authHeader: provider.imageConfig.authHeader,
      format: provider.imageConfig.format,
      models: provider.imageConfig.models.map((m) => ({
        id: m.id,
        displayName: m.name,
      })),
    };
  }

  if (provider.ttsConfig) {
    serviceKinds.push("tts");
    mediaConfig.tts = {
      baseUrl: provider.ttsConfig.baseUrl,
      authType: provider.ttsConfig.authType,
      authHeader: provider.ttsConfig.authHeader,
      format: provider.ttsConfig.format,
      models: provider.ttsConfig.models.map((m) => ({
        id: m.id,
        displayName: m.name,
      })),
    };
  }

  if (provider.sttConfig) {
    serviceKinds.push("stt");
    mediaConfig.stt = {
      baseUrl: provider.sttConfig.baseUrl,
      authType: provider.sttConfig.authType,
      authHeader: provider.sttConfig.authHeader,
      format: provider.sttConfig.format,
      models: provider.sttConfig.models.map((m) => ({
        id: m.id,
        displayName: m.name,
      })),
    };
  }

  if (provider.searchConfig) {
    serviceKinds.push("webSearch");
    mediaConfig.webSearch = {
      baseUrl: provider.searchConfig.baseUrl,
      authType: provider.searchConfig.authType,
      authHeader: provider.searchConfig.authHeader,
      format: provider.searchConfig.format,
      // webSearch doesn't have a model list — backend ignores models[] for
      // this kind but the type still requires the field, so we send [].
      models: [],
    };
  }

  if (provider.fetchConfig) {
    serviceKinds.push("webFetch");
    mediaConfig.webFetch = {
      baseUrl: provider.fetchConfig.baseUrl,
      authType: provider.fetchConfig.authType,
      authHeader: provider.fetchConfig.authHeader,
      format: provider.fetchConfig.format,
      models: [],
    };
  }

  if (serviceKinds.length === 0) return null;
  return { serviceKinds, mediaConfig };
}

export function ProviderAddConnectionModal({
  api,
  provider,
  existingInstance,
  onClose,
  onSaved,
}: Props) {
  const [displayName, setDisplayName] = useState("");
  const [authType, setAuthType] = useState<AuthType>("api_key");
  const [apiKey, setApiKey] = useState("");
  const [owner, setOwner] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(3);
  const [weight, setWeight] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim().length > 0 && apiKey.trim().length > 0 && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      // Step 1: ensure a provider instance exists for this provider type.
      let instanceId = existingInstance?.id;
      if (!instanceId) {
        const newInstance = await api.post<ProviderInstance>("/admin/v1/provider-instances", {
          id: `provider_${provider.id}_${randomSuffix()}`,
          type: provider.id,
          name: provider.name,
          enabled: true,
          config: { alias: provider.alias },
          defaultTimeoutMs: 30000,
          maxRetries: 1,
          cooldownMs: 60000,
          accountSelectionStrategy: "round_robin",
          maxConcurrentRequests: 20,
          maxConcurrentRequestsPerAccount: 3,
          circuitBreaker: {
            enabled: true,
            failureThreshold: 5,
            cooldownMs: 60000,
            halfOpenMaxRequests: 1,
          },
        });
        instanceId = newInstance.id;
      }

      // Step 1b: push catalog-defined media configs to the instance every
      // time a connection is added — this keeps existing instances in sync
      // with the catalog (e.g. a Codex instance created before image kind
      // was added still gets serviceKinds=["image"] applied here). The
      // backend merges mediaConfig with existing values so user
      // customizations on already-defined kinds are preserved. PATCH
      // failures are non-fatal — the connection still saves below.
      const mediaPayload = buildMediaConfigPayload(provider);
      if (mediaPayload) {
        try {
          await api.patch(
            `/admin/v1/provider-instances/${instanceId}/media`,
            mediaPayload
          );
        } catch {
          // Swallow — connection creation continues regardless.
        }
      }

      // Step 2: create the account.
      const credentialPayload =
        authType === "api_key"
          ? { apiKey: apiKey.trim() }
          : { bearerToken: apiKey.trim() };
      await api.post("/admin/v1/accounts", {
        id: `account_${randomSuffix()}`,
        providerInstanceId: instanceId,
        providerType: provider.id,
        displayName: displayName.trim(),
        credentialType: authType,
        credentialPayload,
        maxConcurrency,
        weight,
        owner: owner.trim() || undefined,
      });

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modalContent routeModal"
        style={{ maxWidth: 480, width: "100%" }}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>Add {provider.name} connection</h2>
          <button
            type="button"
            className="iconButton"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="customProviderForm"
        >
          <Field label="Display Name">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Production Key"
              required
              autoFocus
              style={inputStyle}
            />
          </Field>

          <Field label="Auth Type">
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as AuthType)}
              style={inputStyle}
            >
              {AUTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={authType === "bearer_token" ? "Bearer Token" : "API Key"}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="••••••••"
              required
              style={inputStyle}
            />
          </Field>

          <Field label="Owner (optional)">
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="alice@acme.co"
              style={inputStyle}
            />
          </Field>

          <div className="formRow2col">
            <Field label="Max Concurrency">
              <input
                type="number"
                min={1}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
                style={inputStyle}
              />
            </Field>
            <Field label="Weight">
              <input
                type="number"
                min={1}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value) || 1)}
                style={inputStyle}
              />
            </Field>
          </div>

          {error && (
            <p className="formError">
              {error}
            </p>
          )}
        </form>

        <div className="routeModalFooter">
          <button
            type="button"
            className="ghostButton"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={(e) => void handleSubmit(e)}
            disabled={!canSubmit}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="formField">
      <span>{label}</span>
      {children}
    </label>
  );
}
