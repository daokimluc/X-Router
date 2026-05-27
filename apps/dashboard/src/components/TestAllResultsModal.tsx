/**
 * TestAllResultsModal — display POST /admin/v1/test-all results.
 */

import { useState } from "react";
import { X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useLang } from "../i18n";

export type TestAllResult = {
  providerInstanceId: string;
  type: string;
  name: string;
  status: "ok" | "degraded" | "down" | "error";
  message?: string;
  durationMs: number;
};

export type TestAllPayload = {
  summary: { total: number; ok: number; degraded: number; down: number };
  results: TestAllResult[];
};

type Props = {
  payload: TestAllPayload;
  onClose: () => void;
};

type Filter = "all" | "ok" | "degraded" | "down";

function statusIcon(status: TestAllResult["status"]) {
  if (status === "ok") return <CheckCircle2 size={14} style={{ color: "#10b981" }} />;
  if (status === "degraded") return <AlertTriangle size={14} style={{ color: "#f59e0b" }} />;
  return <XCircle size={14} style={{ color: "#ef4444" }} />;
}

export function TestAllResultsModal({ payload, onClose }: Props) {
  const { t } = useLang();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = payload.results.filter((r) => {
    if (filter === "all") return true;
    if (filter === "down") return r.status === "down" || r.status === "error";
    return r.status === filter;
  });

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
        style={{
          maxWidth: 720,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>{t("prov.testResults")}</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div
          style={{
            padding: "12px 20px",
            display: "flex",
            gap: 16,
            alignItems: "center",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <CheckCircle2 size={14} style={{ color: "#10b981" }} /> {payload.summary.ok}{" "}
            {t("prov.testSummary.ok")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <AlertTriangle size={14} style={{ color: "#f59e0b" }} />{" "}
            {payload.summary.degraded} {t("prov.testSummary.degraded")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <XCircle size={14} style={{ color: "#ef4444" }} /> {payload.summary.down}{" "}
            {t("prov.testSummary.down")}
          </span>
        </div>

        <div
          style={{
            padding: "8px 20px",
            display: "flex",
            gap: 6,
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {(["all", "ok", "degraded", "down"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "primaryButton" : "ghostButton"}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? `${t("prov.testFilter.all")} (${payload.results.length})`
                : f === "ok"
                  ? `${t("prov.testSummary.ok")} (${payload.summary.ok})`
                  : f === "degraded"
                    ? `${t("prov.testSummary.degraded")} (${payload.summary.degraded})`
                    : `${t("prov.testSummary.down")} (${payload.summary.down})`}
            </button>
          ))}
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--color-text-muted)",
                fontSize: 13,
              }}
            >
              {t("prov.testEmpty")}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.providerInstanceId}
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <td style={{ padding: "8px 12px", width: 28 }}>{statusIcon(r.status)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <strong>{r.name}</strong>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {r.type}
                      </div>
                      {r.message && (
                        <div
                          style={{
                            fontSize: 11,
                            color:
                              r.status === "down" || r.status === "error"
                                ? "#ef4444"
                                : "var(--color-text-muted)",
                            marginTop: 2,
                          }}
                        >
                          ↳ {r.message}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        textAlign: "right",
                        color: "var(--color-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.durationMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="routeModalFooter">
          <button type="button" className="primaryButton" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
