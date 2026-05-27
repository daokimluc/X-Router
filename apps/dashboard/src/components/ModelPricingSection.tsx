/**
 * ModelPricingSection — table CRUD for per-model token pricing.
 * GET    /admin/v1/model-pricing
 * PUT    /admin/v1/model-pricing/:model  (upsert)
 * DELETE /admin/v1/model-pricing/:model
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Edit3, Trash2, X } from "lucide-react";
import { useLang } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModelPricingFormModal } from "./ModelPricingFormModal";

export type ModelPricing = {
  model: string;
  inputRate: number;
  outputRate: number;
  cachedInputRate?: number;
  label?: string;
  updatedAt: string; // ISO from JSON
};

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
};

type Props = { api: ApiClient };

function fmt(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ModelPricingSection({ api }: Props) {
  const { t } = useLang();
  const [entries, setEntries] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ModelPricing | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModelPricing | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ModelPricing[]>("/admin/v1/model-pricing");
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pricing");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter(
          (e) =>
            e.model.toLowerCase().includes(q) ||
            (e.label ?? "").toLowerCase().includes(q)
        )
      : entries;
    return [...list].sort((a, b) => a.model.localeCompare(b.model));
  }, [entries, search]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await api.delete(`/admin/v1/model-pricing/${encodeURIComponent(target.model)}`);
      setEntries((prev) => prev.filter((e) => e.model !== target.model));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function upsertEntry(entry: ModelPricing) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.model === entry.model);
      if (idx === -1) return [...prev, entry];
      const next = prev.slice();
      next[idx] = entry;
      return next;
    });
    setEditing(null);
    setShowAdd(false);
  }

  return (
    <section className="endpointCard" style={{ marginTop: 20 }}>
      <header className="endpointCardHeader endpointCardHeaderRow">
        <div>
          <h2>{t("pricing.title")}</h2>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              margin: "4px 0 0",
            }}
          >
            {t("pricing.subtitle")}
          </p>
        </div>
        <button type="button" className="primaryButton" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> {t("pricing.add")}
        </button>
      </header>

      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <Search size={14} style={{ color: "var(--color-text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pricing.search")}
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            fontSize: 13,
            outline: "none",
            color: "inherit",
          }}
        />
        {search && (
          <button
            className="iconButton compact"
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {loading && (
        <div style={{ padding: 16, fontSize: 13, color: "var(--color-text-muted)" }}>
          Loading...
        </div>
      )}
      {error && (
        <div style={{ padding: 16, color: "#ef4444", fontSize: 13 }}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          {t("pricing.empty")}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-surface-2)" }}>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>
                {t("pricing.col.model")}
              </th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>
                {t("pricing.col.input")}
              </th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>
                {t("pricing.col.output")}
              </th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>
                {t("pricing.col.cached")}
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>
                {t("pricing.col.updated")}
              </th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>
                {t("pricing.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.model} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "8px 12px" }}>
                  <code style={{ fontSize: 12 }}>{entry.model}</code>
                  {entry.label && (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      {entry.label}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt(entry.inputRate)}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt(entry.outputRate)}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {entry.cachedInputRate !== undefined ? fmt(entry.cachedInputRate) : "—"}
                </td>
                <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>
                  {relTime(entry.updatedAt)}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  <button
                    className="iconButton compact"
                    type="button"
                    title="Edit"
                    onClick={() => setEditing(entry)}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    className="iconButton compact danger"
                    type="button"
                    title="Delete"
                    onClick={() => setPendingDelete(entry)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(showAdd || editing) && (
        <ModelPricingFormModal
          api={api}
          initial={editing ?? undefined}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={upsertEntry}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete pricing"
          message={t("pricing.confirmDelete").replace("{model}", pendingDelete.model)}
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
