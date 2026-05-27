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
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, string>;
  statusCodeMapping?: Record<string, "retry" | "disable" | "passthrough">;
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
  const [paramText, setParamText] = useState(JSON.stringify(instance.paramOverride ?? {}, null, 2));
  const [headerText, setHeaderText] = useState(JSON.stringify(instance.headerOverride ?? {}, null, 2));
  const [statusText, setStatusText] = useState(JSON.stringify(instance.statusCodeMapping ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPriority(String(instance.priority ?? 0));
    setGroupName(instance.groupName ?? "");
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
      await api.patch(`/admin/v1/provider-instances/${instance.id}`, {
        priority: Number.isFinite(priorityNum) ? priorityNum : 0,
        groupName: groupName.trim() || null,
        paramOverride: paramParse.ok ? paramParse.value : {},
        headerOverride: headerParse.ok ? headerParse.value as Record<string, string> : {},
        statusCodeMapping: statusParse.ok ? statusParse.value : {},
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
    setParamText(JSON.stringify(instance.paramOverride ?? {}, null, 2));
    setHeaderText(JSON.stringify(instance.headerOverride ?? {}, null, 2));
    setStatusText(JSON.stringify(instance.statusCodeMapping ?? {}, null, 2));
    setError(null);
  }

  return (
    <details
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 0,
        marginTop: 16,
      }}
    >
      <summary
        style={{
          padding: "12px 16px",
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 500,
        }}
      >
        <Settings2 size={16} />
        {t("channel.advanced")}
        {isActive && (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              fontSize: 11,
              background: "rgba(16,185,129,0.15)",
              color: "#10b981",
              border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: 4,
            }}
          >
            {t("channel.overridesActive")}
          </span>
        )}
      </summary>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid var(--color-border)" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          {t("channel.groupName")}
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="(optional, e.g. premium / free)"
            style={{ width: 240 }}
          />
          <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
            {t("channel.groupName.hint")}
          </small>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          {t("channel.priority")}
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{ width: 120 }}
          />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12 }}>{t("channel.paramOverride")}</label>
          <textarea
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            rows={5}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              padding: 8,
              border: paramParse.ok ? "1px solid var(--color-border)" : "1px solid #ef4444",
              borderRadius: 6,
              resize: "vertical",
            }}
            spellCheck={false}
          />
          {!paramParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>{t("channel.invalidJson")}: {paramParse.error}</small>}
          <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{t("channel.paramOverride.hint")}</small>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12 }}>{t("channel.headerOverride")}</label>
          <textarea
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            rows={5}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              padding: 8,
              border: headerParse.ok && reservedConflicts.length === 0
                ? "1px solid var(--color-border)"
                : "1px solid #ef4444",
              borderRadius: 6,
              resize: "vertical",
            }}
            spellCheck={false}
          />
          {!headerParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>{t("channel.invalidJson")}: {headerParse.error}</small>}
          {headerParse.ok && reservedConflicts.length > 0 && (
            <small style={{ color: "#ef4444", fontSize: 11 }}>
              {t("channel.reservedHeaderConflict").replace("{keys}", reservedConflicts.join(", "))}
            </small>
          )}
          <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{t("channel.headerOverride.hint")}</small>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12 }}>{t("channel.statusCodeMapping")}</label>
          <textarea
            value={statusText}
            onChange={(e) => setStatusText(e.target.value)}
            rows={4}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              padding: 8,
              border: statusParse.ok && statusValidation.invalidKeys.length === 0 && statusValidation.invalidValues.length === 0
                ? "1px solid var(--color-border)"
                : "1px solid #ef4444",
              borderRadius: 6,
              resize: "vertical",
            }}
            spellCheck={false}
          />
          {!statusParse.ok && <small style={{ color: "#ef4444", fontSize: 11 }}>{t("channel.invalidJson")}: {statusParse.error}</small>}
          {statusParse.ok && statusValidation.invalidKeys.length > 0 && (
            <small style={{ color: "#ef4444", fontSize: 11 }}>
              {t("channel.invalidStatusCodeKey").replace("{key}", statusValidation.invalidKeys.join(", "))}
            </small>
          )}
          {statusParse.ok && statusValidation.invalidValues.length > 0 && (
            <small style={{ color: "#ef4444", fontSize: 11 }}>
              Invalid values (use retry/disable/passthrough): {statusValidation.invalidValues.join(", ")}
            </small>
          )}
          <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{t("channel.statusCodeMapping.hint")}</small>
        </div>

        {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
        {saved && <div style={{ color: "#10b981", fontSize: 12 }}>✓ Saved</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
