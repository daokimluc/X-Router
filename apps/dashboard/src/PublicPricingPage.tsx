/**
 * Public read-only pricing page (Phase 21).
 * Accessible without admin auth — for end users to see model rates.
 * Loaded at /pricing path.
 */

import { useEffect, useMemo, useState } from "react";

type ModelPricing = {
  model: string;
  inputRate: number;
  outputRate: number;
  cachedInputRate?: number;
  label?: string;
  updatedAt: string;
};

function fmt(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function PublicPricingPage() {
  const [entries, setEntries] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/v1/pricing");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: ModelPricing[] };
        setEntries(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load pricing");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter(
          (e) => e.model.toLowerCase().includes(q) || (e.label ?? "").toLowerCase().includes(q)
        )
      : entries;
    return [...list].sort((a, b) => a.model.localeCompare(b.model));
  }, [entries, search]);

  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "var(--color-text, #1a1a1a)",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Model Pricing</h1>
        <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 14 }}>
          Per-model token rates (USD per 1M tokens). Pricing is informational only — actual
          billing is determined per request.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 8,
          marginBottom: 16,
          border: "1px solid #d1d5db",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            fontSize: 14,
            background: "transparent",
            color: "inherit",
          }}
        />
      </div>

      {loading && <div style={{ color: "#6b7280" }}>Loading...</div>}
      {error && <div style={{ color: "#ef4444" }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ color: "#6b7280", padding: 32, textAlign: "center" }}>
          No pricing configured.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #d1d5db", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={{ textAlign: "left", padding: "12px 16px" }}>Model</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Input / 1M</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Output / 1M</th>
                <th style={{ textAlign: "right", padding: "12px 16px" }}>Cached / 1M</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.model} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 16px" }}>
                    <code style={{ fontSize: 12 }}>{entry.model}</code>
                    {entry.label && (
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{entry.label}</div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "10px 16px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(entry.inputRate)}
                  </td>
                  <td
                    style={{
                      padding: "10px 16px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(entry.outputRate)}
                  </td>
                  <td
                    style={{
                      padding: "10px 16px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: entry.cachedInputRate === undefined ? "#9ca3af" : undefined,
                    }}
                  >
                    {entry.cachedInputRate !== undefined ? fmt(entry.cachedInputRate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer style={{ marginTop: 32, color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
        {filtered.length > 0 && (
          <span>
            {filtered.length} model{filtered.length === 1 ? "" : "s"}
          </span>
        )}
      </footer>
    </div>
  );
}
