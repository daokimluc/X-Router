/**
 * ApiKeyEditModal — full edit for an API key.
 * Tabs: Basic / Limits / Restrictions.
 * PATCH /admin/v1/api-keys/:id
 */

import { useState } from "react";
import { X, KeyRound, Gauge, Shield } from "lucide-react";
import { useLang } from "../i18n";
import { IpAllowlistInput } from "./IpAllowlistInput";
import { ModelMultiSelect } from "./ModelMultiSelect";

type ApiClient = {
  getList: <T>(path: string) => Promise<T[]>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
};

export type ApiKeyForEdit = {
  id: string;
  owner?: string;
  enabled: boolean;
  balance?: number;
  rpmLimit?: number;
  dailyLimit?: number;
  dailyTokenLimit?: number;
  expiresAt?: string;
  allowedModels?: string[];
  allowedIps?: string[];
  groupName?: string;
  crossGroupRetry?: boolean;
  teamId?: string;
  /** Phase 32 — spending caps */
  dailySpendLimitUsd?: number;
  monthlySpendLimitUsd?: number;
};

type Team = { id: string; name: string };

type Props = {
  apiKey: ApiKeyForEdit;
  api: ApiClient;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
};

type Tab = "basic" | "limits" | "restrictions";

const EXPIRE_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: "1h", ms: 3600_000 },
  { label: "24h", ms: 86_400_000 },
  { label: "7d", ms: 7 * 86_400_000 },
  { label: "30d", ms: 30 * 86_400_000 },
  { label: "90d", ms: 90 * 86_400_000 },
  { label: "Never", ms: null },
];

function toDatetimeLocal(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local expects YYYY-MM-DDTHH:mm in local time (no tz)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ApiKeyEditModal({ apiKey, api, teams, onClose, onSaved }: Props) {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("basic");
  const [owner, setOwner] = useState(apiKey.owner ?? "");
  const [teamId, setTeamId] = useState(apiKey.teamId ?? "");
  const [groupName, setGroupName] = useState(apiKey.groupName ?? "");
  const [enabled, setEnabled] = useState(apiKey.enabled);
  const [rpmLimit, setRpmLimit] = useState(apiKey.rpmLimit ? String(apiKey.rpmLimit) : "");
  const [dailyLimit, setDailyLimit] = useState(apiKey.dailyLimit ? String(apiKey.dailyLimit) : "");
  const [dailyTokenLimit, setDailyTokenLimit] = useState(apiKey.dailyTokenLimit ? String(apiKey.dailyTokenLimit) : "");
  const [expiresLocal, setExpiresLocal] = useState(toDatetimeLocal(apiKey.expiresAt));
  const [allowedModels, setAllowedModels] = useState<string[]>(apiKey.allowedModels ?? []);
  const [allowedIps, setAllowedIps] = useState<string[]>(apiKey.allowedIps ?? []);
  const [crossGroupRetry, setCrossGroupRetry] = useState(apiKey.crossGroupRetry ?? false);
  const [dailySpendLimitUsd, setDailySpendLimitUsd] = useState(apiKey.dailySpendLimitUsd ? String(apiKey.dailySpendLimitUsd) : "");
  const [monthlySpendLimitUsd, setMonthlySpendLimitUsd] = useState(apiKey.monthlySpendLimitUsd ? String(apiKey.monthlySpendLimitUsd) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(preset: typeof EXPIRE_PRESETS[number]) {
    if (preset.ms === null) {
      setExpiresLocal("");
      return;
    }
    const target = new Date(Date.now() + preset.ms);
    setExpiresLocal(toDatetimeLocal(target.toISOString()));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        owner: owner.trim() || undefined,
        teamId: teamId || undefined,
        enabled,
        rpmLimit: rpmLimit ? Number.parseInt(rpmLimit, 10) : 0,
        dailyLimit: dailyLimit ? Number.parseInt(dailyLimit, 10) : 0,
        dailyTokenLimit: dailyTokenLimit ? Number.parseInt(dailyTokenLimit, 10) : 0,
        expiresAt: expiresLocal ? datetimeLocalToIso(expiresLocal) : null,
        allowedModels,
        allowedIps,
        groupName: groupName.trim() || null,
        crossGroupRetry,
        dailySpendLimitUsd: dailySpendLimitUsd ? Number.parseFloat(dailySpendLimitUsd) : null,
        monthlySpendLimitUsd: monthlySpendLimitUsd ? Number.parseFloat(monthlySpendLimitUsd) : null,
      };
      await api.patch(`/admin/v1/api-keys/${apiKey.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modalContent"
        style={{ maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>Edit API key</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {([
            ["basic", t("apikey.tab.basic"), KeyRound],
            ["limits", t("apikey.tab.limits"), Gauge],
            ["restrictions", t("apikey.tab.restrictions"), Shield],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "primaryButton" : "ghostButton"}
              style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {tab === "basic" && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Owner
                <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. claude-code" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Team
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">No team</option>
                  {teams.map((tt) => (
                    <option key={tt.id} value={tt.id}>{tt.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                {t("apikey.field.groupName")}
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="(optional, reserved for routing)"
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enabled
              </label>
            </>
          )}

          {tab === "limits" && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Requests per minute (0 = no limit)
                <input
                  type="number"
                  min="0"
                  value={rpmLimit}
                  onChange={(e) => setRpmLimit(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Daily request quota (0 = no limit)
                <input
                  type="number"
                  min="0"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Daily token quota (0 = no limit)
                <input
                  type="number"
                  min="0"
                  value={dailyTokenLimit}
                  onChange={(e) => setDailyTokenLimit(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                {t("apikey.spend.daily")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("apikey.spend.unlimited")}
                  value={dailySpendLimitUsd}
                  onChange={(e) => setDailySpendLimitUsd(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                {t("apikey.spend.monthly")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("apikey.spend.unlimited")}
                  value={monthlySpendLimitUsd}
                  onChange={(e) => setMonthlySpendLimitUsd(e.target.value)}
                />
              </label>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Balance: {apiKey.balance === undefined ? "∞ unlimited" : `$${apiKey.balance.toFixed(2)}`}
                <br />
                <small>Use the Top up button on the row to add credit.</small>
              </div>
            </>
          )}

          {tab === "restrictions" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12 }}>{t("apikey.field.expiresAt")}</label>
                <input
                  type="datetime-local"
                  value={expiresLocal}
                  onChange={(e) => setExpiresLocal(e.target.value)}
                />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {EXPIRE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="ghostButton"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                      onClick={() => applyPreset(p)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                  Empty = never expires
                </small>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12 }}>{t("apikey.field.allowedModels")}</label>
                <ModelMultiSelect api={api} value={allowedModels} onChange={setAllowedModels} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12 }}>{t("apikey.field.allowedIps")}</label>
                <IpAllowlistInput value={allowedIps} onChange={setAllowedIps} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={crossGroupRetry}
                  onChange={(e) => setCrossGroupRetry(e.target.checked)}
                />
                {t("apikey.field.crossGroupRetry")}
              </label>
              <small style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: -8 }}>
                {t("apikey.field.crossGroupRetry.hint")}
              </small>
            </>
          )}
        </div>

        {error && (
          <div style={{ padding: "0 20px 8px", color: "#ef4444", fontSize: 12 }}>{error}</div>
        )}

        <div className="routeModalFooter">
          <button type="button" className="ghostButton" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primaryButton" onClick={() => void save()} disabled={busy}>
            {busy ? "..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
