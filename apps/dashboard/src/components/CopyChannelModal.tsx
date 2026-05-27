/**
 * CopyChannelModal — duplicate a provider instance with a new id (Phase 25).
 * POST /admin/v1/provider-instances/:id/copy
 */

import { useState } from "react";
import { X, Copy as CopyIcon } from "lucide-react";

type ApiClient = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type Props = {
  sourceId: string;
  sourceName: string;
  api: ApiClient;
  onClose: () => void;
  onSuccess: (newId: string) => void;
};

export function CopyChannelModal({ sourceId, sourceName, api, onClose, onSuccess }: Props) {
  const [newId, setNewId] = useState(`${sourceId}_copy`);
  const [newName, setNewName] = useState(`${sourceName} (copy)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const id = newId.trim();
    const name = newName.trim();
    if (!id) {
      setError("New id is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/v1/provider-instances/${sourceId}/copy`, {
        newId: id,
        newName: name || undefined
      });
      onSuccess(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
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
      <div className="modalContent" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CopyIcon size={18} /> Copy channel
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Duplicate <code>{sourceId}</code> with all its config (overrides, priority, group). The
            copy starts disabled.
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            New ID
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="provider_xxx_copy"
              required
              autoFocus
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            New display name (optional)
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="(defaults to '<name> (copy)')"
            />
          </label>

          {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}

          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? "..." : "Create copy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
