/**
 * ApiInfoPanel — Phase 27 — show endpoint URLs + copy + speed test.
 */

import { useState } from "react";
import { Network, Copy, Zap } from "lucide-react";

type EndpointSpec = { label: string; method: string; path: string; auth: "admin" | "api-key" | "public" };

const ENDPOINTS: EndpointSpec[] = [
  { label: "OpenAI Chat", method: "POST", path: "/v1/chat/completions", auth: "api-key" },
  { label: "Anthropic Messages", method: "POST", path: "/v1/messages", auth: "api-key" },
  { label: "Embeddings", method: "POST", path: "/v1/embeddings", auth: "api-key" },
  { label: "Audio TTS", method: "POST", path: "/v1/audio/speech", auth: "api-key" },
  { label: "Audio STT", method: "POST", path: "/v1/audio/transcriptions", auth: "api-key" },
  { label: "Images", method: "POST", path: "/v1/images/generations", auth: "api-key" },
  { label: "Models list", method: "GET", path: "/v1/models", auth: "api-key" },
  { label: "Public pricing", method: "GET", path: "/v1/pricing", auth: "public" },
  { label: "Public models", method: "GET", path: "/v1/public/models", auth: "public" },
  { label: "Health", method: "GET", path: "/healthz", auth: "public" },
];

function getBaseUrl(): string {
  const proto = window.location.protocol;
  const host = window.location.hostname;
  const port = window.location.port || "3100";
  return `${proto}//${host}:${port}`;
}

export function ApiInfoPanel() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<{ ms: number; ok: boolean } | null>(null);
  const [pinging, setPinging] = useState(false);
  const baseUrl = getBaseUrl();

  async function copyUrl(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // ignore
    }
  }

  async function speedTest() {
    if (pinging) return;
    setPinging(true);
    setPingResult(null);
    const start = performance.now();
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      const ms = Math.round(performance.now() - start);
      setPingResult({ ms, ok: res.ok });
    } catch {
      const ms = Math.round(performance.now() - start);
      setPingResult({ ms, ok: false });
    } finally {
      setPinging(false);
    }
  }

  return (
    <article className="ovCard">
      <header className="ovCardHeader">
        <Network size={16} />
        <h3>API Endpoints</h3>
        <button
          type="button"
          onClick={() => void speedTest()}
          disabled={pinging}
          style={{
            marginLeft: "auto",
            padding: "4px 10px",
            fontSize: 11,
            background: "var(--color-surface-2, #1f2937)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Ping /healthz from this browser"
        >
          <Zap size={12} />
          {pinging ? "Pinging..." : pingResult ? `${pingResult.ms}ms ${pingResult.ok ? "✓" : "✗"}` : "Speed test"}
        </button>
      </header>
      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {ENDPOINTS.map((ep) => {
          const fullUrl = `${baseUrl}${ep.path}`;
          const key = `${ep.method}-${ep.path}`;
          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                fontSize: 12,
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  minWidth: 44,
                  padding: "2px 6px",
                  fontSize: 10,
                  fontFamily: "monospace",
                  background: ep.method === "GET" ? "rgba(16,185,129,0.15)" : "rgba(59,130,246,0.15)",
                  color: ep.method === "GET" ? "#10b981" : "#3b82f6",
                  borderRadius: 4,
                  textAlign: "center",
                }}
              >
                {ep.method}
              </span>
              <code style={{ flex: 1, fontSize: 11, color: "var(--color-text-muted)" }}>{ep.path}</code>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background:
                    ep.auth === "public"
                      ? "rgba(16,185,129,0.15)"
                      : ep.auth === "admin"
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(59,130,246,0.15)",
                  color:
                    ep.auth === "public"
                      ? "#10b981"
                      : ep.auth === "admin"
                      ? "#ef4444"
                      : "#3b82f6",
                }}
              >
                {ep.auth}
              </span>
              <button
                type="button"
                className="iconButton compact"
                title="Copy full URL"
                onClick={() => void copyUrl(fullUrl, key)}
              >
                <Copy size={12} />
                {copiedKey === key && <span style={{ marginLeft: 4, fontSize: 10, color: "#10b981" }}>✓</span>}
              </button>
            </div>
          );
        })}
      </div>
    </article>
  );
}
