/**
 * ProviderConnectionsCard — list of accounts/connections for a given catalog
 * provider. Shows status, runtime stats, and exposes Edit/Delete actions plus
 * an "Add Connection" button that opens ProviderAddConnectionModal.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";
import { ProviderAddConnectionModal } from "./ProviderAddConnectionModal";
import { ConfirmDialog } from "./ConfirmDialog";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type Account = {
  id: string;
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  status: "active" | "cooldown" | "disabled";
  maxConcurrency?: number;
  runtime?: {
    activeRequests?: number;
    totalRequests?: number;
    failedRequests?: number;
    consecutiveFailures?: number;
    lastError?: string;
  };
};

type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
  accountSelectionStrategy?: string;
};

type Props = {
  api: ApiClient;
  provider: CatalogProvider;
  /** Service kind being managed — used by the parent for context. */
  // eslint-disable-next-line react/no-unused-prop-types
  kind: ServiceKind;
};

export function ProviderConnectionsCard({ api, provider }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instance, setInstance] = useState<ProviderInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allAccounts, allInstances] = await Promise.all([
        api.getList<Account>("/admin/v1/accounts"),
        api.getList<ProviderInstance>("/admin/v1/provider-instances"),
      ]);
      setAccounts(allAccounts.filter((a) => a.providerType === provider.id));
      setInstance(allInstances.find((i) => i.type === provider.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [api, provider.id]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  function handleDelete(account: Account) {
    setPendingDelete(account);
  }

  async function confirmDelete() {
    const account = pendingDelete;
    if (!account) return;
    setPendingDelete(null);
    try {
      await api.delete(`/admin/v1/accounts/${account.id}`);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete connection");
    }
  }

  const isRoundRobin =
    (instance?.accountSelectionStrategy ?? "round_robin") === "round_robin";

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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Connections</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--color-text-muted, #6b7280)",
              cursor: "default",
            }}
            title="Round Robin strategy is configured at the provider instance level."
          >
            <input
              type="checkbox"
              checked={isRoundRobin}
              readOnly
              disabled
              style={{ accentColor: "var(--color-primary, #0ea5e9)" }}
            />
            Round Robin
          </label>
          <button
            type="button"
            className="primaryButton"
            onClick={() => setShowAdd(true)}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            <Plus size={14} />
            Add Connection
          </button>
        </div>
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

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
          Loading connections...
        </p>
      ) : accounts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
          No connections yet
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {accounts.map((account) => (
            <ConnectionRow
              key={account.id}
              account={account}
              onEdit={() => setEditing(account)}
              onDelete={() => handleDelete(account)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ProviderAddConnectionModal
          api={api}
          provider={provider}
          existingInstance={instance}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void fetchAll();
          }}
        />
      )}

      {editing && (
        <EditConnectionModal
          api={api}
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void fetchAll();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete connection"
          message={`Delete connection "${pendingDelete.displayName}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </article>
  );
}

function ConnectionRow({
  account,
  onEdit,
  onDelete,
}: {
  account: Account;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const total = account.runtime?.totalRequests ?? 0;
  const failed = account.runtime?.failedRequests ?? 0;
  const active = account.runtime?.activeRequests ?? 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 8px",
        gap: 12,
        borderTop: "1px solid var(--color-border-subtle, rgba(0,0,0,0.05))",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {account.displayName}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge status={account.status} />
          {active > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted, #6b7280)" }}>
              {active} active
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--color-text-muted, #6b7280)" }}>
            {total} requests
          </span>
          {failed > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-danger, #ef4444)" }}>
              {failed} failed
            </span>
          )}
          {account.runtime?.lastError && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-danger, #ef4444)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 240,
              }}
              title={account.runtime.lastError}
            >
              {account.runtime.lastError}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          className="iconButton"
          onClick={onEdit}
          title="Edit connection"
          style={{ padding: 6 }}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="iconButton"
          onClick={onDelete}
          title="Delete connection"
          style={{ padding: 6, color: "var(--color-danger, #ef4444)" }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Account["status"] }) {
  const className =
    status === "active" ? "active" : status === "cooldown" ? "cooldown" : "disabled";
  return <span className={`statusBadge ${className}`}>{status}</span>;
}

function EditConnectionModal({
  api,
  account,
  onClose,
  onSaved,
}: {
  api: ApiClient;
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [maxConcurrency, setMaxConcurrency] = useState(
    account.maxConcurrency ? String(account.maxConcurrency) : ""
  );
  const [enabled, setEnabled] = useState(account.status !== "disabled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {
        displayName: displayName.trim(),
      };
      if (maxConcurrency.trim()) {
        const parsed = parseInt(maxConcurrency, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          patch.maxConcurrency = parsed;
        }
      }
      await api.patch(`/admin/v1/accounts/${account.id}`, patch);
      const wasEnabled = account.status !== "disabled";
      if (wasEnabled !== enabled) {
        await api.post(
          `/admin/v1/accounts/${account.id}/${enabled ? "enable" : "disable"}`,
          {}
        );
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update connection");
    } finally {
      setSaving(false);
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
      <div className="modalContent" style={{ maxWidth: 480 }}>
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>Edit Connection</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form className="customProviderForm" onSubmit={(e) => void handleSave(e)}>
          <label className="routeFormLabel">
            Display Name
            <input
              className="routeNameInput"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My connection"
              required
            />
          </label>
          <label className="routeFormLabel">
            Max Concurrency
            <input
              className="routeNameInput"
              type="number"
              min={1}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(e.target.value)}
              placeholder="3"
            />
          </label>
          <label className="routeFormLabel" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          {error && (
            <div className="endpointError" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={saving || !displayName.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
