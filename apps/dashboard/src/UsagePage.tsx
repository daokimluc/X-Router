/**
 * Usage Page — modern analytics dashboard with topology, charts, and cost tracking.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Controls,
  Handle,
  type Node,
  type Edge,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
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
  cachedTokens?: number;
  estimatedCost?: number;
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

function estimateCost(record: Pick<UsageRecord, "model" | "promptTokens" | "completionTokens" | "estimatedCost">) {
  if (typeof record.estimatedCost === "number") {
    return { inputCost: 0, outputCost: 0, totalCost: record.estimatedCost };
  }
  const costs = MODEL_COSTS[record.model] ?? { input: 3.0, output: 15.0 };
  const inputCost = (record.promptTokens / 1_000_000) * costs.input;
  const outputCost = (record.completionTokens / 1_000_000) * costs.output;
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
  windsurf: { color: "#00D4AA", label: "Windsurf" },
  kiro: { color: "#FF6B35", label: "Kiro AI" },
  openai: { color: "#10a37f", label: "OpenAI" },
  anthropic: { color: "#D97757", label: "Anthropic" },
  google: { color: "#4285f4", label: "Google" },
  gemini: { color: "#4285F4", label: "Gemini" },
  opencode_free: { color: "#E87040", label: "OpenCode Free" },
  codex: { color: "#3B82F6", label: "OpenAI Codex" },
  cursor: { color: "#00D4AA", label: "Cursor" },
  "github-copilot": { color: "#333333", label: "GitHub Copilot" },
  deepseek: { color: "#4D6BFE", label: "DeepSeek" },
  groq: { color: "#F55036", label: "Groq" },
  openrouter: { color: "#F97316", label: "OpenRouter" },
  nvidia: { color: "#76B900", label: "NVIDIA NIM" },
  mistral: { color: "#FF7000", label: "Mistral" },
  together: { color: "#0F6FFF", label: "Together AI" },
  fireworks: { color: "#7B2EF2", label: "Fireworks AI" },
  xai: { color: "#1DA1F2", label: "xAI (Grok)" },
  cerebras: { color: "#FF4F00", label: "Cerebras" },
};

function getProviderMeta(type: string) {
  return PROVIDER_META[type] ?? { color: "#6b7280", label: type };
}

// ─── Main component ────────────────────────────────────────

type AccountInfo = {
  id: string;
  providerInstanceId: string;
  providerType: string;
  status: string;
};

export function UsagePage(props: {
  usage: UsageRecord[];
  providerInstances: ProviderInstanceInfo[];
  accounts?: AccountInfo[];
}) {
  const { usage, accounts = [] } = props;

  // Only show providers that have at least one account (not media-only providers)
  const providerInstancesWithAccounts = useMemo(() => {
    const instanceIdsWithAccounts = new Set(accounts.map((a) => a.providerInstanceId));
    return props.providerInstances.filter((p) => instanceIdsWithAccounts.has(p.id));
  }, [props.providerInstances, accounts]);

  const providerInstances = providerInstancesWithAccounts;
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
      totalCost += estimateCost(r).totalCost;
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
      const cost = estimateCost(r);
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

/** Gateway node with handles on all 4 sides */
function GatewayNode({ data }: { data: { label: string } }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #eff6ff, #ffffff)",
        border: "2px solid #0ea5e9",
        borderRadius: "10px",
        padding: "8px 18px",
        fontSize: "13px",
        fontWeight: 700,
        color: "#0ea5e9",
        boxShadow: "0 4px 14px rgba(14, 165, 233, 0.18)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "grab",
        letterSpacing: "-0.01em",
      }}
    >
      <Handle type="source" position={Position.Top} id="top" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      {data.label}
    </div>
  );
}

/** Provider node with handles on all 4 sides */
function ProviderNodeComponent({ data }: { data: { label: string; color: string; active: boolean; providerId: string; textIcon: string } }) {
  const { label, color, active, providerId, textIcon } = data;
  return (
    <div
      style={{
        background: "var(--color-surface, #ffffff)",
        border: `1.5px solid ${active ? color : "var(--color-border, #e5e7eb)"}`,
        borderRadius: "8px",
        padding: "7px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: active ? color : "var(--color-text-main, #1e293b)",
        boxShadow: active ? `0 0 12px ${color}25` : "0 1px 3px rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: "120px",
        cursor: "grab",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <Handle type="target" position={Position.Right} id="right" style={{ background: "transparent", border: 0, width: 0, height: 0 }} />
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 5,
          background: `${color}12`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <img
          src={`/provider-logos/${providerId}.png`}
          alt={label}
          style={{ width: 16, height: 16, borderRadius: 3, objectFit: "contain" }}
          onError={(e) => {
            const img = e.currentTarget;
            img.style.display = "none";
            const parent = img.parentElement;
            if (parent && !parent.querySelector("span")) {
              const span = document.createElement("span");
              span.textContent = textIcon;
              span.style.cssText = `font-size:9px;font-weight:800;color:${color}`;
              parent.appendChild(span);
            }
          }}
        />
      </div>
      {label}
    </div>
  );
}

const topologyNodeTypes = {
  gateway: GatewayNode,
  provider: ProviderNodeComponent,
};

function TopologyGraph(props: {
  providerInstances: ProviderInstanceInfo[];
  activeProviders: Set<string>;
}) {
  const { providerInstances, activeProviders } = props;

  const { initialNodes, initialEdges } = useMemo(() => {
    const connectedProviders = providerInstances.filter((p) => p.enabled);
    if (connectedProviders.length === 0) {
      return { initialNodes: [], initialEdges: [] };
    }

    const providerCount = connectedProviders.length;
    const nodeW = 180;
    const nodeH = 44;
    const routerW = 140;
    const routerH = 48;

    // Ellipse radii — scale with provider count
    const minRx = ((nodeW + 30) * providerCount) / (2 * Math.PI);
    const rx = Math.max(300, minRx);
    const ry = Math.max(180, rx * 0.55);

    const nodeList: Node[] = [
      {
        id: "gateway",
        type: "gateway",
        position: { x: -routerW / 2, y: -routerH / 2 },
        data: { label: "⚡ AI Gateway" },
        draggable: true,
      },
    ];

    connectedProviders.forEach((p, i) => {
      const meta = getProviderMeta(p.type);
      const isActive = activeProviders.has(p.id);

      // Distribute evenly starting from top (-π/2), clockwise
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / providerCount;
      const cx = rx * Math.cos(angle);
      const cy = ry * Math.sin(angle);

      nodeList.push({
        id: p.id,
        type: "provider",
        position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
        data: { label: meta.label, color: meta.color, active: isActive, providerId: p.type, textIcon: p.type.slice(0, 2).toUpperCase() },
        draggable: true,
      });
    });

    const edgeList: Edge[] = [];

    connectedProviders.forEach((p, i) => {
      const isActive = activeProviders.has(p.id);

      // Pick the gateway handle closest to this provider's angle
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / providerCount;
      let sourceHandle: string;
      let targetHandle: string;

      if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
        // Provider is more to the left or right
        sourceHandle = Math.cos(angle) > 0 ? "right" : "left";
        targetHandle = Math.cos(angle) > 0 ? "left" : "right";
      } else {
        // Provider is more above or below
        sourceHandle = Math.sin(angle) > 0 ? "bottom" : "top";
        targetHandle = Math.sin(angle) > 0 ? "top" : "bottom";
      }

      edgeList.push({
        id: `gateway-${p.id}`,
        source: "gateway",
        sourceHandle,
        target: p.id,
        targetHandle,
        type: "default",
        animated: isActive,
        style: {
          stroke: isActive ? "#22c55e" : "#94a3b8",
          strokeWidth: isActive ? 2.5 : 1.8,
          strokeDasharray: isActive ? undefined : "6 4",
        },
        markerEnd: isActive
          ? { type: MarkerType.ArrowClosed, color: "#22c55e", width: 18, height: 18 }
          : undefined,
      });
    });

    return { initialNodes: nodeList, initialEdges: edgeList };
  }, [providerInstances, activeProviders]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Restore saved positions from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("topology-node-positions");
      if (saved) {
        const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>;
        setNodes((nds) =>
          nds.map((n) => {
            const pos = positions[n.id];
            return pos ? { ...n, position: pos } : n;
          })
        );
      }
    } catch { /* ignore */ }
  }, []);

  // Sync when provider data changes (but preserve user positions)
  useMemo(() => {
    setNodes((prev) => {
      const prevPositions = new Map(prev.map((n) => [n.id, n.position]));
      return initialNodes.map((n) => ({
        ...n,
        position: prevPositions.get(n.id) ?? n.position,
      }));
    });
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Save positions on drag end
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Persist after position changes
      const hasPosChange = changes.some((c) => c.type === "position" && (c as { dragging?: boolean }).dragging === false);
      if (hasPosChange) {
        setTimeout(() => {
          setNodes((current) => {
            const positions: Record<string, { x: number; y: number }> = {};
            current.forEach((n) => { positions[n.id] = n.position; });
            try { localStorage.setItem("topology-node-positions", JSON.stringify(positions)); } catch { /* ignore */ }
            return current;
          });
        }, 0);
      }
    },
    [onNodesChange, setNodes]
  );

  if (initialNodes.length === 0) {
    return (
      <div className="usageEmptyMsg" style={{ height: 440, display: "flex", alignItems: "center", justifyContent: "center" }}>
        No connected providers
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 440 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={topologyNodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2, duration: 200 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        selectionOnDrag={false}
        panOnDrag={[1, 2]}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={true}
        minZoom={0.1}
        maxZoom={2}
        preventScrolling={false}
      >
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
        : estimateCost(r).totalCost;
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
