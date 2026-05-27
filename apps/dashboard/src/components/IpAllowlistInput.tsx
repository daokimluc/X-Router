/**
 * IpAllowlistInput — chips input for IP / CIDR allowlist.
 * Validates entries client-side; server re-validates.
 */

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

// Quick client-side validate: single IPv4/IPv6 or CIDR.
// Server is authoritative — this just blocks obviously bad input.
function isValidEntry(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  // IPv4 single
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    return trimmed.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  // IPv4 CIDR
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(trimmed)) {
    const [ip, mask] = trimmed.split("/");
    return ip.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255) && Number(mask) >= 0 && Number(mask) <= 32;
  }
  // IPv6 (loose) — allow ::, ::1, etc.
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(":")) return true;
  if (/^[0-9a-fA-F:]+\/\d{1,3}$/.test(trimmed) && trimmed.includes(":")) {
    const [, mask] = trimmed.split("/");
    return Number(mask) >= 0 && Number(mask) <= 128;
  }
  return false;
}

export function IpAllowlistInput({ value, onChange, placeholder = "Add IP or CIDR..." }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!isValidEntry(trimmed)) {
      setError(`Invalid: ${trimmed}`);
      return;
    }
    if (value.includes(trimmed)) {
      setError(`Already added: ${trimmed}`);
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
    setError(null);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: 6,
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          minHeight: 36,
          alignItems: "center",
        }}
      >
        {value.map((entry, i) => (
          <span
            key={`${entry}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              fontSize: 12,
              fontFamily: "monospace",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
            }}
          >
            {entry}
            <button
              type="button"
              onClick={() => remove(i)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                color: "inherit",
                display: "inline-flex",
              }}
              aria-label={`Remove ${entry}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : ""}
          style={{
            flex: 1,
            minWidth: 100,
            border: "none",
            background: "transparent",
            outline: "none",
            fontSize: 13,
            color: "inherit",
          }}
        />
      </div>
      {error && <small style={{ color: "#ef4444", fontSize: 11 }}>{error}</small>}
      <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
        Press Enter or comma to add. Supports single IP and CIDR (IPv4/IPv6).
      </small>
    </div>
  );
}
