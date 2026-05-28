/**
 * SpendBadge — Phase 32 — small inline badge showing today's spend vs cap.
 *
 * Lazy-fetches /admin/v1/spend/{key,team}/:id once per mount. Color-codes
 * based on remaining percentage:
 *   green  if remainingPct >= 50
 *   amber  if remainingPct in [10, 50)
 *   red    if remainingPct < 10
 */

import { useEffect, useState } from "react";

type SpendSnapshot = {
  scope: "key" | "team";
  id: string;
  day: { spent: number; cap: number | null; remainingPct: number | null };
  month: { spent: number; cap: number | null; remainingPct: number | null };
  lastBlocked: string | null;
};

type Props = {
  scope: "key" | "team";
  id: string;
  api: { get: <T>(path: string) => Promise<T> };
};

function colorFor(remainingPct: number | null): string {
  if (remainingPct === null) return "var(--color-text-muted)";
  if (remainingPct < 10) return "#ef4444";
  if (remainingPct < 50) return "#f59e0b";
  return "#10b981";
}

export function SpendBadge({ scope, id, api }: Props) {
  const [data, setData] = useState<SpendSnapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<SpendSnapshot>(`/admin/v1/spend/${scope}/${id}`)
      .then((r) => { if (active) setData(r); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [scope, id, api]);

  if (error || !data) return null;
  // Skip if no caps set
  if (data.day.cap === null && data.month.cap === null) return null;

  const dayBadge = data.day.cap !== null && (
    <span
      title={`Today: $${data.day.spent.toFixed(4)} / $${data.day.cap.toFixed(2)} · ${data.day.remainingPct?.toFixed(1) ?? "?"}% remaining`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: 8,
        padding: "1px 6px",
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        borderRadius: 10,
        background: `${colorFor(data.day.remainingPct)}22`,
        color: colorFor(data.day.remainingPct),
        border: `1px solid ${colorFor(data.day.remainingPct)}55`
      }}
    >
      ${data.day.spent.toFixed(2)} / ${data.day.cap.toFixed(0)}/d
    </span>
  );
  const monthBadge = data.month.cap !== null && (
    <span
      title={`This month: $${data.month.spent.toFixed(4)} / $${data.month.cap.toFixed(2)} · ${data.month.remainingPct?.toFixed(1) ?? "?"}% remaining`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: 4,
        padding: "1px 6px",
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        borderRadius: 10,
        background: `${colorFor(data.month.remainingPct)}22`,
        color: colorFor(data.month.remainingPct),
        border: `1px solid ${colorFor(data.month.remainingPct)}55`
      }}
    >
      ${data.month.spent.toFixed(2)} / ${data.month.cap.toFixed(0)}/mo
    </span>
  );

  return <>{dayBadge}{monthBadge}</>;
}
