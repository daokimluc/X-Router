/**
 * ApiKeyExportModal — preview + copy/download CSV from
 * GET /admin/v1/api-keys/export?format=csv
 */

import { useEffect, useState } from "react";
import { X, Clipboard, CheckCircle2, Download } from "lucide-react";

type Props = {
  fetchCsv: () => Promise<string>;
  onClose: () => void;
};

export function ApiKeyExportModal({ fetchCsv, onClose }: Props) {
  const [csv, setCsv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setCsv(await fetchCsv());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Export failed");
      }
    })();
  }, [fetchCsv]);

  async function copy() {
    if (!csv) return;
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function download() {
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `api-keys-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modalContent"
        style={{ maxWidth: 720, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2>Export API keys</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, padding: "16px 20px", overflow: "auto" }}>
          {error && <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>}
          {!csv && !error && (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</div>
          )}
          {csv && (
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                fontFamily: "monospace",
                background: "var(--color-surface-2)",
                padding: 12,
                borderRadius: 6,
                whiteSpace: "pre",
                overflow: "auto",
                maxHeight: "50vh",
              }}
            >
              {csv}
            </pre>
          )}
          {csv && (
            <small style={{ color: "var(--color-text-muted)", fontSize: 11, marginTop: 8, display: "block" }}>
              CSV does not contain raw key values. Use the per-row reveal/copy button to obtain a key.
            </small>
          )}
        </div>

        <div className="routeModalFooter">
          <button type="button" className="ghostButton" onClick={onClose}>
            Close
          </button>
          <button type="button" className="ghostButton" onClick={() => void copy()} disabled={!csv}>
            {copied ? <CheckCircle2 size={14} /> : <Clipboard size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="primaryButton" onClick={download} disabled={!csv}>
            <Download size={14} /> Download .csv
          </button>
        </div>
      </div>
    </div>
  );
}
