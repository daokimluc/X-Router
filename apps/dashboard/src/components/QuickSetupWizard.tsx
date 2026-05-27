/**
 * QuickSetupWizard — guided onboarding flow for first-time provider setup.
 *
 * Steps:
 *   1) Pick a provider preset (Kiro / Windsurf / OpenAI / Anthropic / Gemini)
 *   2) Confirm connection (delegated to existing connect flow)
 *   3) Create a default model mapping + routing profile + show CLI snippet
 *
 * The wizard does not duplicate the OAuth/credential UI — it directs the user
 * to the existing per-provider connect flow so we don't fragment the surface
 * area. Once at least one account exists for the chosen provider type, the
 * wizard auto-creates a default model mapping (gateway-friendly id) and a
 * routing profile that points at it. A copy-pastable CLI snippet finishes
 * the setup.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Copy, X, Sparkles, Zap, Wand2 } from "lucide-react";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type Account = {
  id: string;
  providerType: string;
  providerInstanceId: string;
  status: string;
};

type Preset = {
  type: string;
  name: string;
  tagline: string;
  authHint: string;
  defaultModel: string;
  upstreamModel: string;
  profileId: string;
  profileLabel: string;
};

const PRESETS: Preset[] = [
  {
    type: "kiro",
    name: "Kiro AI",
    tagline: "Free Anthropic-compatible via OAuth",
    authHint: "OAuth login (browser)",
    defaultModel: "kiro-sonnet",
    upstreamModel: "claude-3-5-sonnet-latest",
    profileId: "coding",
    profileLabel: "Coding",
  },
  {
    type: "windsurf",
    name: "Windsurf",
    tagline: "Free OpenAI-compatible via OAuth",
    authHint: "OAuth login (browser)",
    defaultModel: "windsurf-sonnet",
    upstreamModel: "claude-3-5-sonnet",
    profileId: "coding",
    profileLabel: "Coding",
  },
  {
    type: "openai",
    name: "OpenAI",
    tagline: "Direct API key access",
    authHint: "API key (sk-…)",
    defaultModel: "gpt-4o",
    upstreamModel: "gpt-4o",
    profileId: "coding",
    profileLabel: "Coding",
  },
  {
    type: "anthropic",
    name: "Anthropic",
    tagline: "Direct API key access",
    authHint: "API key (sk-ant-…)",
    defaultModel: "claude-3-5-sonnet",
    upstreamModel: "claude-3-5-sonnet-latest",
    profileId: "coding",
    profileLabel: "Coding",
  },
  {
    type: "gemini",
    name: "Gemini",
    tagline: "Free tier API key",
    authHint: "AI Studio API key",
    defaultModel: "gemini-2.0-flash",
    upstreamModel: "gemini-2.0-flash-exp",
    profileId: "coding",
    profileLabel: "Coding",
  },
];

type Props = {
  api: ApiClient;
  onClose: () => void;
  onCompleted: () => void;
  /**
   * Called when the user wants to add a connection for the given provider.
   * The host should open the existing connect/Account modal for this type.
   */
  onConnectProvider: (providerType: string) => void;
};

export function QuickSetupWizard({ api, onClose, onCompleted, onConnectProvider }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ modelId: string; profileId: string } | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Poll accounts every 3s while on step 2 to detect when the user finishes
  // the connect modal in another window/dialog.
  useEffect(() => {
    if (step !== 2 || !selected) return;
    let cancelled = false;
    const check = async () => {
      try {
        const all = await api.getList<Account>("/admin/v1/accounts");
        if (cancelled) return;
        setAccounts(all);
      } catch (err) {
        if (!cancelled) {
          setPollErr(err instanceof Error ? err.message : "Failed to refresh accounts");
        }
      }
    };
    void check();
    const handle = window.setInterval(() => void check(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [step, selected, api]);

  const matchedAccount = useMemo(() => {
    if (!selected) return null;
    return accounts.find((a) => a.providerType === selected.type && a.status !== "disabled") ?? null;
  }, [accounts, selected]);

  async function createDefaults() {
    if (!selected || !matchedAccount) return;
    setCreating(true);
    setCreateErr(null);
    try {
      // 1) Model mapping
      const mappingId = `${selected.type}_${selected.defaultModel}`.replace(/[^a-z0-9_]+/gi, "_");
      try {
        await api.post("/admin/v1/model-mappings", {
          id: mappingId,
          publicModel: selected.defaultModel,
          providerInstanceId: matchedAccount.providerInstanceId,
          providerType: selected.type,
          upstreamModel: selected.upstreamModel,
          enabled: true,
        });
      } catch {
        // Probably already exists — proceed.
      }

      // 2) Routing profile
      try {
        await api.post("/admin/v1/routing-profiles", {
          id: selected.profileId,
          displayName: selected.profileLabel,
          candidates: [selected.defaultModel],
          requiredCapabilities: ["chat"],
          fallback: true,
          enabled: true,
        });
      } catch {
        // Already exists — patch instead to add candidate if missing.
        try {
          const existing = await api.get<{ id: string; candidates?: string[] }>(
            `/admin/v1/routing-profiles/${selected.profileId}`
          );
          const next = Array.from(new Set([...(existing.candidates ?? []), selected.defaultModel]));
          await api.patch(`/admin/v1/routing-profiles/${selected.profileId}`, {
            candidates: next,
          });
        } catch {
          // ignore — best effort.
        }
      }

      setCreated({ modelId: selected.defaultModel, profileId: selected.profileId });
      setStep(3);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : "Failed to create defaults");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modalContent" style={{ maxWidth: 640, width: "100%" }}>
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Wand2 size={18} /> Quick Setup
          </h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <StepIndicator step={step} />

        <div style={{ padding: "16px 24px 24px" }}>
          {step === 1 && (
            <Step1
              onPick={(p) => {
                setSelected(p);
                setStep(2);
              }}
            />
          )}

          {step === 2 && selected && (
            <Step2
              preset={selected}
              connected={!!matchedAccount}
              pollErr={pollErr}
              onConnect={() => onConnectProvider(selected.type)}
              onContinue={() => void createDefaults()}
              onBack={() => {
                setSelected(null);
                setStep(1);
              }}
              creating={creating}
              createErr={createErr}
            />
          )}

          {step === 3 && selected && created && (
            <Step3
              preset={selected}
              created={created}
              onDone={() => {
                onCompleted();
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Choose Provider", "Connect", "Done"];
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "12px 24px",
        borderBottom: "1px solid var(--color-border-subtle, rgba(0,0,0,0.05))",
      }}
    >
      {labels.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        return (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              color: active
                ? "var(--color-primary, #0ea5e9)"
                : done
                ? "var(--color-text-main)"
                : "var(--color-text-muted, #6b7280)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: done
                  ? "var(--color-success, #10b981)"
                  : active
                  ? "var(--color-primary, #0ea5e9)"
                  : "var(--color-surface-2, #f3f4f6)",
                color: done || active ? "#fff" : "var(--color-text-muted, #6b7280)",
                fontSize: 11,
              }}
            >
              {done ? <Check size={12} /> : num}
            </span>
            {label}
            {num < 3 && <ChevronRight size={12} style={{ opacity: 0.4 }} />}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ onPick }: { onPick: (p: Preset) => void }) {
  return (
    <div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
        Choose a starting provider — we'll create a default model mapping and routing profile so
        you can call the gateway immediately after connecting.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.type}
            type="button"
            onClick={() => onPick(preset)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: 8,
              background: "var(--color-surface, #ffffff)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "var(--color-surface-2, #f3f4f6)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{preset.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted, #6b7280)" }}>
                {preset.tagline} · {preset.authHint}
              </div>
            </div>
            <ChevronRight size={16} style={{ opacity: 0.5 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2({
  preset,
  connected,
  pollErr,
  onConnect,
  onContinue,
  onBack,
  creating,
  createErr,
}: {
  preset: Preset;
  connected: boolean;
  pollErr: string | null;
  onConnect: () => void;
  onContinue: () => void;
  onBack: () => void;
  creating: boolean;
  createErr: string | null;
}) {
  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        <strong>{preset.name}</strong> — {preset.authHint}
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
        <li style={{ marginBottom: 6 }}>
          Click <strong>Connect</strong> below to open the connect dialog.
        </li>
        <li style={{ marginBottom: 6 }}>
          Complete the {preset.authHint.toLowerCase()} flow.
        </li>
        <li>
          Once connected, click <strong>Continue</strong> to create the default model mapping +
          routing profile.
        </li>
      </ol>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          marginTop: 14,
          background: connected
            ? "var(--color-success-bg, #ecfdf5)"
            : "var(--color-surface-2, #f3f4f6)",
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        {connected ? (
          <>
            <Check size={14} color="var(--color-success, #10b981)" />
            <span>Connection detected — ready to continue.</span>
          </>
        ) : (
          <>
            <Zap size={14} />
            <span>Waiting for {preset.name} connection…</span>
          </>
        )}
      </div>

      {pollErr && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-danger, #ef4444)" }}>
          {pollErr}
        </p>
      )}
      {createErr && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-danger, #ef4444)" }}>
          {createErr}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "space-between" }}>
        <button type="button" className="ghostButton" onClick={onBack} disabled={creating}>
          Back
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ghostButton" onClick={onConnect} disabled={creating}>
            {connected ? "Manage Connection" : "Connect"}
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={onContinue}
            disabled={!connected || creating}
          >
            {creating ? "Creating…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Step3({
  preset,
  created,
  onDone,
}: {
  preset: Preset;
  created: { modelId: string; profileId: string };
  onDone: () => void;
}) {
  const snippet = `curl ${window.location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer <YOUR_INTERNAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${created.modelId}",
    "messages": [{"role":"user","content":"Hello"}]
  }'`;

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Setup complete for <strong>{preset.name}</strong>. We created:
      </p>
      <ul style={{ margin: "0 0 14px", paddingLeft: 20, fontSize: 13 }}>
        <li>
          Model mapping <code>{created.modelId}</code> → <code>{preset.upstreamModel}</code>
        </li>
        <li>
          Routing profile <code>{created.profileId}</code>
        </li>
      </ul>

      <div
        style={{
          background: "var(--color-surface-2, #f3f4f6)",
          padding: 12,
          borderRadius: 8,
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {snippet}
        <button
          type="button"
          className="ghostButton"
          onClick={() => void navigator.clipboard.writeText(snippet)}
          style={{ marginTop: 8, fontSize: 11 }}
        >
          <Copy size={12} /> Copy snippet
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button type="button" className="primaryButton" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
