/**
 * SyncModelsModal — preview-then-confirm sync from upstream.
 * POST /admin/v1/provider-instances/:id/sync-models
 *   - First call (no body): preview { discovered, new[], removed[] }
 *   - Second call ({autoCreate:true}): create all new mappings
 */

import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type SyncResponse = {
  providerInstanceId: string;
  discovered: number;
  new: Array<{ id: string; upstreamModel: string }>;
  removed: Array<{ id: string; publicModel: string }>;
  autoCreated?: string[];
};

type Props = {
  api: ApiClient;
  providerInstanceId: string;
  providerInstanceName: string;
  onClose: () => void;
  onApplied: (createdCount: number) => void;
};

const PREVIEW_LIMIT = 8;

export function SyncModelsModal({
  api,
  providerInstanceId,
  providerInstanceName,
  onClose,
  onApplied,
}: Props) {
  const { t } = useLang();
  const [phase, setPhase] = useState<"loading" | "preview" | "applying" | "error">("loading");
  const [preview, setPreview] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.post<SyncResponse>(
          `/admin/v1/provider-instances/${providerInstanceId}/sync-models`,
          {}
        );
        setPreview(result);
        setPhase("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to discover models");
        setPhase("error");
      }
    })();
  }, [api, providerInstanceId]);

  async function applySync() {
    if (!preview || phase === "applying") return;
    setPhase("applying");
    setError(null);
    try {
      const result = await api.post<SyncResponse>(
        `/admin/v1/provider-instances/${providerInstanceId}/sync-models`,
        { autoCreate: true }
      );
      onApplied(result.autoCreated?.length ?? preview.new.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setPhase("preview");
    }
  }

  const newCount = preview?.new.length ?? 0;
  const removedCount = preview?.removed.length ?? 0;
  const newPreview = (preview?.new ?? []).slice(0, PREVIEW_LIMIT);
  const newOverflow = Math.max(0, newCount - PREVIEW_LIMIT);

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
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={18} />
            {t("prov.syncTitle")}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Provider instance: <code>{providerInstanceName}</code>
          </div>

          {phase === "loading" && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                fontSize: 13,
                color: "var(--color-text-muted)",
              }}
            >
              {t("prov.syncDiscovering")}
            </div>
          )}

          {phase === "error" && (
            <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>
          )}

          {(phase === "preview" || phase === "applying") && preview && (
            <>
              <div style={{ fontSize: 13 }}>
                {t("prov.syncDiscovered")
                  .replace("{n}", String(preview.discovered))
                  .replace("{newN}", String(newCount))
                  .replace("{removedN}", String(removedCount))}
              </div>

              {newCount === 0 && (
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {t("prov.syncAllMapped")}
                </div>
              )}

              {newCount > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    {t("prov.syncNewHeader")}
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: 12,
                      fontFamily: "monospace",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    {newPreview.map((m) => (
                      <li key={m.id}>+ {m.upstreamModel}</li>
                    ))}
                    {newOverflow > 0 && (
                      <li style={{ color: "var(--color-text-muted)" }}>
                        {t("prov.syncMore").replace("{n}", String(newOverflow))}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {removedCount > 0 && (
                <div
                  style={{
                    padding: 8,
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.3)",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: "#d97706",
                    }}
                  >
                    {t("prov.syncRemovedHeader")}
                  </div>
                  <div
                    style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}
                  >
                    ⚠ {t("prov.syncRemovedNote")}
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: 12,
                      fontFamily: "monospace",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    {preview.removed.map((m) => (
                      <li key={m.id}>• {m.publicModel}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && phase === "preview" && (
                <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>
              )}
            </>
          )}
        </div>

        <div className="routeModalFooter">
          <button
            type="button"
            className="ghostButton"
            onClick={onClose}
            disabled={phase === "applying"}
          >
            Cancel
          </button>
          {(phase === "preview" || phase === "applying") && newCount > 0 && (
            <button
              type="button"
              className="primaryButton"
              onClick={() => void applySync()}
              disabled={phase === "applying"}
            >
              {phase === "applying"
                ? "..."
                : t("prov.syncAdd").replace("{n}", String(newCount))}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
