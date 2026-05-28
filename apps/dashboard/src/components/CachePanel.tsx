/**
 * CachePanel — Phase 32 — semantic-response-cache.
 *
 * Shows cache stats: hit ratio, entries, bytes used, plus a flush button
 * for ops. Polls /admin/v1/cache/stats every 30s.
 */

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
};

type CacheStats = {
  entries: number;
  bytesUsed: number;
  bytesMax: number;
  hits: number;
  misses: number;
  hitRatio: number;
  evictions: number;
  topHot: Array<{ keyHash: string; hits: number; model: string; lastHit: string }>;
};

type Props = {
  api: ApiClient;
  refreshMs?: number;
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function CachePanel({ api, refreshMs = 30000 }: Props) {
  const { t } = useLang();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      api.get<CacheStats>("/admin/v1/cache/stats")
        .then((r) => { if (active) setStats(r); })
        .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Failed"); });
    };
    load();
    const handle = window.setInterval(load, refreshMs);
    return () => { active = false; window.clearInterval(handle); };
  }, [api, refreshMs]);

  async function flush() {
    if (busy || !window.confirm("Flush entire cache?")) return;
    setBusy(true);
    try {
      await api.delete("/admin/v1/cache");
      const next = await api.get<CacheStats>("/admin/v1/cache/stats");
      setStats(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flush failed");
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = stats && stats.entries === 0 && stats.hits === 0 && stats.misses === 0;

  return (
    <article className="ovCard">
      <header className="ovCardHeader">
        <Database size={16} />
        <h3>{t("ov.cache.title")}</h3>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{t("ov.cache.subtitle")}</span>
          {stats && stats.entries > 0 && (
            <button
              type="button"
              onClick={() => void flush()}
              disabled={busy}
              style={{
                padding: "2px 8px",
                fontSize: 10,
                background: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: 4,
                cursor: busy ? "not-allowed" : "pointer",
                color: "var(--color-text-muted)"
              }}
            >
              {t("ov.cache.flush")}
            </button>
          )}
        </span>
      </header>
      <div style={{ padding: "8px 12px" }}>
        {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
        {!error && isEmpty && (
          <div style={{ color: "var(--color-text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            {t("ov.cache.empty")}
          </div>
        )}
        {!error && stats && !isEmpty && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
            <div className="ovInfoItem">
              <span className="ovInfoLabel">{t("ov.cache.hitRatio")}</span>
              <span className="ovInfoValue" style={{ color: stats.hitRatio >= 0.5 ? "#10b981" : stats.hitRatio >= 0.2 ? "#f59e0b" : "var(--color-text-main)" }}>
                {(stats.hitRatio * 100).toFixed(1)}%
              </span>
            </div>
            <div className="ovInfoItem">
              <span className="ovInfoLabel">{t("ov.cache.entries")}</span>
              <span className="ovInfoValue">{stats.entries}</span>
            </div>
            <div className="ovInfoItem">
              <span className="ovInfoLabel">{t("ov.cache.hits")} / {t("ov.cache.misses")}</span>
              <span className="ovInfoValue">
                <span style={{ color: "#10b981" }}>{stats.hits}</span>
                {" / "}
                <span style={{ color: "var(--color-text-muted)" }}>{stats.misses}</span>
              </span>
            </div>
            <div className="ovInfoItem">
              <span className="ovInfoLabel">{t("ov.cache.bytes")}</span>
              <span className="ovInfoValue">
                {formatBytes(stats.bytesUsed)} / {formatBytes(stats.bytesMax)}
              </span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
