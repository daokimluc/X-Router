/**
 * UptimePanel — Phase 27 — 24h hourly request bar chart + uptime stats.
 */

import { TrendingUp } from "lucide-react";

type Props = {
  sparkData: number[];
  errorRate: string;
  totalRequests: number;
};

export function UptimePanel({ sparkData, errorRate, totalRequests }: Props) {
  const max = Math.max(1, ...sparkData);
  const total24h = sparkData.reduce((a, b) => a + b, 0);
  const peak = max;
  const peakHour = sparkData.indexOf(max);
  const errPct = Number.parseFloat(errorRate);
  const uptime = totalRequests > 0 ? Math.max(0, 100 - errPct).toFixed(1) : "100.0";

  return (
    <article className="ovCard">
      <header className="ovCardHeader">
        <TrendingUp size={16} />
        <h3>Last 24 hours</h3>
      </header>
      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, marginBottom: 12 }}>
          {sparkData.map((v, i) => {
            const h = max > 0 ? Math.max(2, (v / max) * 60) : 2;
            const isPeak = v === max && max > 0;
            return (
              <div
                key={i}
                title={`${i === 23 ? "now" : `${23 - i}h ago`}: ${v} req`}
                style={{
                  flex: 1,
                  height: h,
                  background: isPeak ? "#3b82f6" : v > 0 ? "rgba(59, 130, 246, 0.5)" : "var(--color-surface-2, #1f2937)",
                  borderRadius: 2,
                  transition: "background 0.2s",
                  cursor: "default",
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 12 }}>
          <div>
            <div style={{ color: "var(--color-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>24h Total</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{total24h.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Peak</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {peak} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-muted)" }}>{peakHour >= 0 ? `@ ${23 - peakHour}h` : ""}</span>
            </div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Uptime</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: errPct > 5 ? "#f59e0b" : errPct > 20 ? "#ef4444" : "#10b981" }}>
              {uptime}%
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
