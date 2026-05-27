/**
 * ModelPricingFormModal — add or edit a model pricing entry.
 * PUT /admin/v1/model-pricing/:model (upsert).
 */

import { useState } from "react";
import { X } from "lucide-react";
import { useLang } from "../i18n";
import type { ModelPricing } from "./ModelPricingSection";

type ApiClient = {
  put: <T>(path: string, body: unknown) => Promise<T>;
};

type Props = {
  api: ApiClient;
  initial?: ModelPricing;
  onClose: () => void;
  onSaved: (entry: ModelPricing) => void;
};

export function ModelPricingFormModal({ api, initial, onClose, onSaved }: Props) {
  const { t } = useLang();
  const isEdit = Boolean(initial);
  const [model, setModel] = useState(initial?.model ?? "");
  const [inputRate, setInputRate] = useState(initial ? String(initial.inputRate) : "");
  const [outputRate, setOutputRate] = useState(initial ? String(initial.outputRate) : "");
  const [cachedRate, setCachedRate] = useState(
    initial?.cachedInputRate !== undefined ? String(initial.cachedInputRate) : ""
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const m = model.trim();
    const inN = Number.parseFloat(inputRate);
    const outN = Number.parseFloat(outputRate);
    if (!m) {
      setError("Model name is required");
      return;
    }
    if (!Number.isFinite(inN) || inN < 0) {
      setError("Input rate must be ≥ 0");
      return;
    }
    if (!Number.isFinite(outN) || outN < 0) {
      setError("Output rate must be ≥ 0");
      return;
    }
    const cachedN = cachedRate.trim() === "" ? undefined : Number.parseFloat(cachedRate);
    if (cachedN !== undefined && (!Number.isFinite(cachedN) || cachedN < 0)) {
      setError("Cached rate must be ≥ 0 or empty");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { inputRate: inN, outputRate: outN };
      if (cachedN !== undefined) body.cachedInputRate = cachedN;
      if (label.trim()) body.label = label.trim();
      const saved = await api.put<ModelPricing>(
        `/admin/v1/model-pricing/${encodeURIComponent(m)}`,
        body
      );
      onSaved(saved);
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
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>{isEdit ? t("pricing.editTitle") : t("pricing.addTitle")}</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => void submit(e)}
          style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.model")}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isEdit}
              placeholder="gpt-4o"
              autoFocus={!isEdit}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.inputRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={inputRate}
              onChange={(e) => setInputRate(e.target.value)}
              placeholder="2.50"
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.outputRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={outputRate}
              onChange={(e) => setOutputRate(e.target.value)}
              placeholder="10.00"
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.cachedRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={cachedRate}
              onChange={(e) => setCachedRate(e.target.value)}
              placeholder="(empty = no cached pricing)"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.label")}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="(optional)"
            />
          </label>
          {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? "..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
