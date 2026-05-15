/**
 * Usage Page — modern analytics dashboard with topology, charts, and cost tracking.
 */

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ─── Types ─────────────────────────────────────────────────

export type UsageRecord = {
  id: string;
  requestId: string;
  protocol: string;
  model: string;
  providerType: string;
  providerInstanceId: string;
  accountId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
};

export type ProviderInstanceInfo = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
};

type TimeRange = "today" | "24h" | "7d" | "30d" | "60d";
type MetricMode = "tokens" | "cost";

// ─── Cost estimation (per 1M tokens) ──────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Public model names (as seen in usage records)
  "kiro-sonnet": { input: 3.0, output: 15.0 },
  "windsurf-sonnet": { input: 3.0, output: 15.0 },
  // Upstream model names
  "claude-sonnet-4.5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6-thinking": { input: 3.0, output: 15.0 },
  "claude-opus-4.7": { input: 15.0, output: 75.0 },
  "claude-haiku-4.5": { input: 0.8, output: 4.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gemini-3-flash": { input: 0.075, output: 0.3 },
  "deepseek-v4": { input: 0.27, output: 1.1 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number) {
  const costs = MODEL_COSTS[model] ?? { input: 3.0, output: 15.0 };
  const inputCost = (promptTokens / 1_000_000) * costs.input;
  const outputCost = (completionTokens / 1_000_000) * costs.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

/** Format cost: show enough decimals to be meaningful */
function formatCost(cost: number): string {
  if (cost === 0) return "0.00";
  if (cost < 0.001) return cost.toFixed(6);
  if (cost < 0.01) return cost.toFixed(4);
  if (cost < 1) return cost.toFixed(3);
  return cost.toFixed(2);
}

// ─── Time helpers ──────────────────────────────────────────

function getTimeRangeMs(range: TimeRange): number {
  switch (range) {
    case "today": return Date.now() - new Date().setHours(0, 0, 0, 0);
    case "24h": return 24 * 3600_000;
    case "7d": return 7 * 24 * 3600_000;
    case "30d": return 30 * 24 * 3600_000;
    case "60d": return 60 * 24 * 3600_000;
  }
}

function filterByRange(records: UsageRecord[], range: TimeRange): UsageRecord[] {
  const cutoff = Date.now() - getTimeRangeMs(range);
  return records.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Provider logos/colors ─────────────────────────────────

const PROVIDER_META: Record<string, { color: string; label: string }> = {
  windsurf: { color: "#06b6d4", label: "Windsurf" },
  kiro: { color: "#8b5cf6", label: "Kiro AI" },
  openai: { color: "#10a37f", label: "OpenAI" },
  anthropic: { color: "#d97706", label: "Anthropic" },
  google: { color: "#4285f4", label: "Google" },
};

function getProviderMeta(type: string) {
  return PROVIDER_META[type] ?? { color: "#6b7280", label: type };
}

// ─── Main component ────────────────────────────────────────

export function UsagePage(props: {
  usage: UsageRecord[];
  providerInstances: ProviderInstanceInfo[];
}) {
  const { usage, providerInstances } = props;
  const [range, setRange] = useState<TimeRange>("7d");
  const [view, setView] = useState<"overview" | "details">("overview");
  const [metricMode, setMetricMode] = useState<MetricMode>("tokens");

  const filtered = useMemo(() => {
    const records = filterByRange(usage, range);
    // Sort newest first
    return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [usage, range]);

  const totals = useMemo(() => {
    let requests = 0, inputTokens = 0, outputTokens = 0, totalCost = 0;
    for (const r of filtered) {
      requests++;
      inputTokens += r.promptTokens;
      outputTokens += r.completionTokens;
      totalCost += estimateCost(r.model, r.promptTokens, r.completionTokens).totalCost;
    }
    return { requests, inputTokens, outputTokens, totalCost };
  }, [filtered]);

  const modelStats = useMemo(() => {
    const map = new Map<string, {
      model: string; provider: string; requests: number;
      inputTokens: number; outputTokens: number;
      inputCost: number; outputCost: number; totalCost: number;
      lastUsed: string;
    }>();
    for (const r of filtered) {
      const existing = map.get(r.model);
      const cost = estimateCost(r.model, r.promptTokens, r.completionTokens);
      if (existing) {
        existing.requests++;
        existing.inputTokens += r.promptTokens;
        existing.outputTokens += r.completionTokens;
        existing.inputCost += cost.inputCost;
        existing.outputCost += cost.outputCost;
        existing.totalCost += cost.totalCost;
        if (r.createdAt > existing.lastUsed) existing.lastUsed = r.createdAt;
      } else {
        map.set(r.model, {
          model: r.model, provider: r.providerType, requests: 1,
          inputTokens: r.promptTokens, outputTokens: r.completionTokens,
          inputCost: cost.inputCost, outputCost: cost.outputCost,
          totalCost: cost.totalCost, lastUsed: r.createdAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [filtered]);

  // Which providers had traffic in the last 30 seconds (for topology animation)
  const activeProviders = useMemo(() => {
    const thirtySecAgo = Date.now() - 30_000;
    const active = new Set<string>();
    for (const r of usage) {
      if (new Date(r.createdAt).getTime() >= thirtySecAgo) {
        active.add(r.providerInstanceId);
      }
    }
    return active;
  }, [usage]);

  return (
    <div className="usagePage">
      {/* Header */}
      <div className="usageHeader">
        <div className="usageViewToggle segmentedControl">
          <button className={`segmentedItem ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>Overview</button>
          <button className={`segmentedItem ${view === "details" ? "active" : ""}`} onClick={() => setView("details")}>Details</button>
        </div>
        <div className="usageRangeToggle segmentedControl">
          {(["today", "24h", "7d", "30d", "60d"] as TimeRange[]).map((r) => (
            <button key={r} className={`segmentedItem ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
              {r === "today" ? "Today" : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="usageSummaryGrid">
        <div className="usageCard usageCard--default">
          <span className="usageCardLabel">TOTAL REQUESTS</span>
          <span className="usageCardValue">{totals.requests.toLocaleString()}</span>
        </div>
        <div className="usageCard usageCard--green">
          <span className="usageCardLabel">TOTAL INPUT TOKENS</span>
          <span className="usageCardValue">{totals.inputTokens.toLocaleString()}</span>
        </div>
        <div className="usageCard usageCard--orange">
          <span className="usageCardLabel">OUTPUT TOKENS</span>
          <span className="usageCardValue">{totals.outputTokens.toLocaleString()}</span>
        </div>
        <div className="usageCard usageCard--accent">
          <span className="usageCardLabel">EST. COST</span>
          <span className="usageCardValue">~${formatCost(totals.totalCost)}</span>
          <span className="usageCardSub">Estimated, not actual billing</span>
        </div>
      </div>

      {view === "overview" && (
        <>
          {/* Topology + Recent */}
          <div className="usageMiddleRow">
            <div className="usageTopologyWrap">
              <TopologyGraph
                providerInstances={providerInstances}
                activeProviders={activeProviders}
              />
            </div>
            <div className="usageRecentWrap">
              <h3 className="usageSectionTitle">RECENT REQUESTS</h3>
              <RecentList records={filtered.slice(0, 12)} />
            </div>
          </div>

          {/* Chart */}
          <div className="usageChartWrap">
            <div className="usageChartControls">
              <div className="segmentedControl">
                <button className={`segmentedItem ${metricMode === "tokens" ? "active" : ""}`} onClick={() => setMetricMode("tokens")}>Tokens</button>
                <button className={`segmentedItem ${metricMode === "cost" ? "active" : ""}`} onClick={() => setMetricMode("cost")}>Cost</button>
              </div>
            </div>
            <UsageChart records={filtered} mode={metricMode} range={range} />
          </div>
        </>
      )}

      {/* Model table */}
      <div className="usageTableWrap">
        <div className="usageTableControls">
          <span className="usageSectionTitle">Usage by Model</span>
          <div className="segmentedControl">
            <button className={`segmentedItem ${metricMode === "cost" ? "active" : ""}`} onClick={() => setMetricMode("cost")}>Costs</button>
            <button className={`segmentedItem ${metricMode === "tokens" ? "active" : ""}`} onClick={() => setMetricMode("tokens")}>Tokens</button>
          </div>
        </div>
        <ModelTable stats={modelStats} mode={metricMode} />
      </div>
    </div>
  );
}

// ─── Topology Graph ────────────────────────────────────────

function TopologyGraph(props: {
  providerInstances: ProviderInstanceInfo[];
  activeProviders: Set<string>;
}) {
  const { providerInstances, activeProviders } = props;

  const { nodes, edges } = useMemo(() => {
    const enabledProviders = providerInstances.filter((p) => p.enabled);
    const providerCount = enabledProviders.length;
    const centerY = 140;
    const rightStartY = Math.max(60, centerY - (providerCount - 1) * 45);

    const nodeList: Node[] = [
      {
        id: "clients",
        position: { x: 30, y: centerY - 20 },
        data: { label: "IDE Clients" },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          padding: "10px 18px",
          fontSize: "12px",
          fontWeight: 500,
        },
      },
      {
        id: "gateway",
        position: { x: 260, y: centerY - 25 },
        data: { label: "⚡ AI Gateway" },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: "linear-gradient(135deg, #f0f9ff, #fff)",
          border: "2px solid #0ea5e9",
          borderRadius: "14px",
          padding: "12px 22px",
          fontSize: "13px",
          fontWeight: 700,
          boxShadow: "0 4px 12px rgba(229, 106, 74, 0.15)",
        },
      },
    ];

    enabledProviders.forEach((p, i) => {
      const meta = getProviderMeta(p.type);
      const isActive = activeProviders.has(p.id);
      nodeList.push({
        id: p.id,
        position: { x: 500, y: rightStartY + i * 90 },
        data: { label: `${meta.label}` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: isActive
            ? `linear-gradient(135deg, ${meta.color}15, #fff)`
            : "#f8fafc",
          border: `1.5px solid ${isActive ? meta.color : "#e2e8f0"}`,
          borderRadius: "10px",
          padding: "10px 18px",
          fontSize: "12px",
          fontWeight: 600,
          color: isActive ? meta.color : "#64748b",
          boxShadow: isActive ? `0 2px 8px ${meta.color}20` : "none",
          transition: "all 0.3s ease",
        },
      });
    });

    const edgeList: Edge[] = [
      {
        id: "clients-gateway",
        source: "clients",
        target: "gateway",
        animated: activeProviders.size > 0,
        style: { stroke: "#0ea5e9", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#0ea5e9" },
      },
    ];

    enabledProviders.forEach((p) => {
      const meta = getProviderMeta(p.type);
      const isActive = activeProviders.has(p.id);
      edgeList.push({
        id: `gateway-${p.id}`,
        source: "gateway",
        target: p.id,
        animated: isActive,
        style: {
          stroke: isActive ? meta.color : "#cbd5e1",
          strokeWidth: isActive ? 2 : 1,
          strokeDasharray: isActive ? undefined : "5 5",
        },
        markerEnd: isActive
          ? { type: MarkerType.ArrowClosed, color: meta.color }
          : undefined,
      });
    });

    return { nodes: nodeList, edges: edgeList };
  }, [providerInstances, activeProviders]);

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={true}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="#f1f5f9" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// ─── Recent Requests ───────────────────────────────────────

function RecentList({ records }: { records: UsageRecord[] }) {
  if (records.length === 0) {
    return <p className="usageEmptyMsg">No requests in this period</p>;
  }
  const now = Date.now();
  return (
    <div className="usageRecentList">
      <div className="usageRecentHead">
        <span>Model</span>
        <span>In / Out</span>
        <span>When</span>
      </div>
      {records.map((r) => {
        const meta = getProviderMeta(r.providerType);
        const isNew = now - new Date(r.createdAt).getTime() < 10_000;
        return (
          <div key={r.id} className={`usageRecentRow ${isNew ? "usageRecentRow--new" : ""}`}>
            <span className="usageRecentModel">
              <span className="usageRecentDot" style={{ background: meta.color }} />
              {r.model}
            </span>
            <span className="usageRecentTokens">
              <span className="tIn">{r.promptTokens.toLocaleString()}↑</span>{" "}
              <span className="tOut">{r.completionTokens.toLocaleString()}↓</span>
            </span>
            <span className="usageRecentWhen">{timeAgo(r.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart (SVG) ───────────────────────────────────────────

function UsageChart(props: { records: UsageRecord[]; mode: MetricMode; range: TimeRange }) {
  const { records, mode, range } = props;
  const W = 820, H = 200, P = 48;

  const chartData = useMemo(() => {
    if (records.length === 0) return [];
    const dayMap = new Map<string, number>();
    for (const r of records) {
      const day = new Date(r.createdAt).toISOString().slice(0, 10);
      const val = mode === "tokens"
        ? r.promptTokens + r.completionTokens
        : estimateCost(r.model, r.promptTokens, r.completionTokens).totalCost;
      dayMap.set(day, (dayMap.get(day) ?? 0) + val);
    }
    const days = Math.max(Math.ceil(getTimeRangeMs(range) / 86_400_000), 1);
    const result: { date: string; value: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, value: dayMap.get(key) ?? 0 });
    }
    return result;
  }, [records, mode, range]);

  if (chartData.length === 0) return <div className="usageEmptyMsg">No data</div>;

  const maxVal = Math.max(...chartData.map((d) => d.value), 1);
  const xStep = (W - P * 2) / Math.max(chartData.length - 1, 1);
  const pts = chartData.map((d, i) => ({
    x: P + i * xStep,
    y: H - P - (d.value / maxVal) * (H - P * 2),
  }));

  // Smooth curve
  const line = pts.map((p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const cpx = (prev.x + p.x) / 2;
    return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
  }).join(" ");

  const area = `${line} L ${pts[pts.length - 1].x} ${H - P} L ${P} ${H - P} Z`;

  const yLabels = [0, 0.5, 1].map((pct) => ({
    value: maxVal * (1 - pct),
    y: P + pct * (H - P * 2),
  }));

  const xLabelStep = Math.max(Math.floor(chartData.length / 6), 1);

  function fmtVal(v: number) {
    if (mode === "cost") return `$${v.toFixed(2)}`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(0);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="usageChartSvg">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yLabels.map((yl, i) => (
        <g key={i}>
          <line x1={P} y1={yl.y} x2={W - P} y2={yl.y} stroke="#f1f5f9" strokeWidth={1} />
          <text x={6} y={yl.y + 4} fontSize={10} fill="#94a3b8">{fmtVal(yl.value)}</text>
        </g>
      ))}
      <path d={area} fill="url(#chartGrad)" />
      <path d={line} fill="none" stroke="#6366f1" strokeWidth={2.5} strokeLinecap="round" />
      {chartData.map((d, i) => {
        if (i % xLabelStep !== 0 && i !== chartData.length - 1) return null;
        const x = P + i * xStep;
        return (
          <text key={d.date} x={x} y={H + 14} fontSize={10} fill="#94a3b8" textAnchor="middle">
            {new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Model Table ───────────────────────────────────────────

function ModelTable(props: {
  stats: Array<{
    model: string; provider: string; requests: number;
    inputTokens: number; outputTokens: number;
    inputCost: number; outputCost: number; totalCost: number;
    lastUsed: string;
  }>;
  mode: MetricMode;
}) {
  const { stats, mode } = props;
  if (stats.length === 0) return <p className="usageEmptyMsg">No usage data</p>;

  return (
    <table className="usageModelTable">
      <thead>
        <tr>
          <th>MODEL ↑</th>
          <th>PROVIDER</th>
          <th>REQUESTS</th>
          <th>LAST USED</th>
          {mode === "cost" ? <><th>INPUT COST</th><th>OUTPUT COST</th><th>TOTAL COST</th></> : <><th>INPUT</th><th>OUTPUT</th><th>TOTAL</th></>}
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.model}>
            <td className="usageModelCell">{s.model}</td>
            <td><span className="usageProviderBadge" style={{ borderColor: getProviderMeta(s.provider).color, color: getProviderMeta(s.provider).color }}>{s.provider || "—"}</span></td>
            <td>{s.requests}</td>
            <td className="usageTimeCell">{timeAgo(s.lastUsed)}</td>
            {mode === "cost" ? (
              <>
                <td>${formatCost(s.inputCost)}</td>
                <td>${formatCost(s.outputCost)}</td>
                <td className="usageTotalHighlight">${formatCost(s.totalCost)}</td>
              </>
            ) : (
              <>
                <td>{s.inputTokens.toLocaleString()}</td>
                <td>{s.outputTokens.toLocaleString()}</td>
                <td className="usageTotalHighlight">{(s.inputTokens + s.outputTokens).toLocaleString()}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
