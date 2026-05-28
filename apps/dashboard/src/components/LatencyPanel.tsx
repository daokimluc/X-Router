/**
 * LatencyPanel — Phase 32 — latency-observability.
 *
 * Top-10 channels by p95 over the last 5 minutes. Polls /admin/v1/metrics/latency
 * at the same cadence as the rest of the Overview data.
 */

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
};

type LatencyPercentiles = {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

type LatencyTuple = {
  providerInstanceId: string;
  publicModel: string;
  accountId: string;
  ok: LatencyPercentiles;
  error: LatencyPercentiles;
};

type LatencySnapshot = {
  windowSeconds: number;
  tuples: LatencyTuple[];
};

type Props = {
  api: ApiClient;
  /** Refresh interval in ms; defaults to 30s to match Overview poll. */
  refreshMs?: number;
};

function formatMs(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}

function p95Color(p95: number | null): string {
  if (p95 === null) return "var(--color-text-muted)";
  if (p95 < 1000) return "#10b981"; // green
  if (p95 < 5000) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

export function LatencyPanel({ api, refreshMs = 30000 }: Props) {
  const { t } = useLang();
  const [data, setData] = useState<LatencySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = () => {
      api
        .get<LatencySnapshot>("/admin/v1/metrics/latency")
        .then((r) => {
          if (active) setData(r);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "Failed");
        });
    };

    load();
    const handle = window.setInterval(load, refreshMs);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [api, refreshMs]);

  // Top-10 by p95 (only ok bucket, since errors usually hit the timeout cap)
  const topByP95 = (data?.tuples ?? [])
    .filter((t) => t.ok.p95 !== null)
    .sort((a, b) => (b.ok.p95 ?? 0) - (a.ok.p95 ?? 0))
    .slice(0, 10);

  return (
    <article className="ovCard">
      <header className="ovCardHeader">
        <Timer size={16} />
        <h3>{t("ov.latency.title")}</h3>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>
          {t("ov.latency.subtitle")}
        </span>
      </header>
      <div style={{ padding: "8px 12px" }}>
        {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
        {!error && data && topByP95.length === 0 && (
          <div style={{ color: "var(--color-text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
            {t("ov.latency.empty")}
          </div>
        )}
        {topByP95.map((tup) => (
          <div
            key={`${tup.providerInstanceId}|${tup.publicModel}|${tup.accountId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 0",
              fontSize: 11,
              borderBottom: "1px solid var(--color-border)"
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <code style={{ fontSize: 11 }}>{tup.providerInstanceId}</code>
              <span style={{ color: "var(--color-text-muted)", marginLeft: 4 }}>
                {tup.publicModel}
              </span>
            </span>
            <span style={{ color: p95Color(tup.ok.p95), fontWeight: 600, minWidth: 60, textAlign: "right" }}>
              {formatMs(tup.ok.p95)}
            </span>
            <span style={{ color: "var(--color-text-muted)", minWidth: 50, textAlign: "right" }}>
              {t("ov.latency.ok")} {tup.ok.count}
            </span>
            {tup.error.count > 0 && (
              <span style={{ color: "#ef4444", minWidth: 40, textAlign: "right" }}>
                {t("ov.latency.err")} {tup.error.count}
              </span>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}
