/**
 * UsageChartsPanel — Phase 32 — Time-series charts for the Usage page.
 *
 * Three views (Trend / Proportion / Top) sharing one fetched dataset.
 * Metric switcher (cost / tokens / requests) re-renders client-side without re-fetch.
 *
 * This module pulls in recharts; lazy-load the panel at the call site so the
 * chart bundle does not ship with the main entry.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from "recharts";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
};

type AggregateBucketDatum = { cost: number; tokens: number; requests: number };

type AggregateSeries = {
  key: string;
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  perBucket: AggregateBucketDatum[];
};

type AggregateResult = {
  bucket: "hour" | "day";
  groupBy: "model" | "provider";
  from: string;
  to: string;
  buckets: string[];
  series: AggregateSeries[];
};

type ChartTab = "trend" | "proportion" | "top";
type Metric = "cost" | "tokens" | "requests";

type Props = {
  api: ApiClient;
  /** Page-level selected range from UsagePage */
  range: "today" | "24h" | "7d" | "30d" | "60d";
  /** Optional groupBy override; defaults to "model" */
  groupBy?: "model" | "provider";
};

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#84cc16", "#ec4899", "#f97316", "#6366f1",
  "#94a3b8" // _other = slate
];

function rangeToFromTo(range: Props["range"]): { from: Date; to: Date; bucket: "hour" | "day" } {
  const now = Date.now();
  const days = ({ "today": 1, "24h": 1, "7d": 7, "30d": 30, "60d": 60 } as const)[range];
  const from = new Date(now - days * 24 * 60 * 60 * 1000);
  const to = new Date(now);
  // Use day buckets for >= 14 days, hour otherwise
  const bucket: "hour" | "day" = days >= 14 ? "day" : "hour";
  return { from, to, bucket };
}

function metricValue(d: AggregateBucketDatum, metric: Metric): number {
  if (metric === "cost") return d.cost;
  if (metric === "tokens") return d.tokens;
  return d.requests;
}

function totalForMetric(s: AggregateSeries, metric: Metric): number {
  if (metric === "cost") return s.totalCost;
  if (metric === "tokens") return s.totalTokens;
  return s.totalRequests;
}

function formatMetric(value: number, metric: Metric): string {
  if (metric === "cost") return `$${value.toFixed(4)}`;
  if (metric === "tokens") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
  }
  return String(value);
}

function formatBucketLabel(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  if (bucket === "day") return d.toLocaleDateString();
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

export default function UsageChartsPanel({ api, range, groupBy = "model" }: Props) {
  const [tab, setTab] = useState<ChartTab>("trend");
  const [metric, setMetric] = useState<Metric>("cost");
  const [data, setData] = useState<AggregateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { from, to, bucket } = rangeToFromTo(range);
    setLoading(true);
    setError(null);
    api
      .get<AggregateResult>(
        `/admin/v1/usage/aggregate?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&bucket=${bucket}&groupBy=${groupBy}`
      )
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load aggregate");
        setLoading(false);
      });
  }, [api, range, groupBy]);

  const isEmpty = data && data.series.length === 0;

  // Build trend chart data: rows = buckets, columns = each series
  const trendData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((iso, idx) => {
      const row: Record<string, number | string> = {
        bucketLabel: formatBucketLabel(iso, data.bucket)
      };
      for (const s of data.series) {
        row[s.key] = metricValue(s.perBucket[idx], metric);
      }
      return row;
    });
  }, [data, metric]);

  const proportionData = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) => ({
      name: s.key,
      value: totalForMetric(s, metric)
    })).filter((d) => d.value > 0);
  }, [data, metric]);

  const topData = useMemo(() => {
    if (!data) return [];
    return [...data.series]
      .map((s) => ({ name: s.key, value: totalForMetric(s, metric) }))
      .sort((a, b) => b.value - a.value);
  }, [data, metric]);

  return (
    <article className="ovCard usageChartsPanel">
      <header className="ovCardHeader">
        <h3>Usage trends</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <div className="segmentedControl" style={{ height: 28 }}>
            <button type="button" className={`segmentedItem ${tab === "trend" ? "active" : ""}`} onClick={() => setTab("trend")}>Trend</button>
            <button type="button" className={`segmentedItem ${tab === "proportion" ? "active" : ""}`} onClick={() => setTab("proportion")}>Proportion</button>
            <button type="button" className={`segmentedItem ${tab === "top" ? "active" : ""}`} onClick={() => setTab("top")}>Top</button>
          </div>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} style={{ height: 28, fontSize: 12 }}>
            <option value="cost">Cost (USD)</option>
            <option value="tokens">Tokens</option>
            <option value="requests">Requests</option>
          </select>
        </div>
      </header>

      <div style={{ padding: 12, minHeight: 320 }}>
        {loading && <div style={{ textAlign: "center", color: "var(--color-text-muted)" }}>Loading…</div>}
        {error && <div style={{ textAlign: "center", color: "#ef4444" }}>{error}</div>}
        {!loading && !error && isEmpty && (
          <div style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "40px 0" }}>
            No usage in selected range
          </div>
        )}
        {!loading && !error && data && !isEmpty && tab === "trend" && (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="bucketLabel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMetric(v, metric)} />
              <Tooltip formatter={(v: number) => formatMetric(v, metric)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {data.series.map((s, idx) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="1"
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={0.6}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!loading && !error && data && !isEmpty && tab === "proportion" && (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={proportionData} dataKey="value" nameKey="name" outerRadius={120} label={(d) => d.name}>
                {proportionData.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatMetric(v, metric)} />
            </PieChart>
          </ResponsiveContainer>
        )}
        {!loading && !error && data && !isEmpty && tab === "top" && (
          <ResponsiveContainer width="100%" height={Math.max(200, 32 * topData.length + 60)}>
            <BarChart layout="vertical" data={topData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatMetric(v, metric)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v: number) => formatMetric(v, metric)} />
              <Bar dataKey="value" fill={COLORS[0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}
