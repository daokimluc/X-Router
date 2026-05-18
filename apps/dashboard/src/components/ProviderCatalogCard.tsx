import type { CatalogProvider } from "../providerCatalog";
import { ProviderIcon } from "./ProviderIcon";

type Props = {
  provider: CatalogProvider;
  connectionCount: number;
  errorCount?: number;
  onClick?: () => void;
};

/**
 * Hex `#RRGGBB`/`#RGB` to `rgba(r, g, b, alpha)`.
 * Returns the original hex when parsing fails.
 */
function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(136, 136, 136, ${alpha})`;
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length === 8) h = h.slice(0, 6); // strip alpha if provided
  if (h.length !== 6) return `rgba(136, 136, 136, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return `rgba(136, 136, 136, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ProviderCatalogCard({ provider, connectionCount, errorCount = 0, onClick }: Props) {
  const tileBg = hexToRgba(provider.color, 0.15);

  let statusNode: React.ReactNode;
  if (provider.noAuth) {
    statusNode = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: 12, fontWeight: 500 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
        Ready
      </span>
    );
  } else if (errorCount > 0) {
    statusNode = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: 12, fontWeight: 500 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
        {errorCount} Error{errorCount === 1 ? "" : "s"}
      </span>
    );
  } else if (connectionCount > 0) {
    statusNode = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: 12, fontWeight: 500 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
        {connectionCount} Connected
      </span>
    );
  } else {
    statusNode = (
      <span style={{ color: "var(--color-text-muted, #9ca3af)", fontSize: 12 }}>
        No connections
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--color-border, #e5e7eb)",
        background: "var(--color-surface, #ffffff)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background-color 0.15s ease, border-color 0.15s ease, transform 0.05s ease",
        font: "inherit",
        color: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-surface-hover, #f9fafb)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--color-surface, #ffffff)";
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: tileBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <ProviderIcon
          providerId={provider.id}
          size={32}
          fallbackText={provider.textIcon}
          fallbackColor={provider.color}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {provider.name}
          </span>
          {provider.deprecated && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
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
        {statusNode}
      </div>
    </button>
  );
}
