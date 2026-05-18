/**
 * Proxy Pools Page — manage proxy pools for provider connections.
 * Features: batch import, Vercel relay deploy, bulk operations, health checks.
 */

import { useState } from "react";
import {
  Plus, Upload, Cloud, Trash2, Pencil, FlaskConical,
  CheckSquare, Square, ToggleLeft, ToggleRight,
  AlertCircle, CheckCircle, XCircle, Network, Shield,
  RefreshCw, X
} from "lucide-react";

type ProxyType = "http" | "vercel";
type ProxyTestStatus = "unknown" | "active" | "error";

type ProxyPool = {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
  type: ProxyType;
  testStatus: ProxyTestStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  boundConnectionCount?: number;
  createdAt: string;
  updatedAt: string;
};

type ProxyTestResult = {
  ok: boolean;
  status: number;
  statusText?: string;
  error?: string;
  elapsedMs: number;
  testedAt: string;
};

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};


function parseProxyLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  // Format: http://user:pass@host:port or socks5://...
  if (/^(https?|socks[45]):\/\//i.test(trimmed)) return trimmed;
  // Format: host:port:user:pass
  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${user}:${pass}@${host}:${port}`;
  }
  // Format: host:port
  if (parts.length === 2) {
    return `http://${parts[0]}:${parts[1]}`;
  }
  return null;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ProxyPoolsPage(props: { api: ApiClient; refresh: () => Promise<void> }) {
  const [pools, setPools] = useState<ProxyPool[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingPool, setEditingPool] = useState<ProxyPool | null>(null);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [showVercelDeploy, setShowVercelDeploy] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, ProxyTestResult | "loading">>({});
  const [error, setError] = useState<string | null>(null);
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk health check
  const [healthCheckRunning, setHealthCheckRunning] = useState(false);
  const [healthCheckProgress, setHealthCheckProgress] = useState({ done: 0, total: 0 });
  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  if (!loaded) {
    props.api
      .getList<ProxyPool>("/admin/v1/proxy-pools?includeUsage=true")
      .then(setPools)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }

  async function reload() {
    const data = await props.api.getList<ProxyPool>("/admin/v1/proxy-pools?includeUsage=true");
    setPools(data);
  }

  async function toggleActive(pool: ProxyPool) {
    // Optimistic update
    setPools((prev) =>
      prev.map((p) => (p.id === pool.id ? { ...p, isActive: !p.isActive } : p))
    );
    try {
      await props.api.patch(`/admin/v1/proxy-pools/${pool.id}`, { isActive: !pool.isActive });
    } catch (err) {
      // Revert on failure
      setPools((prev) =>
        prev.map((p) => (p.id === pool.id ? { ...p, isActive: pool.isActive } : p))
      );
      setError(err instanceof Error ? err.message : "Failed to toggle");
    }
  }

  function confirmDelete(pool: ProxyPool) {
    if ((pool.boundConnectionCount ?? 0) > 0) {
      setError(`Cannot delete "${pool.name}" — it has ${pool.boundConnectionCount} bound connection(s). Unbind them first.`);
      return;
    }
    setConfirmDialog({
      title: "Delete Proxy Pool",
      message: `Are you sure you want to delete "${pool.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await props.api.delete(`/admin/v1/proxy-pools/${pool.id}`);
          await reload();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to delete");
        }
      },
    });
  }

  async function testPool(pool: ProxyPool) {
    setTestResults((prev) => ({ ...prev, [pool.id]: "loading" }));
    try {
      const result = await props.api.post<{ data: ProxyTestResult }>(
        `/admin/v1/proxy-pools/${pool.id}/test`,
        {}
      );
      const testResult = (result as unknown as { data: ProxyTestResult }).data ?? (result as unknown as ProxyTestResult);
      setTestResults((prev) => ({ ...prev, [pool.id]: testResult }));
      await reload();
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [pool.id]: {
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : "Test failed",
          elapsedMs: 0,
          testedAt: new Date().toISOString(),
        },
      }));
    }
  }


  // Bulk operations
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === pools.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pools.map((p) => p.id)));
    }
  }

  async function bulkActivate(active: boolean) {
    const ids = Array.from(selected);
    try {
      await Promise.all(ids.map((id) => props.api.patch(`/admin/v1/proxy-pools/${id}`, { isActive: active })));
      setSelected(new Set());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk operation failed");
    }
  }

  function bulkDelete() {
    const ids = Array.from(selected);
    const boundPools = pools.filter((p) => ids.includes(p.id) && (p.boundConnectionCount ?? 0) > 0);
    if (boundPools.length > 0) {
      setError(`Cannot delete ${boundPools.length} pool(s) with bound connections. Unbind them first.`);
      return;
    }
    setConfirmDialog({
      title: "Bulk Delete",
      message: `Delete ${ids.length} selected proxy pool(s)? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await Promise.all(ids.map((id) => props.api.delete(`/admin/v1/proxy-pools/${id}`)));
          setSelected(new Set());
          await reload();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Bulk delete failed");
        }
      },
    });
  }

  async function bulkHealthCheck() {
    const targetPools = selected.size > 0
      ? pools.filter((p) => selected.has(p.id))
      : pools;
    setHealthCheckRunning(true);
    setHealthCheckProgress({ done: 0, total: targetPools.length });

    const deadIds: string[] = [];
    // Process in batches of 10
    for (let i = 0; i < targetPools.length; i += 10) {
      const batch = targetPools.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (pool) => {
          const res = await props.api.post<{ data: ProxyTestResult }>(
            `/admin/v1/proxy-pools/${pool.id}/test`,
            {}
          );
          const testResult = (res as unknown as { data: ProxyTestResult }).data ?? (res as unknown as ProxyTestResult);
          setTestResults((prev) => ({ ...prev, [pool.id]: testResult }));
          return { id: pool.id, ok: testResult.ok };
        })
      );
      results.forEach((r) => {
        if (r.status === "fulfilled" && !r.value.ok) deadIds.push(r.value.id);
        if (r.status === "rejected") deadIds.push(batch[results.indexOf(r)]?.id ?? "");
      });
      setHealthCheckProgress((prev) => ({ ...prev, done: Math.min(i + 10, targetPools.length) }));
    }

    setHealthCheckRunning(false);
    await reload();

    if (deadIds.length > 0) {
      setConfirmDialog({
        title: "Dead Proxies Found",
        message: `${deadIds.length} proxy pool(s) failed the health check. Disable them?`,
        onConfirm: async () => {
          setConfirmDialog(null);
          try {
            await Promise.all(deadIds.map((id) => props.api.patch(`/admin/v1/proxy-pools/${id}`, { isActive: false })));
            await reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to disable dead proxies");
          }
        },
      });
    }
  }

  function openEdit(pool: ProxyPool) {
    setEditingPool(pool);
    setShowForm(true);
  }

  function openCreate() {
    setEditingPool(null);
    setShowForm(true);
  }

  const activeCount = pools.filter((p) => p.isActive).length;


  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle">Proxy Pools</h2>
          <p className="routesSubtitle">Manage reusable HTTP proxies for provider connections</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="ghostButton" onClick={() => setShowBatchImport(true)}>
            <Upload size={15} /> Batch Import
          </button>
          <button className="ghostButton" onClick={() => setShowVercelDeploy(true)}>
            <Cloud size={15} /> Vercel Relay
          </button>
          <button className="ghostButton" onClick={() => void bulkHealthCheck()} disabled={healthCheckRunning}>
            <FlaskConical size={15} /> {healthCheckRunning ? `Testing ${healthCheckProgress.done}/${healthCheckProgress.total}` : "Health Check"}
          </button>
          <button className="primaryButton" onClick={openCreate}>
            <Plus size={16} /> Add Pool
          </button>
        </div>
      </div>

      {error && (
        <div className="endpointError" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AlertCircle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <button className="iconButton" onClick={() => setError(null)} style={{ width: 24, height: 24, minHeight: "auto" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Stats bar */}
      {pools.length > 0 && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="routeModelTag">Total: {pools.length}</span>
          <span className="routeModelTag" style={{ color: "var(--color-success)" }}>Active: {activeCount}</span>
        </div>
      )}

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px", background: "var(--color-surface-2)", borderRadius: "10px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)" }}>
            {selected.size} selected
          </span>
          <button className="actionButton" onClick={() => void bulkActivate(true)}>
            <ToggleRight size={14} /> Activate
          </button>
          <button className="actionButton" onClick={() => void bulkActivate(false)}>
            <ToggleLeft size={14} /> Deactivate
          </button>
          <button className="actionButton" style={{ color: "var(--color-danger)" }} onClick={bulkDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {pools.length === 0 && loaded ? (
        <div className="routesEmpty">
          <Network size={24} />
          <p>No proxy pools configured</p>
          <small>Create a proxy pool to route provider connections through HTTP proxies</small>
        </div>
      ) : (
        <div className="routesList">
          {/* Select all header */}
          {pools.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
              <button
                className="iconButton"
                onClick={toggleSelectAll}
                style={{ width: 28, height: 28, minHeight: "auto" }}
                title={selected.size === pools.length ? "Deselect all" : "Select all"}
              >
                {selected.size === pools.length && pools.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 600 }}>
                {selected.size === pools.length && pools.length > 0 ? "Deselect All" : "Select All"}
              </span>
            </div>
          )}
          {pools.map((pool) => {
            const testResult = testResults[pool.id];
            return (
              <div
                key={pool.id}
                className={`routeCard ${!pool.isActive ? "routeCard--disabled" : ""}`}
              >
                <div className="routeCardLeft">
                  {/* Checkbox */}
                  <button
                    className="iconButton"
                    onClick={() => toggleSelect(pool.id)}
                    style={{ width: 28, height: 28, minHeight: "auto" }}
                  >
                    {selected.has(pool.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <div className="routeCardInfo">
                    <strong>{pool.name}</strong>
                    <div className="routeModelTags">
                      {/* Test status badge */}
                      {pool.testStatus === "active" && (
                        <span className="routeModelTag" style={{ color: "#10b981" }}>
                          <CheckCircle size={11} /> Healthy
                        </span>
                      )}
                      {pool.testStatus === "error" && (
                        <span className="routeModelTag" style={{ color: "#ef4444" }}>
                          <XCircle size={11} /> Error
                        </span>
                      )}
                      {pool.testStatus === "unknown" && (
                        <span className="routeModelTag" style={{ color: "var(--color-text-subtle)" }}>
                          <AlertCircle size={11} /> Unknown
                        </span>
                      )}
                      {/* Active/inactive badge */}
                      <span className="routeModelTag" style={{ color: pool.isActive ? "#10b981" : "var(--color-text-subtle)" }}>
                        {pool.isActive ? "Active" : "Inactive"}
                      </span>
                      {/* Vercel relay badge */}
                      {pool.type === "vercel" && (
                        <span className="routeModelTag" style={{ color: "var(--color-primary)" }}>
                          <Cloud size={11} /> Vercel Relay
                        </span>
                      )}
                      {/* Bound count */}
                      <span className="routeModelTag">
                        <Network size={11} /> {pool.boundConnectionCount ?? 0} bound
                      </span>
                      {/* Strict proxy */}
                      {pool.strictProxy && (
                        <span className="routeModelTag">
                          <Shield size={11} /> Strict
                        </span>
                      )}
                    </div>
                    {/* Proxy URL */}
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "monospace", marginTop: "4px" }}>
                      {pool.proxyUrl}
                    </div>
                    {/* noProxy rules */}
                    {pool.noProxy && (
                      <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "2px" }}>
                        No-proxy: {pool.noProxy}
                      </div>
                    )}
                    {/* Last tested */}
                    {pool.lastTestedAt && (
                      <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", marginTop: "2px" }}>
                        Tested {formatRelativeTime(pool.lastTestedAt)}
                        {pool.lastError && <span style={{ color: "#ef4444" }}> — {pool.lastError}</span>}
                      </div>
                    )}
                    {/* Inline test result */}
                    {testResult && testResult !== "loading" && (
                      <div style={{ fontSize: "11px", marginTop: "4px" }}>
                        {testResult.ok ? (
                          <span style={{ color: "#10b981" }}>✓ OK — {testResult.elapsedMs}ms</span>
                        ) : (
                          <span style={{ color: "#ef4444" }}>✗ {testResult.error || `HTTP ${testResult.status}`}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="routeCardRight">
                  <button
                    className="endpointKeyBtn"
                    onClick={() => void testPool(pool)}
                    disabled={testResult === "loading"}
                    title="Test proxy connectivity"
                  >
                    {testResult === "loading" ? <RefreshCw size={13} className="spin" /> : <FlaskConical size={13} />}
                    {testResult === "loading" ? " Testing..." : " Test"}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pool.isActive}
                    className={`toggleSwitch ${pool.isActive ? "on" : "off"}`}
                    onClick={() => void toggleActive(pool)}
                  >
                    <span className="toggleSwitchKnob" />
                  </button>
                  <button className="iconButton" title="Edit" onClick={() => openEdit(pool)}>
                    <Pencil size={16} />
                  </button>
                  <button className="iconButton danger" title="Delete" onClick={() => confirmDelete(pool)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <ProxyPoolFormModal
          api={props.api}
          pool={editingPool}
          onClose={() => { setShowForm(false); setEditingPool(null); }}
          onSaved={() => { setShowForm(false); setEditingPool(null); void reload(); }}
        />
      )}

      {/* Batch Import Modal */}
      {showBatchImport && (
        <BatchImportModal
          api={props.api}
          existingUrls={pools.map((p) => p.proxyUrl)}
          onClose={() => setShowBatchImport(false)}
          onImported={() => { setShowBatchImport(false); void reload(); }}
        />
      )}

      {/* Vercel Deploy Modal */}
      {showVercelDeploy && (
        <VercelDeployModal
          api={props.api}
          onClose={() => setShowVercelDeploy(false)}
          onDeployed={() => { setShowVercelDeploy(false); void reload(); }}
        />
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}


/* ─── Confirm Dialog ─── */
function ConfirmDialog(props: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div className="modalContent" style={{ maxWidth: "420px" }}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{props.title}</h2>
          <button className="iconButton" onClick={props.onCancel}><X size={20} /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            {props.message}
          </p>
        </div>
        <div className="routeModalFooter">
          <button className="ghostButton" onClick={props.onCancel}>Cancel</button>
          <button
            className="primaryButton"
            style={{ background: "var(--color-danger)", boxShadow: "none" }}
            onClick={props.onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Batch Import Modal ─── */
function BatchImportModal(props: {
  api: ApiClient;
  existingUrls: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);

  async function doImport() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: string[] = [];
    for (const line of lines) {
      const url = parseProxyLine(line);
      if (url) parsed.push(url);
    }
    if (parsed.length === 0) {
      setError("No valid proxy URLs found. Supported formats: http://user:pass@host:port or host:port:user:pass");
      return;
    }
    // Deduplicate against existing
    const existingSet = new Set(props.existingUrls);
    const unique = parsed.filter((u) => !existingSet.has(u));
    const skipped = parsed.length - unique.length;

    if (unique.length === 0) {
      setImportResult({ added: 0, skipped });
      return;
    }

    setBusy(true);
    setError("");
    try {
      let added = 0;
      for (const url of unique) {
        const name = `Imported-${Date.now()}-${added + 1}`;
        await props.api.post("/admin/v1/proxy-pools", {
          name,
          proxyUrl: url,
          noProxy: "",
          type: "http",
          strictProxy: false,
        });
        added++;
      }
      setImportResult({ added, skipped });
      setTimeout(() => props.onImported(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent routeModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>Batch Import Proxies</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--color-text-muted)" }}>
            Paste proxy URLs, one per line. Supported formats:
          </p>
          <div style={{ fontSize: "12px", fontFamily: "monospace", padding: "8px 10px", background: "var(--color-bg)", borderRadius: "8px", marginBottom: "12px", color: "var(--color-text-muted)" }}>
            http://user:pass@host:port<br />
            socks5://user:pass@host:port<br />
            host:port:user:pass<br />
            host:port
          </div>
          <textarea
            style={{
              width: "100%",
              minHeight: "160px",
              border: "1px solid var(--color-border)",
              borderRadius: "9px",
              padding: "10px",
              fontFamily: "monospace",
              fontSize: "12px",
              resize: "vertical",
              background: "var(--color-bg)",
              color: "var(--color-text-main)",
            }}
            placeholder="http://user:pass@proxy1.example.com:8080&#10;192.168.1.1:3128:admin:secret&#10;..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          {error && <div style={{ color: "#ef4444", fontSize: "13px", marginTop: "8px" }}>{error}</div>}
          {importResult && (
            <div style={{ color: "#10b981", fontSize: "13px", marginTop: "8px" }}>
              ✓ Added {importResult.added} pool(s), skipped {importResult.skipped} duplicate(s)
            </div>
          )}
        </div>
        <div className="routeModalFooter">
          <button className="ghostButton" onClick={props.onClose}>Cancel</button>
          <button
            className="primaryButton"
            disabled={busy || !text.trim()}
            onClick={() => void doImport()}
          >
            {busy ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ─── Vercel Deploy Modal ─── */
function VercelDeployModal(props: {
  api: ApiClient;
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [vercelToken, setVercelToken] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function deploy() {
    if (!vercelToken.trim() || !projectName.trim()) {
      setError("Both Vercel API token and project name are required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.api.post("/admin/v1/proxy-pools/vercel-deploy", {
        vercelToken: vercelToken.trim(),
        projectName: projectName.trim(),
      });
      setSuccess(true);
      setTimeout(() => props.onDeployed(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent routeModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>Deploy Vercel Relay</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          {/* Info box */}
          <div style={{
            padding: "12px 14px",
            background: "color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))",
            border: "1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border))",
            borderRadius: "10px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <Cloud size={16} style={{ flexShrink: 0, marginTop: "2px", color: "var(--color-primary)" }} />
              <div>
                <strong style={{ color: "var(--color-text-main)" }}>What is Vercel Relay?</strong>
                <p style={{ margin: "4px 0 0" }}>
                  Vercel Relay deploys a serverless function on Vercel that acts as a proxy relay.
                  This allows you to route API requests through Vercel's edge network, providing
                  a clean IP address and bypassing regional restrictions without maintaining your own proxy server.
                </p>
              </div>
            </div>
          </div>

          <label className="routeFormLabel">
            Vercel API Token
            <input
              className="routeNameInput"
              type="password"
              value={vercelToken}
              onChange={(e) => setVercelToken(e.target.value)}
              placeholder="Enter your Vercel API token"
              autoFocus
            />
            <small style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
              Generate at vercel.com/account/tokens
            </small>
          </label>
          <label className="routeFormLabel" style={{ marginTop: "12px" }}>
            Project Name
            <input
              className="routeNameInput"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-relay-proxy"
            />
            <small style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
              A unique name for the Vercel project (will be created if it doesn't exist)
            </small>
          </label>

          {error && <div style={{ color: "#ef4444", fontSize: "13px", marginTop: "12px" }}>{error}</div>}
          {success && (
            <div style={{ color: "#10b981", fontSize: "13px", marginTop: "12px" }}>
              ✓ Vercel Relay deployed successfully! A new proxy pool has been created.
            </div>
          )}
        </div>
        <div className="routeModalFooter">
          <button className="ghostButton" onClick={props.onClose}>Cancel</button>
          <button
            className="primaryButton"
            disabled={busy || !vercelToken.trim() || !projectName.trim()}
            onClick={() => void deploy()}
          >
            {busy ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ─── Create/Edit Form Modal ─── */
function ProxyPoolFormModal(props: {
  api: ApiClient;
  pool: ProxyPool | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!props.pool;
  const [name, setName] = useState(props.pool?.name ?? "");
  const [proxyUrl, setProxyUrl] = useState(props.pool?.proxyUrl ?? "");
  const [noProxy, setNoProxy] = useState(props.pool?.noProxy ?? "");
  const [type, setType] = useState<ProxyType>(props.pool?.type ?? "http");
  const [strictProxy, setStrictProxy] = useState(props.pool?.strictProxy ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !proxyUrl.trim()) {
      setError("Name and Proxy URL are required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        name: name.trim(),
        proxyUrl: proxyUrl.trim(),
        noProxy: noProxy.trim(),
        type,
        strictProxy,
      };
      if (isEdit) {
        await props.api.patch(`/admin/v1/proxy-pools/${props.pool!.id}`, body);
      } else {
        await props.api.post("/admin/v1/proxy-pools", body);
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent routeModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{isEdit ? "Edit Proxy Pool" : "Add Proxy Pool"}</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>
        <form className="routeForm" onSubmit={(e) => void submit(e)}>
          <label className="routeFormLabel">
            Name
            <input
              className="routeNameInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="US West Proxy"
              autoFocus
            />
          </label>
          <label className="routeFormLabel">
            Proxy URL
            <input
              className="routeNameInput"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://user:pass@proxy.example.com:8080"
            />
          </label>
          <label className="routeFormLabel">
            No-Proxy Rules
            <input
              className="routeNameInput"
              value={noProxy}
              onChange={(e) => setNoProxy(e.target.value)}
              placeholder=".internal.com,localhost"
            />
            <small style={{ fontSize: "11px", color: "#9ca3af" }}>
              Comma-separated hostnames or patterns to bypass the proxy
            </small>
          </label>
          <label className="routeFormLabel">
            Type
            <select
              className="routeNameInput"
              value={type}
              onChange={(e) => setType(e.target.value as ProxyType)}
            >
              <option value="http">HTTP / SOCKS</option>
              <option value="vercel">Vercel Relay</option>
            </select>
          </label>
          <label className="routeFormLabel" style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={strictProxy}
              onChange={(e) => setStrictProxy(e.target.checked)}
            />
            <span>Strict Proxy (fail if proxy unavailable, no fallback to direct)</span>
          </label>

          {error && <div style={{ color: "#ef4444", fontSize: "13px" }}>{error}</div>}

          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="primaryButton" disabled={busy || !name.trim() || !proxyUrl.trim()}>
              {busy ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
