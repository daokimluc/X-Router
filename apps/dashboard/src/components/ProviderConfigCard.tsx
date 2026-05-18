/**
 * ProviderConfigCard — shows the gateway endpoint URL for a given service
 * kind (e.g. /v1/embeddings, /v1/audio/speech). Used inside the provider
 * detail page as the "{KindLabel} Config" card.
 *
 * When the catalog provider declares a built-in upstream config for the
 * given kind (e.g. embeddingConfig), the upstream URL is also displayed
 * so users can see where requests will be forwarded.
 */

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";

type Props = {
  provider: CatalogProvider;
  kind: ServiceKind;
  kindLabel: string;
};

const ENDPOINT_MAP: Record<ServiceKind, string> = {
  llm: "/v1/chat/completions",
  embedding: "/v1/embeddings",
  image: "/v1/images/generations",
  imageToText: "/v1/images/understanding",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
};

/**
 * Returns the catalog-defined upstream URL for a given kind, if any.
 */
function getUpstreamBaseUrl(provider: CatalogProvider, kind: ServiceKind): string | null {
  if (kind === "embedding") return provider.embeddingConfig?.baseUrl ?? null;
  if (kind === "image") return provider.imageConfig?.baseUrl ?? null;
  if (kind === "tts") return provider.ttsConfig?.baseUrl ?? null;
  if (kind === "stt") return provider.sttConfig?.baseUrl ?? null;
  if (kind === "webSearch") return provider.searchConfig?.baseUrl ?? null;
  if (kind === "webFetch") return provider.fetchConfig?.baseUrl ?? null;
  return null;
}

export function ProviderConfigCard({ provider, kind, kindLabel }: Props) {
  const path = ENDPOINT_MAP[kind] ?? "/v1";
  const gatewayEndpoint = `${window.location.origin}${path}`;
  const upstreamEndpoint = getUpstreamBaseUrl(provider, kind);

  return (
    <article className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {kindLabel} Config
        </h3>
        {provider.apiKeyUrl && (
          <a
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--color-primary)",
              textDecoration: "none",
            }}
          >
            <ExternalLink size={12} />
            Get API Key
          </a>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <EndpointRow label="Endpoint" value={gatewayEndpoint} />
        {upstreamEndpoint && (
          <EndpointRow label="Upstream" value={upstreamEndpoint} />
        )}
      </div>
    </article>
  );
}

function EndpointRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--color-text-muted, #6b7280)",
          minWidth: 72,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <code
        style={{
          flex: 1,
          minWidth: 200,
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          padding: "6px 10px",
          borderRadius: 6,
          background: "var(--color-surface-2, #f3f4f6)",
          color: "var(--color-text-main)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="iconButton"
        title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
        style={{ padding: "6px 8px" }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
