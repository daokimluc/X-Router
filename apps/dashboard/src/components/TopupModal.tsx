/**
 * TopupModal — add credit to an API key's balance.
 * POST /admin/v1/api-keys/:id/topup body { amount }
 */

import { useState } from "react";
import { X, DollarSign } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type Props = {
  apiKeyId: string;
  ownerLabel: string;
  currentBalance: number | undefined;
  api: ApiClient;
  onClose: () => void;
  onSuccess: (newBalance: number, added: number) => void;
};

const QUICK_AMOUNTS = [5, 10, 50, 100];

export function TopupModal({ apiKeyId, ownerLabel, currentBalance, api, onClose, onSuccess }: Props) {
  const { t } = useLang();
  const [amount, setAmount] = useState<string>("10.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUnlimited = currentBalance === undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ id: string; balance: number; added: number }>(
        `/admin/v1/api-keys/${apiKeyId}/topup`,
        { amount: parsed }
      );
      onSuccess(result.balance, result.added);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed");
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
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DollarSign size={18} />
            {t("apikey.topupTitle")}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => void submit(e)}
          style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            <div>
              <strong>{ownerLabel}</strong>
            </div>
            <div>
              {t("apikey.topupCurrent")}:{" "}
              {isUnlimited ? "∞" : `$${(currentBalance ?? 0).toFixed(2)}`}
            </div>
          </div>

          {isUnlimited && (
            <div
              style={{
                fontSize: 12,
                padding: "8px 10px",
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.4)",
                borderRadius: 6,
                color: "#d97706",
              }}
            >
              ⚠ {t("apikey.topupSwitchWarning")}
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("apikey.topupAmount")}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <small style={{ color: "var(--color-text-muted)" }}>{t("apikey.topupQuick")}</small>
            <div style={{ display: "flex", gap: 6 }}>
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="ghostButton"
                  onClick={() => setAmount(q.toFixed(2))}
                >
                  +${q}
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}

          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? "..." : t("apikey.topupAdd")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
