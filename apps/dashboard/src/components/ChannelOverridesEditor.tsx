/**
 * ChannelOverridesEditor — per-instance advanced overrides (Phase 20b).
 * PATCH /admin/v1/provider-instances/:id
 *
 * Surfaces priority, paramOverride (JSON), headerOverride (JSON,
 * reserved-key checked client-side), statusCodeMapping (JSON enum values).
 */

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  patch: <T>(path: string, body: unknown) => Promise<T>;
};

export type ProviderInstanceShape = {
  id: string;
  name: string;
  priority?: number;
  groupName?: string;
  tag?: string;
  maxInputTokens?: number;
  systemPromptOverride?: string;
  remark?: string;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, string>;
  statusCodeMapping?: Record<string, "retry" | "disable" | "passthrough">;
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    cooldownMs: number;
    halfOpenMaxRequests?: number;
  };
};

type Props = {
  instance: ProviderInstanceShape;
  api: ApiClient;
  onSaved: () => void;
};

const RESERVED_HEADERS = new Set([
  "authorization",
  "content-type",
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
]);

const STATUS_CODE_KEY_RE = /^([1-5]xx|[1-5]\d{2})$/i;
const STATUS_CODE_VALUES = new Set(["retry", "disable", "passthrough"]);

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

function checkHeaderReservedConflicts(headers: Record<string, unknown>): string[] {
  const conflicts: string[] = [];
  for (const key of Object.keys(headers)) {
    if (RESERVED_HEADERS.has(key.toLowerCase())) conflicts.push(key);
  }
  return conflicts;
}

function checkStatusCodeMapping(map: Record<string, unknown>): { invalidKeys: string[]; invalidValues: string[] } {
  const invalidKeys: string[] = [];
  const invalidValues: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (!STATUS_CODE_KEY_RE.test(k)) invalidKeys.push(k);
    if (typeof v !== "string" || !STATUS_CODE_VALUES.has(v)) invalidValues.push(`${k}=${String(v)}`);
  }
  return { invalidKeys, invalidValues };
}

export function ChannelOverridesEditor({ instance, api, onSaved }: Props) {
  const { t } = useLang();
  const [priority, setPriority] = useState(String(instance.priority ?? 0));
  const [groupName, setGroupName] = useState(instance.groupName ?? "");
  const [tag, setTag] = useState(instance.tag ?? "");
  const [maxInputTokens, setMaxInputTokens] = useState(
    instance.maxInputTokens === undefined ? "" : String(instance.maxInputTokens)
  );
  const [systemPromptOverride, setSystemPromptOverride] = useState(instance.systemPromptOverride ?? "");
  const [remark, setRemark] = useState(instance.remark ?? "");
  const [autoBanEnabled, setAutoBanEnabled] = useState<boolean>(instance.circuitBreaker?.enabled ?? true);
  const [failureThreshold, setFailureThreshold] = useState(String(instance.circuitBreaker?.failureThreshold ?? 5));
  const [cooldownMs, setCooldownMs] = useState(String(instance.circuitBreaker?.cooldownMs ?? 60000));
  const [paramText, setParamText] = useState(JSON.stringify(instance.paramOverride ?? {}, null, 2));
  const [headerText, setHeaderText] = useState(JSON.stringify(instance.headerOverride ?? {}, null, 2));
  const [statusText, setStatusText] = useState(JSON.stringify(instance.statusCodeMapping ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPriority(String(instance.priority ?? 0));
    setGroupName(instance.groupName ?? "");
    setTag(instance.tag ?? "");
    setMaxInputTokens(instance.maxInputTokens === undefined ? "" : String(instance.maxInputTokens));
    setSystemPromptOverride(instance.systemPromptOverride ?? "");
    setRemark(instance.remark ?? "");
    setAutoBanEnabled(instance.circuitBreaker?.enabled ?? true);
    setFailureThreshold(String(instance.circuitBreaker?.failureThreshold ?? 5));
    setCooldownMs(String(instance.circuitBreaker?.cooldownMs ?? 60000));
    setParamText(JSON.stringify(instance.paramOverride ?? {}, null, 2));
    setHeaderText(JSON.stringify(instance.headerOverride ?? {}, null, 2));
    setStatusText(JSON.stringify(instance.statusCodeMapping ?? {}, null, 2));
  }, [instance]);

  const paramParse = tryParseObject(paramText);
  const headerParse = tryParseObject(headerText);
  const statusParse = tryParseObject(statusText);

  const reservedConflicts = headerParse.ok ? checkHeaderReservedConflicts(headerParse.value) : [];
  const statusValidation = statusParse.ok ? checkStatusCodeMapping(statusParse.value) : { invalidKeys: [], invalidValues: [] };

  const allValid =
    paramParse.ok &&
    headerParse.ok &&
    statusParse.ok &&
    reservedConflicts.length === 0 &&
    statusValidation.invalidKeys.length === 0 &&
    statusValidation.invalidValues.length === 0;

  const isActive =
    (instance.paramOverride && Object.keys(instance.paramOverride).length > 0) ||
    (instance.headerOverride && Object.keys(instance.headerOverride).length > 0);

  async function save() {
    if (busy || !allValid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const priorityNum = Number.parseInt(priority, 10);
      const maxInputTokensNum = maxInputTokens.trim() === "" ? null : Number.parseInt(maxInputTokens, 10);
      const failureThresholdNum = Math.max(1, Number.parseInt(failureThreshold, 10) || 5);
      const cooldownMsNum = Math.max(1000, Number.parseInt(cooldownMs, 10) || 60000);
      await api.patch(`/admin/v1/provider-instances/${instance.id}`, {
        priority: Number.isFinite(priorityNum) ? priorityNum : 0,
        groupName: groupName.trim() || null,
        tag: tag.trim() || null,
        maxInputTokens: maxInputTokensNum === null
          ? null
          : (Number.isFinite(maxInputTokensNum) && maxInputTokensNum > 0 ? maxInputTokensNum : null),
        systemPromptOverride: systemPromptOverride.trim() || null,
        remark: remark.trim() || null,
        paramOverride: paramParse.ok ? paramParse.value : {},
        headerOverride: headerParse.ok ? headerParse.value as Record<string, string> : {},
        statusCodeMapping: statusParse.ok ? statusParse.value : {},
        circuitBreaker: {
          enabled: autoBanEnabled,
          failureThreshold: failureThresholdNum,
          cooldownMs: cooldownMsNum,
          halfOpenMaxRequests: instance.circuitBreaker?.halfOpenMaxRequests ?? 1,
        },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPriority(String(instance.priority ?? 0));
    setGroupName(instance.groupName ?? "");
    setTag(instance.tag ?? "");
    setMaxInputTokens(instance.maxInputTokens === undefined ? "" : String(instance.maxInputTokens));
    setSystemPromptOverride(instance.systemPromptOverride ?? "");
    setRemark(instance.remark ?? "");
    setAutoBanEnabled(instance.circuitBreaker?.enabled ?? true);
    setFailureThreshold(String(instance.circuitBreaker?.failureThreshold ?? 5));
    setCooldownMs(String(instance.circuitBreaker?.cooldownMs ?? 60000));
    setParamText(JSON.stringify(instance.paramOverride ?? {}, null, 2));
    setHeaderText(JSON.stringify(instance.headerOverride ?? {}, null, 2));
    setStatusText(JSON.stringify(instance.statusCodeMapping ?? {}, null, 2));
    setError(null);
  }

  return (
    <details className="channelOverrides">
      <summary className="channelOverrides__summary">
        <Settings2 size={16} />
        {t("channel.advanced")}
        {isActive && (
          <span className="channelOverrides__badge">{t("channel.overridesActive")}</span>
        )}
      </summary>

      <div className="channelOverrides__body">
        <label className="formField">
          <span>{t("channel.groupName")}</span>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="(optional, e.g. premium / free)"
          />
          <small className="formHint">{t("channel.groupName.hint")}</small>
        </label>

        <label className="formField">
          <span>{t("channel.priority")}</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="channelOverrides__shortInput"
          />
        </label>

        <label className="formField">
          <span>{t("channel.tag")}</span>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="(optional, used for batch operations)"
          />
          <small className="formHint">{t("channel.tag.hint")}</small>
        </label>

        <label className="formField">
          <span>{t("channel.maxInputTokens")}</span>
          <input
            type="number"
            min="1"
            value={maxInputTokens}
            onChange={(e) => setMaxInputTokens(e.target.value)}
            placeholder="(empty = no limit)"
            className="channelOverrides__shortInput"
          />
          <small className="formHint">{t("channel.maxInputTokens.hint")}</small>
        </label>

        <label className="formField">
          <span>{t("channel.systemPromptOverride")}</span>
          <textarea
            value={systemPromptOverride}
            onChange={(e) => setSystemPromptOverride(e.target.value)}
            rows={3}
            placeholder="(optional)"
          />
          <small className="formHint">{t("channel.systemPromptOverride.hint")}</small>
        </label>

        <label className="formField">
          <span>{t("channel.remark")}</span>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="(optional admin notes)"
          />
          <small className="formHint">{t("channel.remark.hint")}</small>
        </label>

        <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "10px 12px", margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 500, padding: "0 6px" }}>{t("channel.autoBan")}</legend>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={autoBanEnabled}
              onChange={(e) => setAutoBanEnabled(e.target.checked)}
            />
            {t("channel.autoBan.enabled")}
          </label>
          <small className="formHint" style={{ display: "block", marginBottom: 10 }}>{t("channel.autoBan.hint")}</small>
          <div style={{ display: "flex", gap: 12 }}>
            <label className="formField" style={{ flex: 1 }}>
              <span>{t("channel.failureThreshold")}</span>
              <input
                type="number"
                min="1"
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(e.target.value)}
                disabled={!autoBanEnabled}
              />
            </label>
            <label className="formField" style={{ flex: 1 }}>
              <span>{t("channel.cooldownMs")}</span>
              <input
                type="number"
                min="1000"
                step="1000"
                value={cooldownMs}
                onChange={(e) => setCooldownMs(e.target.value)}
                disabled={!autoBanEnabled}
              />
            </label>
          </div>
        </fieldset>

        <div className="formField">
          <span>{t("channel.paramOverride")}</span>
          <textarea
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            rows={5}
            className={!paramParse.ok ? "channelOverrides__invalid" : ""}
            spellCheck={false}
          />
          {!paramParse.ok && <small className="formFieldError">{t("channel.invalidJson")}: {paramParse.error}</small>}
          <small className="formHint">{t("channel.paramOverride.hint")}</small>
        </div>

        <div className="formField">
          <span>{t("channel.headerOverride")}</span>
          <textarea
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            rows={5}
            className={!headerParse.ok || reservedConflicts.length > 0 ? "channelOverrides__invalid" : ""}
            spellCheck={false}
          />
          {!headerParse.ok && <small className="formFieldError">{t("channel.invalidJson")}: {headerParse.error}</small>}
          {headerParse.ok && reservedConflicts.length > 0 && (
            <small className="formFieldError">
              {t("channel.reservedHeaderConflict").replace("{keys}", reservedConflicts.join(", "))}
            </small>
          )}
          <small className="formHint">{t("channel.headerOverride.hint")}</small>
        </div>

        <div className="formField">
          <span>{t("channel.statusCodeMapping")}</span>
          <textarea
            value={statusText}
            onChange={(e) => setStatusText(e.target.value)}
            rows={4}
            className={!statusParse.ok || statusValidation.invalidKeys.length > 0 || statusValidation.invalidValues.length > 0 ? "channelOverrides__invalid" : ""}
            spellCheck={false}
          />
          {!statusParse.ok && <small className="formFieldError">{t("channel.invalidJson")}: {statusParse.error}</small>}
          {statusParse.ok && statusValidation.invalidKeys.length > 0 && (
            <small className="formFieldError">
              {t("channel.invalidStatusCodeKey").replace("{key}", statusValidation.invalidKeys.join(", "))}
            </small>
          )}
          {statusParse.ok && statusValidation.invalidValues.length > 0 && (
            <small className="formFieldError">
              Invalid values (use retry/disable/passthrough): {statusValidation.invalidValues.join(", ")}
            </small>
          )}
          <small className="formHint">{t("channel.statusCodeMapping.hint")}</small>
        </div>

        {error && <div className="formFieldError">{error}</div>}
        {saved && <div className="formFieldSuccess">✓ Saved</div>}

        <div className="channelOverrides__actions">
          <button type="button" className="ghostButton" onClick={reset} disabled={busy}>
            Reset
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => void save()}
            disabled={busy || !allValid}
          >
            {busy ? "..." : "Save"}
          </button>
        </div>
      </div>
    </details>
  );
}
