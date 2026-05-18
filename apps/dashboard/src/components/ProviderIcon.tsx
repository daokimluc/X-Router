import { useState } from "react";

type Props = {
  providerId: string;
  size?: number;
  fallbackText?: string;
  fallbackColor?: string;
};

/**
 * Renders the provider's PNG icon from /providers/{id}.png with a
 * coloured-tile fallback (initials or custom textIcon) when the image
 * fails to load.
 */
export function ProviderIcon({ providerId, size = 30, fallbackText, fallbackColor }: Props) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: fallbackColor || "#888",
          color: "#fff",
          fontSize: size * 0.4,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {fallbackText || providerId.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={`/providers/${providerId}.png`}
      alt={providerId}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      style={{
        objectFit: "contain",
        borderRadius: 8,
        maxWidth: size,
        maxHeight: size,
        flexShrink: 0,
      }}
    />
  );
}
