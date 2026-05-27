/**
 * ModelMultiSelect — autocomplete multi-select for public model names.
 * Pulls suggestions from /admin/v1/model-mappings (loaded once).
 */

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

type ApiClient = {
  getList: <T>(path: string) => Promise<T[]>;
};

type ModelMapping = { publicModel: string };

type Props = {
  api: ApiClient;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function ModelMultiSelect({ api, value, onChange, placeholder = "Add model..." }: Props) {
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    void api
      .getList<ModelMapping>("/admin/v1/model-mappings")
      .then((list) => setModels(Array.from(new Set(list.map((m) => m.publicModel))).sort()))
      .catch(() => setModels([]));
  }, [api]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return models.filter((m) => m.toLowerCase().includes(q) && !value.includes(m)).slice(0, 8);
  }, [draft, models, value]);

  function add(model: string) {
    const trimmed = model.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const target = suggestions[0] ?? draft;
      if (target.trim()) add(target);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
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
        {value.map((m, i) => (
          <span
            key={`${m}-${i}`}
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
            {m}
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
              aria-label={`Remove ${m}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={value.length === 0 ? placeholder : ""}
          style={{
            flex: 1,
            minWidth: 120,
            border: "none",
            background: "transparent",
            outline: "none",
            fontSize: 13,
            color: "inherit",
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            zIndex: 100,
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "monospace",
                color: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <small style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
        Empty list = all models allowed.
      </small>
    </div>
  );
}
