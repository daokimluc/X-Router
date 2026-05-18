/**
 * ProviderDetailView — full-page provider detail view rendered inside the
 * media catalog grid in place of the grid itself when a provider card is
 * clicked. Shows breadcrumb + back, provider header with kind badges, and
 * the connections / models / config cards.
 */

import { ArrowLeft, ExternalLink } from "lucide-react";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderConnectionsCard } from "./ProviderConnectionsCard";
import { ProviderModelsCard } from "./ProviderModelsCard";
import { ProviderConfigCard } from "./ProviderConfigCard";
import { ProviderExampleCard } from "./ProviderExampleCard";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type Props = {
  api: ApiClient;
  provider: CatalogProvider;
  kind: ServiceKind;
  kindLabel: string;
  onBack: () => void;
};

const KIND_LABELS: Record<ServiceKind, string> = {
  llm: "LLM",
  embedding: "Embedding",
  image: "Image",
  imageToText: "Image to Text",
  tts: "TTS",
  stt: "STT",
  webSearch: "Web Search",
  webFetch: "Web Fetch",
};

function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(136, 136, 136, ${alpha})`;
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return `rgba(136, 136, 136, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return `rgba(136, 136, 136, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ProviderDetailView({ api, provider, kind, kindLabel, onBack }: Props) {
  const tileBg = hexToRgba(provider.color, 0.18);
  const allKinds = provider.serviceKinds ?? ["llm"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Breadcrumb + back */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          className="actionButton"
          onClick={onBack}
          style={{ alignSelf: "flex-start", fontSize: 12 }}
        >
          <ArrowLeft size={14} />
          {kindLabel}
        </button>
        <nav
          aria-label="Breadcrumb"
          style={{
            fontSize: 12,
            color: "var(--color-text-muted, #6b7280)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span>Media Providers</span>
          <span aria-hidden="true">›</span>
          <span>{kindLabel}</span>
          <span aria-hidden="true">›</span>
          <span style={{ color: "var(--color-text-main)", fontWeight: 500 }}>
            {provider.name}
          </span>
        </nav>
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: tileBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ProviderIcon
            providerId={provider.id}
            size={40}
            fallbackText={provider.textIcon}
            fallbackColor={provider.color}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {provider.name}
            </h1>
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
                  color: "var(--color-primary, #0ea5e9)",
                  textDecoration: "none",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid color-mix(in srgb, var(--color-primary, #0ea5e9) 30%, transparent)",
                }}
              >
                <ExternalLink size={12} />
                Get API Key
              </a>
            )}
            {provider.deprecated && (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(239,68,68,0.15)",
                  color: "#ef4444",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                Deprecated
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {allKinds.map((k) => (
              <KindBadge key={k} kind={k} highlighted={k === kind} />
            ))}
          </div>
        </div>
      </div>

      {/* Connections */}
      <ProviderConnectionsCard api={api} provider={provider} kind={kind} />

      {/* Models — hide for noAuth TTS/local providers where models are
          just language codes shown in the Example card dropdown */}
      {!(provider.noAuth && kind === "tts") && (
        <ProviderModelsCard
          api={api}
          provider={provider}
          kind={kind}
          kindLabel={kindLabel}
        />
      )}

      {/* Config */}
      <ProviderConfigCard provider={provider} kind={kind} kindLabel={kindLabel} />

      {/* Example playground */}
      <ProviderExampleCard
        api={api}
        provider={provider}
        kind={kind}
        kindLabel={kindLabel}
      />
    </div>
  );
}

function KindBadge({ kind, highlighted }: { kind: ServiceKind; highlighted: boolean }) {
  const label = KIND_LABELS[kind] ?? kind;
  return (
    <span
      style={{
        fontSize: 10,
        padding: "3px 8px",
        borderRadius: 4,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        background: highlighted
          ? "color-mix(in srgb, var(--color-primary, #0ea5e9) 18%, transparent)"
          : "var(--color-surface-2, #f3f4f6)",
        color: highlighted
          ? "var(--color-primary, #0ea5e9)"
          : "var(--color-text-muted, #6b7280)",
        border: highlighted
          ? "1px solid color-mix(in srgb, var(--color-primary, #0ea5e9) 35%, transparent)"
          : "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))",
      }}
    >
      {label}
    </span>
  );
}
