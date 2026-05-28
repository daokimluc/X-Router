/**
 * ApiInfoPanel — Phase 27 — show endpoint URLs + copy + speed test.
 *
 * Phase 32 — Polished design:
 *   - Header: Globe icon + title + speed test button
 *   - Client setup: 2 prominent cards (OpenAI vs Anthropic) with copy-button
 *     tucked inline for the base URL.
 *   - Raw endpoints: collapsed <details> by default, opens with a clean
 *     vertical list. Method/auth color-coded.
 */

import { useState } from "react";
import { Globe, Copy, Zap, Check } from "lucide-react";

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

type ClientSetup = {
  name: string;
  examples: string;
  /** Suffix appended to gateway origin to form the SDK base_url */
  baseUrlSuffix: string;
  /** Hex color for the accent border on this card */
  accent: string;
};

const CLIENT_SETUPS: ClientSetup[] = [
  {
    name: "OpenAI-compatible",
    examples: "openai SDK · LiteLLM · Cline · Continue · LangChain · Aider",
    baseUrlSuffix: "/v1",
    accent: "#10b981",
  },
  {
    name: "Anthropic SDK",
    examples: "@anthropic-ai/sdk · Claude Code · Cursor · Anthropic Python SDK",
    baseUrlSuffix: "",
    accent: "#f59e0b",
  },
];

function getBaseUrl(): string {
  const proto = window.location.protocol;
  const host = window.location.hostname;
  const currentPort = window.location.port;
  const devPorts = new Set(["5173", "5174", "5175", "3000"]);
  const port = !currentPort || devPorts.has(currentPort) ? "3100" : currentPort;
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
    <section className="apiInfoPanel">
      <header className="apiInfoHeader">
        <div className="apiInfoTitle">
          <Globe size={18} />
          <h2>API Endpoints</h2>
          <span className="apiInfoSubtitle">Drop-in setup for OpenAI & Anthropic SDKs</span>
        </div>
        <button
          type="button"
          className="apiInfoSpeedBtn"
          onClick={() => void speedTest()}
          disabled={pinging}
          title="Ping /healthz from this browser"
        >
          <Zap size={14} />
          <span>
            {pinging ? "Pinging…" : pingResult ? `${pingResult.ms}ms ${pingResult.ok ? "✓" : "✗"}` : "Speed test"}
          </span>
        </button>
      </header>

      {/* Client setup — 2 cards side-by-side */}
      <div className="apiInfoClientGrid">
        {CLIENT_SETUPS.map((c) => {
          const fullBase = `${baseUrl}${c.baseUrlSuffix}`;
          const key = `client-${c.name}`;
          return (
            <div className="apiInfoClientCard" key={c.name} style={{ borderTopColor: c.accent }}>
              <div className="apiInfoClientHeader">
                <span className="apiInfoClientName" style={{ color: c.accent }}>{c.name}</span>
                <span className="apiInfoClientExamples">{c.examples}</span>
              </div>
              <div className="apiInfoClientField">
                <span className="apiInfoClientFieldLabel">base_url</span>
                <code className="apiInfoClientFieldValue">{fullBase}</code>
                <button
                  type="button"
                  className="apiInfoCopyBtn"
                  title="Copy base URL"
                  onClick={() => void copyUrl(fullBase, key)}
                >
                  {copiedKey === key ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                </button>
              </div>
              <div className="apiInfoClientField">
                <span className="apiInfoClientFieldLabel">api_key</span>
                <span className="apiInfoClientFieldHint">your gateway API key (Endpoint & Keys → API Keys)</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Raw endpoints — collapsed by default */}
      <details className="apiInfoRawEndpoints">
        <summary>
          <span className="apiInfoRawTitle">Raw endpoints</span>
          <span className="apiInfoRawHint">{ENDPOINTS.length} paths · for curl / Postman</span>
        </summary>
        <div className="apiInfoRawList">
          {ENDPOINTS.map((ep) => {
            const fullUrl = `${baseUrl}${ep.path}`;
            const key = `${ep.method}-${ep.path}`;
            return (
              <div className="apiInfoRawRow" key={key}>
                <span className={`apiInfoMethod apiInfoMethod--${ep.method.toLowerCase()}`}>
                  {ep.method}
                </span>
                <code className="apiInfoPath">{ep.path}</code>
                <span className={`apiInfoAuth apiInfoAuth--${ep.auth}`}>{ep.auth}</span>
                <button
                  type="button"
                  className="apiInfoCopyBtn"
                  title="Copy full URL"
                  onClick={() => void copyUrl(fullUrl, key)}
                >
                  {copiedKey === key ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
