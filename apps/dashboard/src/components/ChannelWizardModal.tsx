/**
 * ChannelWizardModal — Phase 30 — single-form quick-create flow.
 * POST /admin/v1/channels/quick-create
 *
 * Atomic creates: ProviderInstance + N Accounts (1 per key) + M ModelMappings.
 * Mirrors new-api EditChannelModal UX pattern.
 */

import { useEffect, useState } from "react";
import { X, Wand2 } from "lucide-react";

type ApiClient = {
  post: (path: string, body: unknown) => Promise<unknown>;
  getList: <T>(path: string) => Promise<T[]>;
};

type ProviderTypeOption = {
  type: string;
  displayName: string;
  defaultBaseUrl?: string;
};

type Props = {
  api: ApiClient;
  providerTypes: ProviderTypeOption[];
  onClose: () => void;
  onSuccess: (instanceId: string) => void;
};

const RESERVED_HEADERS = new Set(["authorization", "content-type", "content-length", "host", "connection", "transfer-encoding"]);
const STATUS_CODE_KEY_RE = /^([1-5]xx|[1-5]\d{2})$/i;

function tryParseObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Must be a JSON object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

export function ChannelWizardModal({ api, providerTypes, onClose, onSuccess }: Props) {
  // Basic
  const [type, setType] = useState(providerTypes[0]?.type ?? "openai");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(providerTypes[0]?.defaultBaseUrl ?? "");
  const [groupName, setGroupName] = useState("");
  const [tag, setTag] = useState("");
  const [priority, setPriority] = useState("0");
  const [remark, setRemark] = useState("");

  // Credentials
  const [credentialType, setCredentialType] = useState<"api_key" | "bearer_token" | "refresh_token">("api_key");
  const [keysText, setKeysText] = useState("");

  // Models
  const [modelsText, setModelsText] = useState("");
  const [testModel, setTestModel] = useState("");
  const [modelMappingText, setModelMappingText] = useState("");

  // Advanced
  const [autoBan, setAutoBan] = useState(true);
  const [maxInputTokens, setMaxInputTokens] = useState("");
  const [systemPromptOverride, setSystemPromptOverride] = useState("");
  const [paramOverrideText, setParamOverrideText] = useState("");
  const [headerOverrideText, setHeaderOverrideText] = useState("");
  const [statusCodeMappingText, setStatusCodeMappingText] = useState("");

  // UI state
  const [section, setSection] = useState<"basic" | "credentials" | "models" | "advanced">("basic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill name + id + baseUrl when type changes
  useEffect(() => {
    const opt = providerTypes.find((p) => p.type === type);
    if (opt) {
      if (!name) setName(opt.displayName);
      if (!baseUrl && opt.defaultBaseUrl) setBaseUrl(opt.defaultBaseUrl);
      if (!id) setId(`${type}_${Date.now().toString(36).slice(-5)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const keys = keysText.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
  const models = modelsText.split(/[,\r\n]+/).map((m) => m.trim()).filter(Boolean);

  // Validation
  const paramParse = tryParseObject(paramOverrideText);
  const headerParse = tryParseObject(headerOverrideText);
  const mappingParse = tryParseObject(modelMappingText);
  const statusParse = tryParseObject(statusCodeMappingText);
  const headerReserved = headerParse.ok
    ? Object.keys(headerParse.value).filter((k) => RESERVED_HEADERS.has(k.toLowerCase()))
    : [];
  const statusInvalidKeys = statusParse.ok
    ? Object.keys(statusParse.value).filter((k) => !STATUS_CODE_KEY_RE.test(k))
    : [];

  const idValid = /^[a-z0-9_]+$/i.test(id);
  const allValid =
    type.length > 0 &&
    idValid &&
    name.trim().length > 0 &&
    keys.length > 0 &&
    models.length > 0 &&
    paramParse.ok &&
    headerParse.ok &&
    mappingParse.ok &&
    statusParse.ok &&
    headerReserved.length === 0 &&
    statusInvalidKeys.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !allValid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post(
        "/admin/v1/channels/quick-create",
        {
          id: id.trim(),
          type,
          name: name.trim(),
          baseUrl: baseUrl.trim() || undefined,
          groupName: groupName.trim() || undefined,
          tag: tag.trim() || undefined,
          priority: Number.parseInt(priority, 10) || 0,
          remark: remark.trim() || undefined,
          credentialType,
          keys,
          models,
          modelMapping: mappingParse.ok && Object.keys(mappingParse.value).length > 0
            ? (mappingParse.value as Record<string, string>)
            : undefined,
          testModel: testModel.trim() || undefined,
          maxInputTokens: maxInputTokens.trim() ? Number.parseInt(maxInputTokens, 10) : undefined,
          systemPromptOverride: systemPromptOverride.trim() || undefined,
          paramOverride: paramParse.ok && Object.keys(paramParse.value).length > 0 ? paramParse.value : undefined,
          headerOverride: headerParse.ok && Object.keys(headerParse.value).length > 0
            ? (headerParse.value as Record<string, string>)
            : undefined,
          statusCodeMapping: statusParse.ok && Object.keys(statusParse.value).length > 0
            ? (statusParse.value as Record<string, "retry" | "disable" | "passthrough">)
            : undefined,
          autoBan
        }
      ) as { instance: { id: string }; summary: string };
      onSuccess(result.instance.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quick-create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modalContent"
        style={{ maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Wand2 size={18} /> Quick add channel
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="segmentedControl" style={{ margin: "12px 20px", alignSelf: "flex-start" }}>
          <button type="button" className={`segmentedItem ${section === "basic" ? "active" : ""}`} onClick={() => setSection("basic")}>1. Basic</button>
          <button type="button" className={`segmentedItem ${section === "credentials" ? "active" : ""}`} onClick={() => setSection("credentials")}>2. Credentials ({keys.length})</button>
          <button type="button" className={`segmentedItem ${section === "models" ? "active" : ""}`} onClick={() => setSection("models")}>3. Models ({models.length})</button>
          <button type="button" className={`segmentedItem ${section === "advanced" ? "active" : ""}`} onClick={() => setSection("advanced")}>4. Advanced</button>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {section === "basic" && (
            <>
              <label className="formField">
                <span>Provider type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {providerTypes.map((p) => <option key={p.type} value={p.type}>{p.displayName} ({p.type})</option>)}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="formField">
                  <span>Channel ID *</span>
                  <input
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    placeholder="e.g. openai_main"
                    style={{ borderColor: idValid || !id ? undefined : "#ef4444" }}
                  />
                  {id && !idValid && <small style={{ color: "#ef4444", fontSize: 11 }}>Use only letters, digits, underscore</small>}
                </label>
                <label className="formField">
                  <span>Display name *</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI Main" />
                </label>
              </div>
              <label className="formField">
                <span>Base URL</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label className="formField">
                  <span>Group</span>
                  <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="(optional)" />
                </label>
                <label className="formField">
                  <span>Tag</span>
                  <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="(optional)" />
                </label>
                <label className="formField">
                  <span>Priority</span>
                  <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
                </label>
              </div>
              <label className="formField">
                <span>Remark (admin notes)</span>
                <textarea rows={2} maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="(optional)" />
              </label>
            </>
          )}

          {section === "credentials" && (
            <>
              <label className="formField">
                <span>Credential type</span>
                <select value={credentialType} onChange={(e) => setCredentialType(e.target.value as typeof credentialType)}>
                  <option value="api_key">API key</option>
                  <option value="bearer_token">Bearer token</option>
                  <option value="refresh_token">Refresh token</option>
                </select>
              </label>
              <label className="formField">
                <span>Keys (one per line) *</span>
                <textarea
                  rows={6}
                  value={keysText}
                  onChange={(e) => setKeysText(e.target.value)}
                  placeholder="sk-...\nsk-...\nsk-..."
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <small className="formHint">{keys.length} key(s) detected. Each becomes an Account for round-robin rotation.</small>
              </label>
            </>
          )}

          {section === "models" && (
            <>
              <label className="formField">
                <span>Models (comma or newline separated) *</span>
                <textarea
                  rows={4}
                  value={modelsText}
                  onChange={(e) => setModelsText(e.target.value)}
                  placeholder="gpt-4o, gpt-4o-mini, claude-3-5-sonnet"
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
                <small className="formHint">{models.length} model(s) detected. Each becomes a public model the channel will serve.</small>
              </label>
              <label className="formField">
                <span>Test model (for health check)</span>
                <input value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="(empty = adapter default)" />
              </label>
              <label className="formField">
                <span>Per-channel model mapping (JSON: alias → upstream)</span>
                <textarea
                  rows={4}
                  value={modelMappingText}
                  onChange={(e) => setModelMappingText(e.target.value)}
                  placeholder='{"gpt-4o": "my-azure-deployment-2024-08-06"}'
                  style={{ fontFamily: "monospace", fontSize: 12, borderColor: mappingParse.ok ? undefined : "#ef4444" }}
                />
                {!mappingParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>Invalid JSON: {mappingParse.error}</small>}
                <small className="formHint">
                  Optional. Gateway auto-converts model names to each provider's expected format (Kiro uses dots, Anthropic accepts dash, etc.).
                  Use this only when you need explicit override (e.g. Azure deployment name, custom upstream variant).
                </small>
              </label>
            </>
          )}

          {section === "advanced" && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={autoBan} onChange={(e) => setAutoBan(e.target.checked)} />
                Auto-ban on consecutive failures (circuit breaker)
              </label>
              <label className="formField">
                <span>Max input tokens</span>
                <input type="number" value={maxInputTokens} onChange={(e) => setMaxInputTokens(e.target.value)} placeholder="(empty = no limit)" />
              </label>
              <label className="formField">
                <span>System prompt override</span>
                <textarea rows={2} value={systemPromptOverride} onChange={(e) => setSystemPromptOverride(e.target.value)} placeholder="(optional)" />
              </label>
              <label className="formField">
                <span>Param override (JSON)</span>
                <textarea
                  rows={3}
                  value={paramOverrideText}
                  onChange={(e) => setParamOverrideText(e.target.value)}
                  placeholder='{"max_tokens": 4096}'
                  style={{ fontFamily: "monospace", fontSize: 12, borderColor: paramParse.ok ? undefined : "#ef4444" }}
                />
                {!paramParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>{paramParse.error}</small>}
              </label>
              <label className="formField">
                <span>Header override (JSON)</span>
                <textarea
                  rows={3}
                  value={headerOverrideText}
                  onChange={(e) => setHeaderOverrideText(e.target.value)}
                  placeholder='{"x-custom": "value"}'
                  style={{ fontFamily: "monospace", fontSize: 12, borderColor: headerParse.ok && headerReserved.length === 0 ? undefined : "#ef4444" }}
                />
                {!headerParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>{headerParse.error}</small>}
                {headerReserved.length > 0 && <small style={{ color: "#ef4444", fontSize: 11 }}>Reserved headers cannot be overridden: {headerReserved.join(", ")}</small>}
              </label>
              <label className="formField">
                <span>Status code mapping (JSON)</span>
                <textarea
                  rows={3}
                  value={statusCodeMappingText}
                  onChange={(e) => setStatusCodeMappingText(e.target.value)}
                  placeholder='{"401": "disable", "5xx": "retry"}'
                  style={{ fontFamily: "monospace", fontSize: 12, borderColor: statusParse.ok && statusInvalidKeys.length === 0 ? undefined : "#ef4444" }}
                />
                {statusInvalidKeys.length > 0 && <small style={{ color: "#ef4444", fontSize: 11 }}>Invalid keys: {statusInvalidKeys.join(", ")}</small>}
              </label>
            </>
          )}

          {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
        </form>

        <div className="routeModalFooter" style={{ borderTop: "1px solid var(--color-border)" }}>
          <small style={{ color: "var(--color-text-muted)", marginRight: "auto", fontSize: 11 }}>
            Will create: 1 channel · {keys.length} key(s) · {models.length} model(s)
          </small>
          <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="primaryButton"
            disabled={busy || !allValid}
            onClick={(e) => void submit(e as unknown as React.FormEvent)}
          >
            {busy ? "Creating..." : "Create channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
