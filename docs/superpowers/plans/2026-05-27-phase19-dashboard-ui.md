# Phase 19 — Dashboard UI for new-api features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire dashboard UI to backend features added in commit `be4b82e` — model pricing CRUD, balance/topup, batch test, sync models, plus root.test.ts fix and Usage cost cleanup. Land everything as a single Phase 19 commit per user preference.

**Architecture:** Add 4 new components under `apps/dashboard/src/components/`. Keep `App.tsx` as the wire-up point — extend existing `ApiKeysSection`, `ModelRegistry`, `ProviderDetail` with imports + small additions rather than restructuring the 8486-line file. Backend endpoints already exist; this is pure frontend wire-up plus one test fix and one Usage refactor.

**Tech Stack:** React 18 + TypeScript, lucide-react icons, existing `createApiClient` (post/put/patch/delete/get), existing `ConfirmDialog`, existing `useLang()` i18n.

**Commit strategy:** No intermediate commits. Each task verifies with `tsc --noEmit` and the dashboard build. The final task does manual smoke tests, then a single commit covers all 7 tasks. This matches the user's stated preference ("gộp tất cả").

---

## File Structure

**New files:**
- `apps/dashboard/src/components/ModelPricingSection.tsx` — pricing CRUD section, ~250 lines
- `apps/dashboard/src/components/ModelPricingFormModal.tsx` — add/edit pricing modal, ~120 lines
- `apps/dashboard/src/components/TopupModal.tsx` — topup modal for one API key, ~110 lines
- `apps/dashboard/src/components/TestAllResultsModal.tsx` — batch test results modal, ~150 lines
- `apps/dashboard/src/components/SyncModelsModal.tsx` — sync preview + confirm modal, ~180 lines

**Modified files:**
- `apps/dashboard/src/App.tsx` — `ApiKey` type, `ApiKeysSection`, `ModelRegistry`, `ProviderDetail`
- `apps/dashboard/src/ProvidersPage.tsx` — Test All wire-up
- `apps/dashboard/src/UsagePage.tsx` — `UsageRecord` type, `estimateCost()`
- `apps/dashboard/src/i18n.ts` — EN/VI keys for new UI
- `apps/gateway/src/test/root.test.ts` — flip expected status from 404 to 200

---

## Task 1: Fix `root.test.ts` to expect 200

**Files:**
- Modify: `apps/gateway/src/test/root.test.ts` (entire file)

`apps/gateway/dashboard-dist/index.html` exists (verified during planning), so the static plugin serves it and the route returns 200 instead of 404.

- [ ] **Step 1: Replace the test contents**

Open `apps/gateway/src/test/root.test.ts` and replace its entire contents with:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "./helpers.js";

describe("GET /", () => {
  it("serves the dashboard index.html", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/"
    });

    // dashboard-dist/index.html is committed, so the static plugin
    // serves it on root requests.
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);

    await app.close();
  });
});
```

- [ ] **Step 2: Run only this test to verify it passes**

Run: `pnpm -C apps/gateway exec vitest run src/test/root.test.ts`
Expected: 1 test passes.

- [ ] **Step 3: Run full gateway test suite**

Run: `pnpm -C apps/gateway test`
Expected: All tests pass (266 + this one if it was previously failing as "stale", or same count if it was passing on the old assertion).

---

## Task 2: Add `balance` to `ApiKey` type and display badge

**Files:**
- Modify: `apps/dashboard/src/App.tsx` — `ApiKey` type (~line 243) and `ApiKeysSection` row rendering
- Modify: `apps/dashboard/src/i18n.ts` — add balance display strings

This task only adds display; the topup button comes in Task 3.

- [ ] **Step 1: Add `balance` field to `ApiKey` type in App.tsx**

Find the `ApiKey` type at line ~243 and add `balance` after `owner`:

```ts
type ApiKey = {
  id: string;
  keyHash: string;
  enabled: boolean;
  owner?: string;
  balance?: number; // undefined = unlimited (no balance tracking)
  createdAt?: string;
  limits?: {
    minuteRequests: number;
    requestsPerMinuteLimit: number;
    dailyRequests: number;
    dailyRequestQuota: number;
    dailyTokens?: number;
    dailyTokenQuota?: number;
    minuteWindowStart: string;
    dailyWindowStart: string;
  };
};
```

- [ ] **Step 2: Add a helper for formatting balance display**

Just before `function ApiKeysSection(props: {` (around line 4784), add:

```ts
function formatBalance(balance: number | undefined): { text: string; tone: "ok" | "low" | "unlimited" } {
  if (balance === undefined) return { text: "∞", tone: "unlimited" };
  if (balance === 0) return { text: "$0.00", tone: "low" };
  if (balance < 1) return { text: `$${balance.toFixed(4)}`, tone: balance < 0.1 ? "low" : "ok" };
  return { text: `$${balance.toFixed(2)}`, tone: "ok" };
}
```

- [ ] **Step 3: Render badge inside each API key row**

Find the `ApiKeysSection` rendering of each key row (search for `key.owner` or `key.keyHash` inside the loop after line ~5000). The exact location depends on the row JSX — add the badge near the existing owner/team display. Use this snippet:

```tsx
{(() => {
  const b = formatBalance(key.balance);
  return (
    <span
      className="balanceBadge"
      data-tone={b.tone}
      title={b.tone === "unlimited" ? t("apikey.unlimited") : t("apikey.balance")}
    >
      {b.text}
    </span>
  );
})()}
```

If you cannot find the row JSX in one read pass, run `grep -n "key.owner\|owner ?? " apps/dashboard/src/App.tsx | head` to locate the row rendering and add the badge near where owner/team are shown. The badge does not need to be in a fixed column position — adjacent to owner is fine.

- [ ] **Step 4: Add minimal CSS for the badge**

Append to `apps/dashboard/src/styles.css`:

```css
.balanceBadge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-2, #1f2937);
  color: var(--color-text, #e5e7eb);
  border: 1px solid var(--color-border, #374151);
}
.balanceBadge[data-tone="low"] {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.4);
}
.balanceBadge[data-tone="unlimited"] {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.4);
}
```

- [ ] **Step 5: Add i18n strings**

In `apps/dashboard/src/i18n.ts`, find the `en:` block and add to it (anywhere among other keys):

```ts
"apikey.balance": "Balance",
"apikey.unlimited": "Unlimited (no balance tracking)",
"apikey.topup": "Top up",
"apikey.topupTitle": "Top up API key",
"apikey.topupCurrent": "Current balance",
"apikey.topupAmount": "Amount to add (USD)",
"apikey.topupAdd": "Top up",
"apikey.topupQuick": "Quick:",
"apikey.topupSwitchWarning": "This key is currently unlimited. Topping up will switch it to balance-tracked mode.",
"apikey.topupSuccess": "Added ${amount}. New balance: ${balance}",
```

In the `vi:` block add the same keys with VI translations:

```ts
"apikey.balance": "Số dư",
"apikey.unlimited": "Không giới hạn (không theo dõi số dư)",
"apikey.topup": "Nạp thêm",
"apikey.topupTitle": "Nạp thêm cho API key",
"apikey.topupCurrent": "Số dư hiện tại",
"apikey.topupAmount": "Số tiền nạp (USD)",
"apikey.topupAdd": "Nạp",
"apikey.topupQuick": "Nhanh:",
"apikey.topupSwitchWarning": "Key này đang không giới hạn. Nạp sẽ chuyển sang chế độ theo dõi số dư.",
"apikey.topupSuccess": "Đã nạp ${amount}. Số dư mới: ${balance}",
```

- [ ] **Step 6: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 3: Create `TopupModal` component and wire to ApiKeysSection

**Files:**
- Create: `apps/dashboard/src/components/TopupModal.tsx`
- Modify: `apps/dashboard/src/App.tsx` — add topup button to each key row, render modal

- [ ] **Step 1: Create `TopupModal.tsx`**

Create `apps/dashboard/src/components/TopupModal.tsx` with:

```tsx
/**
 * TopupModal — add credit to an API key's balance.
 * POST /admin/v1/api-keys/:id/topup body { amount }
 */

import { useState } from "react";
import { X, DollarSign } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type Props = {
  apiKeyId: string;
  ownerLabel: string;
  currentBalance: number | undefined;
  api: ApiClient;
  onClose: () => void;
  onSuccess: (newBalance: number, added: number) => void;
};

const QUICK_AMOUNTS = [5, 10, 50, 100];

export function TopupModal({ apiKeyId, ownerLabel, currentBalance, api, onClose, onSuccess }: Props) {
  const { t } = useLang();
  const [amount, setAmount] = useState<string>("10.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUnlimited = currentBalance === undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ id: string; balance: number; added: number }>(
        `/admin/v1/api-keys/${apiKeyId}/topup`,
        { amount: parsed }
      );
      onSuccess(result.balance, result.added);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modalContent" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DollarSign size={18} />
            {t("apikey.topupTitle")}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            <div><strong>{ownerLabel}</strong></div>
            <div>
              {t("apikey.topupCurrent")}:{" "}
              {isUnlimited ? "∞" : `$${(currentBalance ?? 0).toFixed(2)}`}
            </div>
          </div>

          {isUnlimited && (
            <div style={{ fontSize: 12, padding: "8px 10px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 6, color: "#d97706" }}>
              ⚠ {t("apikey.topupSwitchWarning")}
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("apikey.topupAmount")}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <small style={{ color: "var(--color-text-muted)" }}>{t("apikey.topupQuick")}</small>
            <div style={{ display: "flex", gap: 6 }}>
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="ghostButton"
                  onClick={() => setAmount(q.toFixed(2))}
                >
                  +${q}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>
          )}

          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? "..." : t("apikey.topupAdd")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the modal into `ApiKeysSection`**

In `apps/dashboard/src/App.tsx`, near the top of `ApiKeysSection` (around line 4809 with other useState calls), add:

```ts
const [topupTarget, setTopupTarget] = useState<ApiKey | null>(null);
const [topupToast, setTopupToast] = useState<string | null>(null);
```

Add the import at the top of `App.tsx` (add to the existing component imports block, near `import { ConfirmDialog } from "./components/ConfirmDialog";`):

```ts
import { TopupModal } from "./components/TopupModal";
```

Inside the row rendering (next to the balance badge from Task 2), add a topup button:

```tsx
<button
  className="iconButton compact"
  type="button"
  title={t("apikey.topup")}
  onClick={() => setTopupTarget(key)}
>
  <Plus size={14} />
</button>
```

At the end of the `ApiKeysSection` JSX, just before the closing `</section>` (find via search for `</section>` near the function's last return), insert:

```tsx
{topupTarget && (
  <TopupModal
    apiKeyId={topupTarget.id}
    ownerLabel={topupTarget.owner ?? topupTarget.id}
    currentBalance={topupTarget.balance}
    api={props.api}
    onClose={() => setTopupTarget(null)}
    onSuccess={async (newBalance, added) => {
      setTopupTarget(null);
      setTopupToast(
        t("apikey.topupSuccess")
          .replace("${amount}", added.toFixed(2))
          .replace("${balance}", newBalance.toFixed(2))
      );
      window.setTimeout(() => setTopupToast(null), 4000);
      await props.refresh();
    }}
  />
)}
{topupToast && (
  <div
    style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      padding: "10px 16px",
      background: "var(--color-success, #10b981)",
      color: "white",
      borderRadius: 8,
      fontSize: 13,
      zIndex: 1000,
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
    }}
  >
    {topupToast}
  </div>
)}
```

- [ ] **Step 3: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 4: Create `ModelPricingSection` and `ModelPricingFormModal`

**Files:**
- Create: `apps/dashboard/src/components/ModelPricingFormModal.tsx`
- Create: `apps/dashboard/src/components/ModelPricingSection.tsx`
- Modify: `apps/dashboard/src/App.tsx` — render section in `ModelRegistry`
- Modify: `apps/dashboard/src/i18n.ts` — pricing strings

- [ ] **Step 1: Add i18n strings**

In `apps/dashboard/src/i18n.ts`, add to `en:`:

```ts
"pricing.title": "Model Pricing",
"pricing.subtitle": "Per-model token rates used to calculate request costs.",
"pricing.add": "Add Pricing",
"pricing.search": "Search models...",
"pricing.empty": "No pricing configured. Click + Add Pricing to set rates.",
"pricing.col.model": "Model",
"pricing.col.input": "Input / 1M",
"pricing.col.output": "Output / 1M",
"pricing.col.cached": "Cached / 1M",
"pricing.col.updated": "Updated",
"pricing.col.actions": "Actions",
"pricing.field.model": "Model name",
"pricing.field.inputRate": "Input rate (USD per 1M tokens)",
"pricing.field.outputRate": "Output rate (USD per 1M tokens)",
"pricing.field.cachedRate": "Cached input rate (USD per 1M tokens, optional)",
"pricing.field.label": "Display label (optional)",
"pricing.confirmDelete": "Delete pricing for {model}? This cannot be undone.",
"pricing.editTitle": "Edit pricing",
"pricing.addTitle": "Add pricing",
```

In `vi:`:

```ts
"pricing.title": "Giá Model",
"pricing.subtitle": "Đơn giá token theo từng model dùng để tính chi phí request.",
"pricing.add": "Thêm giá",
"pricing.search": "Tìm model...",
"pricing.empty": "Chưa có giá nào. Click + Thêm giá để cấu hình.",
"pricing.col.model": "Model",
"pricing.col.input": "Input / 1M",
"pricing.col.output": "Output / 1M",
"pricing.col.cached": "Cached / 1M",
"pricing.col.updated": "Cập nhật",
"pricing.col.actions": "Thao tác",
"pricing.field.model": "Tên model",
"pricing.field.inputRate": "Giá input (USD / 1M token)",
"pricing.field.outputRate": "Giá output (USD / 1M token)",
"pricing.field.cachedRate": "Giá cached input (USD / 1M token, tùy chọn)",
"pricing.field.label": "Nhãn hiển thị (tùy chọn)",
"pricing.confirmDelete": "Xóa giá cho {model}? Không thể hoàn tác.",
"pricing.editTitle": "Sửa giá",
"pricing.addTitle": "Thêm giá",
```

- [ ] **Step 2: Create `ModelPricingFormModal.tsx`**

Create `apps/dashboard/src/components/ModelPricingFormModal.tsx`:

```tsx
/**
 * ModelPricingFormModal — add or edit a model pricing entry.
 * PUT /admin/v1/model-pricing/:model (upsert).
 */

import { useState } from "react";
import { X } from "lucide-react";
import { useLang } from "../i18n";
import type { ModelPricing } from "./ModelPricingSection";

type ApiClient = {
  put: <T>(path: string, body: unknown) => Promise<T>;
};

type Props = {
  api: ApiClient;
  initial?: ModelPricing;
  onClose: () => void;
  onSaved: (entry: ModelPricing) => void;
};

export function ModelPricingFormModal({ api, initial, onClose, onSaved }: Props) {
  const { t } = useLang();
  const isEdit = Boolean(initial);
  const [model, setModel] = useState(initial?.model ?? "");
  const [inputRate, setInputRate] = useState(initial ? String(initial.inputRate) : "");
  const [outputRate, setOutputRate] = useState(initial ? String(initial.outputRate) : "");
  const [cachedRate, setCachedRate] = useState(
    initial?.cachedInputRate !== undefined ? String(initial.cachedInputRate) : ""
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const m = model.trim();
    const inN = Number.parseFloat(inputRate);
    const outN = Number.parseFloat(outputRate);
    if (!m) { setError("Model name is required"); return; }
    if (!Number.isFinite(inN) || inN < 0) { setError("Input rate must be ≥ 0"); return; }
    if (!Number.isFinite(outN) || outN < 0) { setError("Output rate must be ≥ 0"); return; }
    const cachedN = cachedRate.trim() === "" ? undefined : Number.parseFloat(cachedRate);
    if (cachedN !== undefined && (!Number.isFinite(cachedN) || cachedN < 0)) {
      setError("Cached rate must be ≥ 0 or empty");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { inputRate: inN, outputRate: outN };
      if (cachedN !== undefined) body.cachedInputRate = cachedN;
      if (label.trim()) body.label = label.trim();
      const saved = await api.put<ModelPricing>(
        `/admin/v1/model-pricing/${encodeURIComponent(m)}`,
        body
      );
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modalContent" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{isEdit ? t("pricing.editTitle") : t("pricing.addTitle")}</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.model")}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isEdit}
              placeholder="gpt-4o"
              autoFocus={!isEdit}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.inputRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={inputRate}
              onChange={(e) => setInputRate(e.target.value)}
              placeholder="2.50"
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.outputRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={outputRate}
              onChange={(e) => setOutputRate(e.target.value)}
              placeholder="10.00"
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.cachedRate")}
            <input
              type="number"
              min="0"
              step="0.001"
              value={cachedRate}
              onChange={(e) => setCachedRate(e.target.value)}
              placeholder="(empty = no cached pricing)"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {t("pricing.field.label")}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="(optional)"
            />
          </label>
          {error && <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>}
          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {busy ? "..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ModelPricingSection.tsx`**

Create `apps/dashboard/src/components/ModelPricingSection.tsx`:

```tsx
/**
 * ModelPricingSection — table CRUD for per-model token pricing.
 * GET    /admin/v1/model-pricing
 * PUT    /admin/v1/model-pricing/:model  (upsert)
 * DELETE /admin/v1/model-pricing/:model
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Edit3, Trash2, X } from "lucide-react";
import { useLang } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModelPricingFormModal } from "./ModelPricingFormModal";

export type ModelPricing = {
  model: string;
  inputRate: number;
  outputRate: number;
  cachedInputRate?: number;
  label?: string;
  updatedAt: string; // ISO from JSON
};

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
};

type Props = { api: ApiClient };

function fmt(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ModelPricingSection({ api }: Props) {
  const { t } = useLang();
  const [entries, setEntries] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ModelPricing | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModelPricing | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ModelPricing[]>("/admin/v1/model-pricing");
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pricing");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter((e) => e.model.toLowerCase().includes(q) || (e.label ?? "").toLowerCase().includes(q))
      : entries;
    return [...list].sort((a, b) => a.model.localeCompare(b.model));
  }, [entries, search]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await api.delete(`/admin/v1/model-pricing/${encodeURIComponent(target.model)}`);
      setEntries((prev) => prev.filter((e) => e.model !== target.model));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function upsertEntry(entry: ModelPricing) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.model === entry.model);
      if (idx === -1) return [...prev, entry];
      const next = prev.slice();
      next[idx] = entry;
      return next;
    });
    setEditing(null);
    setShowAdd(false);
  }

  return (
    <section className="endpointCard" style={{ marginTop: 20 }}>
      <header className="endpointCardHeader endpointCardHeaderRow">
        <div>
          <h2>{t("pricing.title")}</h2>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            {t("pricing.subtitle")}
          </p>
        </div>
        <button type="button" className="primaryButton" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> {t("pricing.add")}
        </button>
      </header>

      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--color-border)" }}>
        <Search size={14} style={{ color: "var(--color-text-muted)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pricing.search")}
          style={{ flex: 1, border: "none", background: "transparent", fontSize: 13, outline: "none", color: "inherit" }}
        />
        {search && (
          <button className="iconButton compact" type="button" onClick={() => setSearch("")} aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      {loading && <div style={{ padding: 16, fontSize: 13, color: "var(--color-text-muted)" }}>Loading...</div>}
      {error && <div style={{ padding: 16, color: "#ef4444", fontSize: 13 }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
          {t("pricing.empty")}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-surface-2)" }}>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>{t("pricing.col.model")}</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("pricing.col.input")}</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("pricing.col.output")}</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("pricing.col.cached")}</th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>{t("pricing.col.updated")}</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>{t("pricing.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.model} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "8px 12px" }}>
                  <code style={{ fontSize: 12 }}>{entry.model}</code>
                  {entry.label && (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{entry.label}</div>
                  )}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.inputRate)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(entry.outputRate)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {entry.cachedInputRate !== undefined ? fmt(entry.cachedInputRate) : "—"}
                </td>
                <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{relTime(entry.updatedAt)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  <button className="iconButton compact" type="button" title="Edit" onClick={() => setEditing(entry)}>
                    <Edit3 size={14} />
                  </button>
                  <button className="iconButton compact danger" type="button" title="Delete" onClick={() => setPendingDelete(entry)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(showAdd || editing) && (
        <ModelPricingFormModal
          api={api}
          initial={editing ?? undefined}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={upsertEntry}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete pricing"
          message={t("pricing.confirmDelete").replace("{model}", pendingDelete.model)}
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render `ModelPricingSection` in `ModelRegistry`**

In `apps/dashboard/src/App.tsx`, add the import near other component imports:

```ts
import { ModelPricingSection } from "./components/ModelPricingSection";
```

Find `ModelRegistry` (line 3733). Locate the `<ModelAliasesSection api={props.api} />` line near the bottom of its return (around line 3929). Add immediately after it:

```tsx
<ModelPricingSection api={props.api} />
```

- [ ] **Step 5: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 5: Wire `Test All` button to real endpoint with results modal

**Files:**
- Create: `apps/dashboard/src/components/TestAllResultsModal.tsx`
- Modify: `apps/dashboard/src/ProvidersPage.tsx` — replace fake handler, add header button, drop per-group buttons
- Modify: `apps/dashboard/src/i18n.ts` — test all strings

- [ ] **Step 1: Add i18n strings**

In `apps/dashboard/src/i18n.ts`, add to `en:`:

```ts
"prov.testAll": "Test All Connections",
"prov.testing": "Testing...",
"prov.testResults": "Connection Test Results",
"prov.testSummary.ok": "OK",
"prov.testSummary.degraded": "Degraded",
"prov.testSummary.down": "Down",
"prov.testFilter.all": "All",
"prov.testEmpty": "No provider instances configured.",
```

In `vi:`:

```ts
"prov.testAll": "Kiểm tra tất cả",
"prov.testing": "Đang kiểm tra...",
"prov.testResults": "Kết quả kiểm tra kết nối",
"prov.testSummary.ok": "OK",
"prov.testSummary.degraded": "Cảnh báo",
"prov.testSummary.down": "Lỗi",
"prov.testFilter.all": "Tất cả",
"prov.testEmpty": "Chưa có provider instance nào.",
```

- [ ] **Step 2: Create `TestAllResultsModal.tsx`**

Create `apps/dashboard/src/components/TestAllResultsModal.tsx`:

```tsx
/**
 * TestAllResultsModal — display POST /admin/v1/test-all results.
 */

import { useState } from "react";
import { X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useLang } from "../i18n";

export type TestAllResult = {
  providerInstanceId: string;
  type: string;
  name: string;
  status: "ok" | "degraded" | "down" | "error";
  message?: string;
  durationMs: number;
};

export type TestAllPayload = {
  summary: { total: number; ok: number; degraded: number; down: number };
  results: TestAllResult[];
};

type Props = {
  payload: TestAllPayload;
  onClose: () => void;
};

type Filter = "all" | "ok" | "degraded" | "down";

function statusIcon(status: TestAllResult["status"]) {
  if (status === "ok") return <CheckCircle2 size={14} style={{ color: "#10b981" }} />;
  if (status === "degraded") return <AlertTriangle size={14} style={{ color: "#f59e0b" }} />;
  return <XCircle size={14} style={{ color: "#ef4444" }} />;
}

export function TestAllResultsModal({ payload, onClose }: Props) {
  const { t } = useLang();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = payload.results.filter((r) => {
    if (filter === "all") return true;
    if (filter === "down") return r.status === "down" || r.status === "error";
    return r.status === filter;
  });

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modalContent" style={{ maxWidth: 720, maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{t("prov.testResults")}</h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "12px 20px", display: "flex", gap: 16, alignItems: "center", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <CheckCircle2 size={14} style={{ color: "#10b981" }} /> {payload.summary.ok} {t("prov.testSummary.ok")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <AlertTriangle size={14} style={{ color: "#f59e0b" }} /> {payload.summary.degraded} {t("prov.testSummary.degraded")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <XCircle size={14} style={{ color: "#ef4444" }} /> {payload.summary.down} {t("prov.testSummary.down")}
          </span>
        </div>

        <div style={{ padding: "8px 20px", display: "flex", gap: 6, borderBottom: "1px solid var(--color-border)" }}>
          {(["all", "ok", "degraded", "down"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? "primaryButton" : "ghostButton"}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? `${t("prov.testFilter.all")} (${payload.results.length})`
                : f === "ok"
                  ? `${t("prov.testSummary.ok")} (${payload.summary.ok})`
                  : f === "degraded"
                    ? `${t("prov.testSummary.degraded")} (${payload.summary.degraded})`
                    : `${t("prov.testSummary.down")} (${payload.summary.down})`}
            </button>
          ))}
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
              {t("prov.testEmpty")}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.providerInstanceId} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "8px 12px", width: 28 }}>{statusIcon(r.status)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <strong>{r.name}</strong>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{r.type}</div>
                      {r.message && (
                        <div style={{ fontSize: 11, color: r.status === "down" || r.status === "error" ? "#ef4444" : "var(--color-text-muted)", marginTop: 2 }}>
                          ↳ {r.message}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {r.durationMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="routeModalFooter">
          <button type="button" className="primaryButton" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `ProvidersPage.tsx`**

Modify `apps/dashboard/src/ProvidersPage.tsx`:

Add import at top:

```ts
import { TestAllResultsModal, type TestAllPayload } from "./components/TestAllResultsModal";
```

Inside `ProvidersPage` function body (around line 215 where `useState` calls are), replace:

```ts
const [testingMode, setTestingMode] = useState<string | null>(null);
```

with:

```ts
const [testing, setTesting] = useState(false);
const [testResult, setTestResult] = useState<TestAllPayload | null>(null);
const [testError, setTestError] = useState<string | null>(null);
```

Replace the `handleBatchTest` function (lines ~302–306):

```ts
async function handleTestAll() {
  if (testing || !props.api) return;
  setTesting(true);
  setTestError(null);
  try {
    const payload = await props.api.post<TestAllPayload>("/admin/v1/test-all", {});
    setTestResult(payload);
  } catch (err) {
    setTestError(err instanceof Error ? err.message : "Test failed");
  } finally {
    setTesting(false);
  }
}
```

In the page header JSX (the `providersPageHeader` div around line 325), add a button next to the search wrap. Replace:

```tsx
<div className="providersSearchWrap">
```

with:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
  <button
    type="button"
    className="primaryButton"
    onClick={() => void handleTestAll()}
    disabled={testing}
    title={t("prov.testAll")}
  >
    <Play size={14} />
    {testing ? t("prov.testing") : t("prov.testAll")}
  </button>
  <div className="providersSearchWrap">
```

And close the new wrapper `</div>` after the existing search wrap's closing `</div>`. Locate the end of the search wrap (near the line containing `<X size={14} />` inside the clear button) and ensure the wrapper is closed correctly. The structure should become:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
  <button ...>{...}</button>
  <div className="providersSearchWrap">
    <Search size={16} />
    <input ... />
    {search && <button>...</button>}
  </div>
</div>
```

Remove the per-group "Test All" buttons. Find the section in `AUTH_GROUP_ORDER.map` rendering (around line 387-397):

```tsx
{groupKey !== "custom" && (
  <button
    className={`providerTestAllBtn ${testingMode === groupKey ? "providerTestAllBtn--active" : ""}`}
    onClick={() => void handleBatchTest(groupKey)}
    disabled={!!testingMode}
    title={`Test all ${AUTH_GROUP_LABELS[groupKey]} connections`}
  >
    <Play size={12} />
    {testingMode === groupKey ? "Testing..." : "Test All"}
  </button>
)}
```

Delete this entire block (including the wrapping `{groupKey !== "custom" && ...}` and the closing `)}`).

At the end of the `ProvidersPage` JSX, just before the closing `</div>` of `providersPage`, add:

```tsx
{testError && (
  <div style={{ position: "fixed", bottom: 24, right: 24, padding: "10px 16px", background: "#ef4444", color: "white", borderRadius: 8, fontSize: 13, zIndex: 1000 }}>
    {testError}
  </div>
)}
{testResult && (
  <TestAllResultsModal payload={testResult} onClose={() => setTestResult(null)} />
)}
```

- [ ] **Step 4: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors. If `props.api` is typed as optional (`api?:`), the call inside `handleTestAll` is guarded by `!props.api` early return.

- [ ] **Step 5: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 6: Create `SyncModelsModal` and wire to `ProviderDetail`

**Files:**
- Create: `apps/dashboard/src/components/SyncModelsModal.tsx`
- Modify: `apps/dashboard/src/App.tsx` — import + button + modal in `ProviderDetail`
- Modify: `apps/dashboard/src/i18n.ts` — sync strings

- [ ] **Step 1: Add i18n strings**

In `apps/dashboard/src/i18n.ts`, add to `en:`:

```ts
"prov.syncModels": "Sync Models",
"prov.syncDiscovering": "Discovering models from upstream...",
"prov.syncTitle": "Sync models from upstream",
"prov.syncDiscovered": "Discovered {n} models. {newN} new, {removedN} removed.",
"prov.syncNewHeader": "New (will be added)",
"prov.syncRemovedHeader": "Removed from upstream",
"prov.syncRemovedNote": "Existing mappings won't be auto-deleted:",
"prov.syncAllMapped": "All upstream models are already mapped.",
"prov.syncAdd": "Add {n} models",
"prov.syncDone": "Added {n} models",
"prov.syncMore": "... {n} more",
```

In `vi:`:

```ts
"prov.syncModels": "Đồng bộ Models",
"prov.syncDiscovering": "Đang tìm model từ upstream...",
"prov.syncTitle": "Đồng bộ model từ upstream",
"prov.syncDiscovered": "Tìm thấy {n} model. {newN} mới, {removedN} đã bị xóa.",
"prov.syncNewHeader": "Mới (sẽ được thêm)",
"prov.syncRemovedHeader": "Đã bị xóa khỏi upstream",
"prov.syncRemovedNote": "Mapping hiện có sẽ không bị tự động xóa:",
"prov.syncAllMapped": "Tất cả model upstream đã được mapping.",
"prov.syncAdd": "Thêm {n} model",
"prov.syncDone": "Đã thêm {n} model",
"prov.syncMore": "... còn {n} model nữa",
```

- [ ] **Step 2: Create `SyncModelsModal.tsx`**

Create `apps/dashboard/src/components/SyncModelsModal.tsx`:

```tsx
/**
 * SyncModelsModal — preview-then-confirm sync from upstream.
 * POST /admin/v1/provider-instances/:id/sync-models
 *   - First call (no body): preview { discovered, new[], removed[] }
 *   - Second call ({autoCreate:true}): create all new mappings
 */

import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { useLang } from "../i18n";

type ApiClient = {
  post: <T>(path: string, body: unknown) => Promise<T>;
};

type SyncResponse = {
  providerInstanceId: string;
  discovered: number;
  new: Array<{ id: string; upstreamModel: string }>;
  removed: Array<{ id: string; publicModel: string }>;
  autoCreated?: string[];
};

type Props = {
  api: ApiClient;
  providerInstanceId: string;
  providerInstanceName: string;
  onClose: () => void;
  onApplied: (createdCount: number) => void;
};

const PREVIEW_LIMIT = 8;

export function SyncModelsModal({ api, providerInstanceId, providerInstanceName, onClose, onApplied }: Props) {
  const { t } = useLang();
  const [phase, setPhase] = useState<"loading" | "preview" | "applying" | "error">("loading");
  const [preview, setPreview] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.post<SyncResponse>(
          `/admin/v1/provider-instances/${providerInstanceId}/sync-models`,
          {}
        );
        setPreview(result);
        setPhase("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to discover models");
        setPhase("error");
      }
    })();
  }, [api, providerInstanceId]);

  async function applySync() {
    if (!preview || phase === "applying") return;
    setPhase("applying");
    setError(null);
    try {
      const result = await api.post<SyncResponse>(
        `/admin/v1/provider-instances/${providerInstanceId}/sync-models`,
        { autoCreate: true }
      );
      onApplied(result.autoCreated?.length ?? preview.new.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setPhase("preview");
    }
  }

  const newCount = preview?.new.length ?? 0;
  const removedCount = preview?.removed.length ?? 0;
  const newPreview = (preview?.new ?? []).slice(0, PREVIEW_LIMIT);
  const newOverflow = Math.max(0, newCount - PREVIEW_LIMIT);

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modalContent" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={18} />
            {t("prov.syncTitle")}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Provider instance: <code>{providerInstanceName}</code>
          </div>

          {phase === "loading" && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-text-muted)" }}>
              {t("prov.syncDiscovering")}
            </div>
          )}

          {phase === "error" && (
            <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>
          )}

          {(phase === "preview" || phase === "applying") && preview && (
            <>
              <div style={{ fontSize: 13 }}>
                {t("prov.syncDiscovered")
                  .replace("{n}", String(preview.discovered))
                  .replace("{newN}", String(newCount))
                  .replace("{removedN}", String(removedCount))}
              </div>

              {newCount === 0 && (
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {t("prov.syncAllMapped")}
                </div>
              )}

              {newCount > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    {t("prov.syncNewHeader")}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 2 }}>
                    {newPreview.map((m) => (
                      <li key={m.id}>+ {m.upstreamModel}</li>
                    ))}
                    {newOverflow > 0 && (
                      <li style={{ color: "var(--color-text-muted)" }}>
                        {t("prov.syncMore").replace("{n}", String(newOverflow))}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {removedCount > 0 && (
                <div style={{ padding: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#d97706" }}>
                    {t("prov.syncRemovedHeader")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
                    ⚠ {t("prov.syncRemovedNote")}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 2 }}>
                    {preview.removed.map((m) => (
                      <li key={m.id}>• {m.publicModel}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && phase === "preview" && (
                <div style={{ color: "#ef4444", fontSize: 12 }}>{error}</div>
              )}
            </>
          )}
        </div>

        <div className="routeModalFooter">
          <button type="button" className="ghostButton" onClick={onClose} disabled={phase === "applying"}>
            Cancel
          </button>
          {(phase === "preview" || phase === "applying") && newCount > 0 && (
            <button
              type="button"
              className="primaryButton"
              onClick={() => void applySync()}
              disabled={phase === "applying"}
            >
              {phase === "applying"
                ? "..."
                : t("prov.syncAdd").replace("{n}", String(newCount))}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ProviderDetail`**

In `apps/dashboard/src/App.tsx`, add to imports:

```ts
import { SyncModelsModal } from "./components/SyncModelsModal";
```

Inside `ProviderDetail` (line 2261), add to the existing `useState` block (near line 2284):

```ts
const [syncOpen, setSyncOpen] = useState(false);
const [syncToast, setSyncToast] = useState<string | null>(null);
```

Locate the Models section header (around line 2835-2842), specifically the `connectionControls` div containing "Add Model" and "Disable All". Add a Sync Models button before "Add Model":

```tsx
<button
  className="secondaryButton"
  type="button"
  onClick={() => setSyncOpen(true)}
  disabled={
    props.instances.length === 0 ||
    props.accounts.filter((a) => a.status === "active").length === 0
  }
  title={t("prov.syncModels")}
>
  <RefreshCw size={16} /> {t("prov.syncModels")}
</button>
```

Verify `RefreshCw` is imported from `lucide-react` near the top of `App.tsx`. If not, add it to the existing lucide-react import block.

At the end of the `ProviderDetail` JSX (just before the final closing tag of its return), add:

```tsx
{syncOpen && props.instances[0] && (
  <SyncModelsModal
    api={props.api}
    providerInstanceId={props.instances[0].id}
    providerInstanceName={props.instances[0].name ?? props.instances[0].id}
    onClose={() => setSyncOpen(false)}
    onApplied={async (n) => {
      setSyncOpen(false);
      setSyncToast(t("prov.syncDone").replace("{n}", String(n)));
      window.setTimeout(() => setSyncToast(null), 4000);
      await props.refresh();
    }}
  />
)}
{syncToast && (
  <div style={{ position: "fixed", bottom: 24, right: 24, padding: "10px 16px", background: "#10b981", color: "white", borderRadius: 8, fontSize: 13, zIndex: 1000 }}>
    {syncToast}
  </div>
)}
```

- [ ] **Step 4: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 7: UsagePage cost cleanup — prefer backend `estimatedCost`

**Files:**
- Modify: `apps/dashboard/src/UsagePage.tsx`

- [ ] **Step 1: Extend the `UsageRecord` type**

In `apps/dashboard/src/UsagePage.tsx`, find the `UsageRecord` type (line 21) and add the two new optional fields:

```ts
export type UsageRecord = {
  id: string;
  requestId: string;
  protocol: string;
  model: string;
  providerType: string;
  providerInstanceId: string;
  accountId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  estimatedCost?: number;
  createdAt: string;
};
```

- [ ] **Step 2: Update `estimateCost` to prefer backend `estimatedCost`**

Replace the existing `estimateCost` function (lines 62–67) with one that takes the full record:

```ts
function estimateCost(record: Pick<UsageRecord, "model" | "promptTokens" | "completionTokens" | "estimatedCost">) {
  if (typeof record.estimatedCost === "number") {
    return { inputCost: 0, outputCost: 0, totalCost: record.estimatedCost };
  }
  const costs = MODEL_COSTS[record.model] ?? { input: 3.0, output: 15.0 };
  const inputCost = (record.promptTokens / 1_000_000) * costs.input;
  const outputCost = (record.completionTokens / 1_000_000) * costs.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}
```

Note: when backend provides `estimatedCost` we don't have a meaningful split between input and output. The breakdown columns will show `$0.00` for input/output and the full amount in total. That's acceptable for now — the breakdown is approximate anyway.

- [ ] **Step 3: Update all callers of `estimateCost`**

Search for `estimateCost(` calls in `UsagePage.tsx`. Each currently passes `(r.model, r.promptTokens, r.completionTokens)`. Update each to pass the record:

Around line 172:

```ts
totalCost += estimateCost(r).totalCost;
```

Around line 186:

```ts
const cost = estimateCost(r);
```

Around line 583:

```ts
: estimateCost(r).totalCost;
```

Re-grep after editing to confirm no calls retain the old positional arguments:

Run: `grep -n "estimateCost(" apps/dashboard/src/UsagePage.tsx`
Expected: All call sites pass a single record argument.

- [ ] **Step 4: Type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds.

---

## Task 8: Final verification + single Phase 19 commit

This task runs the full verification sweep and lands one commit per the user's chosen strategy.

- [ ] **Step 1: Gateway type check**

Run: `pnpm -C apps/gateway exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Gateway test suite**

Run: `pnpm -C apps/gateway test`
Expected: All tests pass.

- [ ] **Step 3: Dashboard type check**

Run: `pnpm -C apps/dashboard exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Dashboard build**

Run: `pnpm -C apps/dashboard build`
Expected: Build succeeds. Output in `apps/dashboard/dist/`.

- [ ] **Step 5: Manual smoke test**

Start the gateway (with the dashboard mounted from `dashboard-dist/`):

Run in a separate terminal: `pnpm -C apps/gateway dev`

Open the dashboard URL in a browser (typically `http://localhost:8787/` or whatever port the gateway uses; check console output) and verify each surface. Note: some surfaces require existing data — if you don't have it, document what couldn't be exercised rather than claiming success.

Checklist:
1. **Models page → Model Pricing section** — list loads, search filters, click `+ Add Pricing` to open modal, save, edit, delete (confirm dialog appears).
2. **API Keys section** — each row shows balance badge (`∞` for keys without balance, `$X.XX` for ones with balance), click `+` icon to open Topup modal, submit a small amount, confirm balance updates and toast appears.
3. **Providers page header** — `Test All Connections` button visible, no per-group buttons. Click → modal renders with summary + filtered results. Filter chips work. Close modal.
4. **Provider detail (any provider with active accounts)** — `Sync Models` button visible in Models section header. Click → preview loads, shows new/removed lists, click `Add N models` → toast appears, models list refreshes.
5. **Usage page** — page loads, cost columns still display sensible numbers; if backend records have `estimatedCost`, the totals reflect those; older records use the local estimation.

If any step cannot be exercised (e.g., no provider with active accounts, no usage records), document that explicitly in the commit message.

- [ ] **Step 6: Stage Phase 19 changes**

Stage only the Phase 19 files (not the unrelated pre-existing modifications visible in `git status`):

```bash
git add \
  apps/dashboard/src/App.tsx \
  apps/dashboard/src/ProvidersPage.tsx \
  apps/dashboard/src/UsagePage.tsx \
  apps/dashboard/src/i18n.ts \
  apps/dashboard/src/styles.css \
  apps/dashboard/src/components/ModelPricingSection.tsx \
  apps/dashboard/src/components/ModelPricingFormModal.tsx \
  apps/dashboard/src/components/TopupModal.tsx \
  apps/dashboard/src/components/TestAllResultsModal.tsx \
  apps/dashboard/src/components/SyncModelsModal.tsx \
  apps/gateway/src/test/root.test.ts
```

Run `git status` to confirm only the intended files are staged. Pre-existing `M` files (e.g. `apps/gateway/src/config.ts`, `apps/gateway/src/middleware/auth.ts`, etc.) should remain unstaged — those are out of scope for this commit.

- [ ] **Step 7: Commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
feat(phase19): dashboard UI for new-api features

- Model Pricing CRUD section on Models page (PUT/DELETE
  /admin/v1/model-pricing)
- API key balance badge + topup modal (POST .../api-keys/:id/topup)
- Test All Connections wired to POST /admin/v1/test-all with
  results modal (replaces fake setTimeout)
- Sync Models per-instance button with preview-then-confirm
  modal (POST .../provider-instances/:id/sync-models)
- UsagePage prefers backend estimatedCost over hardcoded table
- Fix root.test.ts to expect 200 (dashboard-dist exists)

Frontend wire-up only; backend endpoints already in be4b82e.
EOF
)"
```

- [ ] **Step 8: Confirm clean state**

Run: `git log --oneline -3`
Expected: Top commit is the Phase 19 feat commit; previous commits are `bbe600f` (spec) and `be4b82e` (Phase 17–18 + new-api integration).

Run: `git status`
Expected: Same `M` files as before this work started (pre-existing uncommitted changes), plus `?? .claude/`. No new untracked Phase 19 files.

---

## Self-Review Notes

Spec coverage check:
- Section 1 (Model Pricing UI) → Task 4 ✓
- Section 2 (Balance & Topup UI) → Tasks 2 + 3 ✓
- Section 3 (Test All wire-up) → Task 5 ✓
- Section 4 (Sync Models button) → Task 6 ✓
- Section 5 (Usage cost cleanup) → Task 7 ✓
- Section 6 (root.test.ts fix) → Task 1 ✓

Type consistency:
- `ModelPricing` exported from `ModelPricingSection.tsx`, imported into `ModelPricingFormModal.tsx` ✓
- `TestAllPayload`/`TestAllResult` exported from `TestAllResultsModal.tsx`, imported in `ProvidersPage.tsx` ✓
- `ApiClient` shape (subset of `createApiClient` return) declared per-component matches usage ✓
- `ApiKey.balance?: number` referenced in App.tsx and TopupModal — same shape ✓

Placeholder scan: No "TBD"/"TODO"/"add appropriate". Where exact line locations depend on the long App.tsx file, the steps include the locator strategy (search by token, anchor near a known line). All code blocks are concrete.
