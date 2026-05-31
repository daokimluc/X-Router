/**
 * MarketplacePage — admin-marketplace-ui (#4).
 *
 * Operator dashboard for the P2P marketplace. Shown only when the gateway runs
 * with MARKETPLACE_ENABLED (the flag is surfaced via /v1/public/auth-info and the
 * page + nav entry are gated in App.tsx). Lazy-loaded so it never ships in the
 * community (flag-off) entry chunk.
 *
 * Pure consumption of existing admin endpoints — no new backend. Sub-panels by
 * entity: Plans, Sellers, Listings, Earnings, Wallets, Markup, Canonical models,
 * Webhook, plus a Books-health reconciliation read.
 */
import { useCallback, useEffect, useState } from "react";
import { useLang } from "./i18n";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
};

type SubTab =
  | "plans"
  | "sellers"
  | "listings"
  | "earnings"
  | "wallets"
  | "markup"
  | "canonical"
  | "webhook";

const SUB_TABS: Array<{ id: SubTab; labelKey: string }> = [
  { id: "plans", labelKey: "mkt.tab.plans" },
  { id: "sellers", labelKey: "mkt.tab.sellers" },
  { id: "listings", labelKey: "mkt.tab.listings" },
  { id: "earnings", labelKey: "mkt.tab.earnings" },
  { id: "wallets", labelKey: "mkt.tab.wallets" },
  { id: "markup", labelKey: "mkt.tab.markup" },
  { id: "canonical", labelKey: "mkt.tab.canonical" },
  { id: "webhook", labelKey: "mkt.tab.webhook" }
];

export default function MarketplacePage({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const [tab, setTab] = useState<SubTab>("plans");

  return (
    <div className="stack">
      <div className="segmented" style={{ flexWrap: "wrap" }}>
        {SUB_TABS.map((s) => (
          <button
            key={s.id}
            className={`segmentedItem ${tab === s.id ? "active" : ""}`}
            onClick={() => setTab(s.id)}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {tab === "plans" && <PlansPanel api={api} />}
      {tab === "sellers" && <SellersPanel api={api} />}
      {tab === "listings" && <ListingsPanel api={api} />}
      {tab === "earnings" && <EarningsPanel api={api} />}
      {tab === "wallets" && <WalletsPanel api={api} />}
      {tab === "markup" && <MarkupPanel api={api} />}
      {tab === "canonical" && <CanonicalPanel api={api} />}
      {tab === "webhook" && <WebhookPanel api={api} />}
    </div>
  );
}

/** Shared inline status banner for panel-level results. */
function useFlash() {
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const show = useCallback((kind: "ok" | "err", msg: string) => {
    setFlash({ kind, msg });
    if (kind === "ok") setTimeout(() => setFlash(null), 3000);
  }, []);
  const node = flash ? (
    <div
      style={{
        fontSize: 13,
        padding: "8px 12px",
        borderRadius: 8,
        marginBottom: 12,
        background: flash.kind === "ok" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
        border: `1px solid ${flash.kind === "ok" ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`,
        color: flash.kind === "ok" ? "#059669" : "#ef4444"
      }}
    >
      {flash.msg}
    </div>
  ) : null;
  return { node, show };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Request failed";
}

// PANELS_PLACEHOLDER

// ── Plans ────────────────────────────────────────────────────────────────────
type Plan = {
  id: string;
  name: string;
  priceUsd: number;
  modelGroups: string[];
  buckets: { hourUsd: number; dayUsd: number; monthUsd: number };
  overageEnabled: boolean;
  paygDailyLimitUsd?: number;
};

const emptyPlanForm = {
  id: "",
  name: "",
  priceUsd: "0",
  modelGroups: "claude",
  hourUsd: "0",
  dayUsd: "0",
  monthUsd: "0",
  overageEnabled: false,
  paygDailyLimitUsd: ""
};

function PlansPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<typeof emptyPlanForm | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ plans: Plan[] }>("/admin/v1/plans");
      setPlans(res.plans);
    } catch (e) {
      show("err", errMsg(e));
    }
  }, [api, show]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing({ ...emptyPlanForm });
    setIsNew(true);
  }
  function openEdit(p: Plan) {
    setEditing({
      id: p.id,
      name: p.name,
      priceUsd: String(p.priceUsd),
      modelGroups: p.modelGroups.join(", "),
      hourUsd: String(p.buckets.hourUsd),
      dayUsd: String(p.buckets.dayUsd),
      monthUsd: String(p.buckets.monthUsd),
      overageEnabled: p.overageEnabled,
      paygDailyLimitUsd: p.paygDailyLimitUsd === undefined ? "" : String(p.paygDailyLimitUsd)
    });
    setIsNew(false);
  }

  async function save() {
    if (!editing) return;
    const body: Record<string, unknown> = {
      name: editing.name.trim(),
      priceUsd: Number(editing.priceUsd) || 0,
      modelGroups: editing.modelGroups.split(",").map((s) => s.trim()).filter(Boolean),
      buckets: { hourUsd: Number(editing.hourUsd) || 0, dayUsd: Number(editing.dayUsd) || 0, monthUsd: Number(editing.monthUsd) || 0 },
      overageEnabled: editing.overageEnabled
    };
    if (editing.paygDailyLimitUsd.trim()) body.paygDailyLimitUsd = Number(editing.paygDailyLimitUsd);
    try {
      if (isNew) {
        if (editing.id.trim()) body.id = editing.id.trim();
        await api.post("/admin/v1/plans", body);
      } else {
        await api.patch(`/admin/v1/plans/${editing.id}`, body);
      }
      setEditing(null);
      show("ok", t("mkt.saved"));
      await load();
    } catch (e) {
      show("err", errMsg(e));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("mkt.plans.confirmDelete"))) return;
    try {
      await api.delete(`/admin/v1/plans/${id}`);
      show("ok", t("mkt.deleted"));
      await load();
    } catch (e) {
      show("err", errMsg(e));
    }
  }

  return (
    <div>
      {flash}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3>{t("mkt.plans.title")}</h3>
        <button className="primaryButton" onClick={openCreate}>{t("mkt.plans.create")}</button>
      </div>
      <div className="tableWrap" style={{ overflowX: "auto" }}>
        <table className="mktTable">
          <thead>
            <tr>
              <th>{t("mkt.plans.name")}</th><th>{t("mkt.plans.groups")}</th>
              <th>{t("mkt.plans.buckets")}</th><th>{t("mkt.plans.overage")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong><div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{p.id}</div></td>
                <td>{p.modelGroups.join(", ")}</td>
                <td style={{ fontSize: 12 }}>${p.buckets.hourUsd}/h · ${p.buckets.dayUsd}/d · ${p.buckets.monthUsd}/mo</td>
                <td>{p.overageEnabled ? `PAYG${p.paygDailyLimitUsd ? ` ($${p.paygDailyLimitUsd}/d)` : ""}` : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ghostButton" onClick={() => openEdit(p)}>{t("mkt.edit")}</button>{" "}
                  <button className="ghostButton" onClick={() => void remove(p.id)}>{t("mkt.delete")}</button>
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 16 }}>{t("mkt.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modalOverlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modalContent" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader"><h2>{isNew ? t("mkt.plans.create") : t("mkt.plans.editTitle")}</h2></div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {isNew && <label className="formField"><span>{t("mkt.plans.idOptional")}</span><input value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} placeholder="plan_custom" /></label>}
              <label className="formField"><span>{t("mkt.plans.name")}</span><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="formField"><span>{t("mkt.plans.groupsCsv")}</span><input value={editing.modelGroups} onChange={(e) => setEditing({ ...editing, modelGroups: e.target.value })} placeholder="claude, codex" /></label>
              <label className="formField"><span>{t("mkt.plans.priceUsd")}</span><input type="number" min="0" step="0.01" value={editing.priceUsd} onChange={(e) => setEditing({ ...editing, priceUsd: e.target.value })} /></label>
              <div style={{ display: "flex", gap: 8 }}>
                <label className="formField" style={{ flex: 1 }}><span>$/hour</span><input type="number" min="0" step="0.01" value={editing.hourUsd} onChange={(e) => setEditing({ ...editing, hourUsd: e.target.value })} /></label>
                <label className="formField" style={{ flex: 1 }}><span>$/day</span><input type="number" min="0" step="0.01" value={editing.dayUsd} onChange={(e) => setEditing({ ...editing, dayUsd: e.target.value })} /></label>
                <label className="formField" style={{ flex: 1 }}><span>$/month</span><input type="number" min="0" step="0.01" value={editing.monthUsd} onChange={(e) => setEditing({ ...editing, monthUsd: e.target.value })} /></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={editing.overageEnabled} onChange={(e) => setEditing({ ...editing, overageEnabled: e.target.checked })} />
                {t("mkt.plans.overageEnabled")}
              </label>
              {editing.overageEnabled && <label className="formField"><span>{t("mkt.plans.paygDaily")}</span><input type="number" min="0" step="0.01" value={editing.paygDailyLimitUsd} onChange={(e) => setEditing({ ...editing, paygDailyLimitUsd: e.target.value })} /></label>}
            </div>
            <div className="routeModalFooter">
              <button className="ghostButton" onClick={() => setEditing(null)}>{t("mkt.cancel")}</button>
              <button className="primaryButton" onClick={() => void save()} disabled={!editing.name.trim()}>{t("mkt.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// PANELS_PLACEHOLDER_2

// ── Sellers ──────────────────────────────────────────────────────────────────
type Seller = {
  id: string;
  displayName: string;
  status: "pending" | "approved" | "suspended";
  payoutRef?: string;
  commissionPct?: number;
  createdAt: string;
};
type EarningsSnapshot = { sellerId: string; day: number; month: number; lifetime: number; unpaid: number };

function SellersPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [earnings, setEarnings] = useState<Record<string, EarningsSnapshot>>({});
  const [editing, setEditing] = useState<{ id: string; commissionPct: string; payoutRef: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ sellers: Seller[] }>("/admin/v1/sellers");
      setSellers(res.sellers);
      const snaps: Record<string, EarningsSnapshot> = {};
      await Promise.all(res.sellers.filter((s) => s.id !== "house").map(async (s) => {
        try { snaps[s.id] = await api.get<EarningsSnapshot>(`/admin/v1/earnings/seller/${s.id}`); } catch { /* ignore */ }
      }));
      setEarnings(snaps);
    } catch (e) {
      show("err", errMsg(e));
    }
  }, [api, show]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "approve" | "reject" | "suspend") {
    try {
      await api.post(`/admin/v1/sellers/${id}/${action}`, {});
      show("ok", t("mkt.saved"));
      await load();
    } catch (e) {
      show("err", errMsg(e));
    }
  }

  async function saveTerms() {
    if (!editing) return;
    const body: Record<string, unknown> = {};
    if (editing.commissionPct.trim()) body.commissionPct = Number(editing.commissionPct);
    if (editing.payoutRef.trim()) body.payoutRef = editing.payoutRef.trim();
    try {
      await api.patch(`/admin/v1/sellers/${editing.id}`, body);
      setEditing(null);
      show("ok", t("mkt.saved"));
      await load();
    } catch (e) {
      show("err", errMsg(e));
    }
  }

  const badge = (s: Seller["status"]) => {
    const color = s === "approved" ? "#059669" : s === "pending" ? "#d97706" : "#ef4444";
    return <span style={{ fontSize: 11, fontWeight: 700, color }}>{s}</span>;
  };

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.sellers.title")}</h3>
      <div className="tableWrap" style={{ overflowX: "auto" }}>
        <table className="mktTable">
          <thead>
            <tr><th>{t("mkt.sellers.name")}</th><th>{t("mkt.sellers.status")}</th><th>{t("mkt.sellers.commission")}</th><th>{t("mkt.sellers.unpaid")}</th><th></th></tr>
          </thead>
          <tbody>
            {sellers.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.displayName}</strong><div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{s.id}</div></td>
                <td>{badge(s.status)}</td>
                <td>{s.commissionPct !== undefined ? `${(s.commissionPct * 100).toFixed(1)}%` : "—"}</td>
                <td>{s.id === "house" ? "—" : `$${(earnings[s.id]?.unpaid ?? 0).toFixed(4)}`}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {s.id !== "house" && (
                    <>
                      {s.status === "pending" && <><button className="ghostButton" onClick={() => void act(s.id, "approve")}>{t("mkt.sellers.approve")}</button>{" "}<button className="ghostButton" onClick={() => void act(s.id, "reject")}>{t("mkt.sellers.reject")}</button>{" "}</>}
                      {s.status === "approved" && <><button className="ghostButton" onClick={() => void act(s.id, "suspend")}>{t("mkt.sellers.suspend")}</button>{" "}</>}
                      {s.status === "suspended" && <><button className="ghostButton" onClick={() => void act(s.id, "approve")}>{t("mkt.sellers.reactivate")}</button>{" "}</>}
                      <button className="ghostButton" onClick={() => setEditing({ id: s.id, commissionPct: s.commissionPct !== undefined ? String(s.commissionPct) : "", payoutRef: s.payoutRef ?? "" })}>{t("mkt.sellers.terms")}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {sellers.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 16 }}>{t("mkt.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modalOverlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modalContent" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader"><h2>{t("mkt.sellers.editTerms")}</h2></div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="formField"><span>{t("mkt.sellers.commissionPct")} (0–1)</span><input type="number" min="0" max="1" step="0.01" value={editing.commissionPct} onChange={(e) => setEditing({ ...editing, commissionPct: e.target.value })} /></label>
              <label className="formField"><span>{t("mkt.sellers.payoutRef")}</span><input value={editing.payoutRef} onChange={(e) => setEditing({ ...editing, payoutRef: e.target.value })} /></label>
              <small style={{ color: "var(--color-text-muted)" }}>{t("mkt.sellers.commissionNote")}</small>
            </div>
            <div className="routeModalFooter">
              <button className="ghostButton" onClick={() => setEditing(null)}>{t("mkt.cancel")}</button>
              <button className="primaryButton" onClick={() => void saveTerms()}>{t("mkt.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Listings ─────────────────────────────────────────────────────────────────
type Listing = {
  id: string;
  sellerId: string;
  baseModel: string;
  namespacedModel: string;
  costPrice: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
  providerInstanceId: string;
  providerAccountId: string;
  enabled: boolean;
};

function ListingsPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [listings, setListings] = useState<Listing[]>([]);
  const [reprice, setReprice] = useState<{ id: string; inputPerM: string; outputPerM: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ listings: Listing[] }>("/admin/v1/listings");
      setListings(res.listings);
    } catch (e) { show("err", errMsg(e)); }
  }, [api, show]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(l: Listing) {
    try {
      await api.patch(`/admin/v1/listings/${l.id}`, { enabled: !l.enabled });
      show("ok", t("mkt.saved"));
      await load();
    } catch (e) { show("err", errMsg(e)); }
  }
  async function remove(id: string) {
    if (!window.confirm(t("mkt.listings.confirmDelete"))) return;
    try { await api.delete(`/admin/v1/listings/${id}`); show("ok", t("mkt.deleted")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }
  async function saveReprice() {
    if (!reprice) return;
    try {
      await api.patch(`/admin/v1/listings/${reprice.id}`, { costPrice: { inputPerM: Number(reprice.inputPerM) || 0, outputPerM: Number(reprice.outputPerM) || 0 } });
      setReprice(null);
      show("ok", t("mkt.saved"));
      await load();
    } catch (e) { show("err", errMsg(e)); }
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.listings.title")}</h3>
      <div className="tableWrap" style={{ overflowX: "auto" }}>
        <table className="mktTable">
          <thead>
            <tr><th>{t("mkt.listings.model")}</th><th>{t("mkt.listings.seller")}</th><th>{t("mkt.listings.cost")}</th><th>{t("mkt.listings.account")}</th><th>{t("mkt.listings.enabled")}</th><th></th></tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} style={{ opacity: l.enabled ? 1 : 0.55 }}>
                <td><strong>{l.namespacedModel}</strong></td>
                <td>{l.sellerId}</td>
                <td style={{ fontSize: 12 }}>${l.costPrice.inputPerM}/M in · ${l.costPrice.outputPerM}/M out</td>
                <td style={{ fontSize: 12 }}>{l.providerInstanceId}/{l.providerAccountId}</td>
                <td>{l.enabled ? "✓" : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ghostButton" onClick={() => setReprice({ id: l.id, inputPerM: String(l.costPrice.inputPerM), outputPerM: String(l.costPrice.outputPerM) })}>{t("mkt.listings.reprice")}</button>{" "}
                  <button className="ghostButton" onClick={() => void toggle(l)}>{l.enabled ? t("mkt.listings.disable") : t("mkt.listings.enable")}</button>{" "}
                  <button className="ghostButton" onClick={() => void remove(l.id)}>{t("mkt.delete")}</button>
                </td>
              </tr>
            ))}
            {listings.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 16 }}>{t("mkt.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {reprice && (
        <div className="modalOverlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setReprice(null); }}>
          <div className="modalContent" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader"><h2>{t("mkt.listings.repriceTitle")}</h2></div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="formField"><span>{t("mkt.listings.inputPerM")}</span><input type="number" min="0" step="0.01" value={reprice.inputPerM} onChange={(e) => setReprice({ ...reprice, inputPerM: e.target.value })} /></label>
              <label className="formField"><span>{t("mkt.listings.outputPerM")}</span><input type="number" min="0" step="0.01" value={reprice.outputPerM} onChange={(e) => setReprice({ ...reprice, outputPerM: e.target.value })} /></label>
              <small style={{ color: "var(--color-text-muted)" }}>{t("mkt.listings.repriceNote")}</small>
            </div>
            <div className="routeModalFooter">
              <button className="ghostButton" onClick={() => setReprice(null)}>{t("mkt.cancel")}</button>
              <button className="primaryButton" onClick={() => void saveReprice()}>{t("mkt.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// PANELS_PLACEHOLDER_3

// ── Earnings & payouts ───────────────────────────────────────────────────────
function EarningsPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [sellerId, setSellerId] = useState("");
  const [snap, setSnap] = useState<EarningsSnapshot | null>(null);
  const [platform, setPlatform] = useState<number | null>(null);
  const [books, setBooks] = useState<{ totalCollected: number; totalSellerCredit: number; recordedMargin: number; expectedMargin: number; solvent: boolean; marginMatches: boolean; ok: boolean } | null>(null);
  const [action, setAction] = useState<{ kind: "markPaid" | "reverse"; amount: string; reason: string } | null>(null);
  const [settlementId, setSettlementId] = useState("");

  const loadPlatform = useCallback(async () => {
    try {
      const r = await api.get<{ platformMarginUsd: number }>("/admin/v1/earnings/platform");
      setPlatform(r.platformMarginUsd);
      setBooks(await api.get("/admin/v1/marketplace/reconcile/platform"));
    }
    catch (e) { show("err", errMsg(e)); }
  }, [api, show]);
  useEffect(() => { void loadPlatform(); }, [loadPlatform]);

  async function lookup() {
    if (!sellerId.trim()) return;
    try { setSnap(await api.get<EarningsSnapshot>(`/admin/v1/earnings/seller/${sellerId.trim()}`)); }
    catch (e) { show("err", errMsg(e)); }
  }

  async function runAction() {
    if (!action || !sellerId.trim()) return;
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || amount <= 0) { show("err", t("mkt.amountPositive")); return; }
    try {
      if (action.kind === "markPaid") await api.post(`/admin/v1/earnings/seller/${sellerId.trim()}/mark-paid`, { amountUsd: amount, payoutRef: action.reason || undefined });
      else await api.post(`/admin/v1/earnings/seller/${sellerId.trim()}/reverse`, { usd: amount, reason: action.reason || undefined });
      setAction(null);
      show("ok", t("mkt.saved"));
      await lookup();
    } catch (e) { show("err", errMsg(e)); }
  }

  async function reverseSettlement() {
    if (!settlementId.trim()) return;
    if (!window.confirm(t("mkt.earnings.confirmReverseSettlement"))) return;
    try {
      await api.post(`/admin/v1/settlements/${settlementId.trim()}/reverse`, { reason: "admin reversal" });
      setSettlementId("");
      show("ok", t("mkt.saved"));
    } catch (e) { show("err", errMsg(e)); }
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.earnings.title")}</h3>
      <div style={{ marginBottom: 16, fontSize: 14 }}>{t("mkt.earnings.platformMargin")}: <strong>${(platform ?? 0).toFixed(4)}</strong></div>

      {books && (
        <div className="tableWrap" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <strong>{t("mkt.books.title")}</strong>
            <span style={{ fontSize: 12, fontWeight: 700, color: books.ok ? "#059669" : "#ef4444" }}>
              {books.ok ? `✓ ${t("mkt.books.ok")}` : `✗ ${t("mkt.books.violation")}`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 13, flexWrap: "wrap", color: "var(--color-text-muted)" }}>
            <div>{t("mkt.books.collected")}: <strong>${books.totalCollected.toFixed(4)}</strong></div>
            <div>{t("mkt.books.sellerCredit")}: <strong>${books.totalSellerCredit.toFixed(4)}</strong></div>
            <div>{t("mkt.books.margin")}: <strong>${books.recordedMargin.toFixed(4)}</strong> / ${books.expectedMargin.toFixed(4)}</div>
            <div>{t("mkt.books.solvent")}: {books.solvent ? "✓" : "✗"}</div>
            <div>{t("mkt.books.marginMatch")}: {books.marginMatches ? "✓" : "✗"}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
        <label className="formField" style={{ flex: 1 }}><span>{t("mkt.earnings.sellerId")}</span><input value={sellerId} onChange={(e) => setSellerId(e.target.value)} /></label>
        <button className="primaryButton" onClick={() => void lookup()}>{t("mkt.earnings.lookup")}</button>
      </div>

      {snap && (
        <div className="tableWrap" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 24, fontSize: 14, flexWrap: "wrap" }}>
            <div>{t("mkt.earnings.day")}: <strong>${snap.day.toFixed(4)}</strong></div>
            <div>{t("mkt.earnings.month")}: <strong>${snap.month.toFixed(4)}</strong></div>
            <div>{t("mkt.earnings.lifetime")}: <strong>${snap.lifetime.toFixed(4)}</strong></div>
            <div>{t("mkt.earnings.unpaid")}: <strong>${snap.unpaid.toFixed(4)}</strong></div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="ghostButton" onClick={() => setAction({ kind: "markPaid", amount: "", reason: "" })}>{t("mkt.earnings.markPaid")}</button>
            <button className="dangerButton" onClick={() => setAction({ kind: "reverse", amount: "", reason: "" })}>{t("mkt.earnings.reversePayout")}</button>
          </div>
        </div>
      )}

      <div className="tableWrap" style={{ padding: 16 }}>
        <h4 style={{ marginTop: 0 }}>{t("mkt.earnings.reverseSettlement")}</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="formField" style={{ flex: 1 }}><span>{t("mkt.earnings.settlementId")}</span><input value={settlementId} onChange={(e) => setSettlementId(e.target.value)} placeholder="stl_..." /></label>
          <button className="dangerButton" onClick={() => void reverseSettlement()}>{t("mkt.earnings.reverse")}</button>
        </div>
      </div>

      {action && (
        <div className="modalOverlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setAction(null); }}>
          <div className="modalContent" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader"><h2>{action.kind === "markPaid" ? t("mkt.earnings.markPaid") : t("mkt.earnings.reversePayout")}</h2></div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="formField"><span>{t("mkt.amountUsd")}</span><input type="number" min="0" step="0.01" value={action.amount} onChange={(e) => setAction({ ...action, amount: e.target.value })} autoFocus /></label>
              <label className="formField"><span>{action.kind === "markPaid" ? t("mkt.earnings.payoutRef") : t("mkt.reason")}</span><input value={action.reason} onChange={(e) => setAction({ ...action, reason: e.target.value })} /></label>
            </div>
            <div className="routeModalFooter">
              <button className="ghostButton" onClick={() => setAction(null)}>{t("mkt.cancel")}</button>
              <button className={action.kind === "reverse" ? "dangerButton" : "primaryButton"} onClick={() => void runAction()}>{t("mkt.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wallets ──────────────────────────────────────────────────────────────────
function WalletsPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [keyId, setKeyId] = useState("");
  const [wallet, setWallet] = useState<{ id: string; walletUsd: number; provisioned: boolean } | null>(null);
  const [action, setAction] = useState<{ kind: "topup" | "refund" | "debit"; amount: string; reason: string } | null>(null);

  async function lookup() {
    if (!keyId.trim()) return;
    try { setWallet(await api.get(`/admin/v1/api-keys/${keyId.trim()}/wallet`)); }
    catch (e) { show("err", errMsg(e)); }
  }

  async function runAction() {
    if (!action || !keyId.trim()) return;
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || amount <= 0) { show("err", t("mkt.amountPositive")); return; }
    const id = keyId.trim();
    try {
      if (action.kind === "topup") await api.post(`/admin/v1/api-keys/${id}/topup`, { amountUsd: amount });
      else if (action.kind === "refund") await api.post(`/admin/v1/api-keys/${id}/wallet/refund`, { usd: amount, reason: action.reason || undefined });
      else await api.post(`/admin/v1/api-keys/${id}/wallet/debit`, { usd: amount, reason: action.reason || undefined });
      setAction(null);
      show("ok", t("mkt.saved"));
      await lookup();
    } catch (e) { show("err", errMsg(e)); }
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.wallets.title")}</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
        <label className="formField" style={{ flex: 1 }}><span>{t("mkt.wallets.keyId")}</span><input value={keyId} onChange={(e) => setKeyId(e.target.value)} /></label>
        <button className="primaryButton" onClick={() => void lookup()}>{t("mkt.wallets.lookup")}</button>
      </div>

      {wallet && (
        <div className="tableWrap" style={{ padding: 16 }}>
          <div style={{ fontSize: 14 }}>{t("mkt.wallets.balance")}: <strong>{wallet.provisioned ? `$${wallet.walletUsd.toFixed(4)}` : t("mkt.wallets.noWallet")}</strong></div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="ghostButton" onClick={() => setAction({ kind: "topup", amount: "", reason: "" })}>{t("mkt.wallets.topup")}</button>
            <button className="ghostButton" onClick={() => setAction({ kind: "refund", amount: "", reason: "" })}>{t("mkt.wallets.refund")}</button>
            <button className="dangerButton" onClick={() => setAction({ kind: "debit", amount: "", reason: "" })}>{t("mkt.wallets.debit")}</button>
          </div>
        </div>
      )}

      {action && (
        <div className="modalOverlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setAction(null); }}>
          <div className="modalContent" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader"><h2>{t(`mkt.wallets.${action.kind}`)}</h2></div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="formField"><span>{t("mkt.amountUsd")}</span><input type="number" min="0" step="0.01" value={action.amount} onChange={(e) => setAction({ ...action, amount: e.target.value })} autoFocus /></label>
              {action.kind !== "topup" && <label className="formField"><span>{t("mkt.reason")}</span><input value={action.reason} onChange={(e) => setAction({ ...action, reason: e.target.value })} /></label>}
            </div>
            <div className="routeModalFooter">
              <button className="ghostButton" onClick={() => setAction(null)}>{t("mkt.cancel")}</button>
              <button className={action.kind === "debit" ? "dangerButton" : "primaryButton"} onClick={() => void runAction()}>{t("mkt.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// PANELS_PLACEHOLDER_4

// ── Markup ───────────────────────────────────────────────────────────────────
function MarkupPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [defaultMarkup, setDefaultMarkup] = useState("0.15");
  const [perModel, setPerModel] = useState<Record<string, number>>({});
  const [newModel, setNewModel] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ defaultMarkup: number; perModel: Record<string, number> }>("/admin/v1/markup");
      setDefaultMarkup(String(r.defaultMarkup));
      setPerModel(r.perModel ?? {});
    } catch (e) { show("err", errMsg(e)); }
  }, [api, show]);
  useEffect(() => { void load(); }, [load]);

  async function saveDefault() {
    try { await api.put("/admin/v1/markup", { defaultMarkup: Number(defaultMarkup) || 0 }); show("ok", t("mkt.saved")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }
  async function addOverride() {
    if (!newModel.trim()) return;
    try { await api.put("/admin/v1/markup", { perModel: { [newModel.trim()]: Number(newValue) || 0 } }); setNewModel(""); setNewValue(""); show("ok", t("mkt.saved")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }
  async function removeOverride(model: string) {
    try { await api.put("/admin/v1/markup", { perModel: { [model]: null } }); show("ok", t("mkt.deleted")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.markup.title")}</h3>
      <div className="tableWrap" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="formField" style={{ flex: 1 }}><span>{t("mkt.markup.default")}</span><input type="number" min="0" step="0.01" value={defaultMarkup} onChange={(e) => setDefaultMarkup(e.target.value)} /></label>
          <button className="primaryButton" onClick={() => void saveDefault()}>{t("mkt.save")}</button>
        </div>
        <small style={{ color: "var(--color-text-muted)" }}>{t("mkt.markup.note")}</small>
      </div>

      <div className="tableWrap" style={{ overflowX: "auto" }}>
        <table className="mktTable">
          <thead><tr><th>{t("mkt.markup.model")}</th><th>{t("mkt.markup.value")}</th><th></th></tr></thead>
          <tbody>
            {Object.entries(perModel).map(([m, v]) => (
              <tr key={m}><td>{m}</td><td>{v}</td><td style={{ textAlign: "right" }}><button className="ghostButton" onClick={() => void removeOverride(m)}>{t("mkt.markup.remove")}</button></td></tr>
            ))}
            {Object.keys(perModel).length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 12 }}>{t("mkt.markup.noOverrides")}</td></tr>}
            <tr>
              <td><input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="gpt-5.5" style={{ width: "100%" }} /></td>
              <td><input type="number" min="0" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="0.25" style={{ width: 100 }} /></td>
              <td style={{ textAlign: "right" }}><button className="ghostButton" onClick={() => void addOverride()}>{t("mkt.markup.add")}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Canonical models ─────────────────────────────────────────────────────────
function CanonicalPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [models, setModels] = useState<string[]>([]);
  const [newModel, setNewModel] = useState("");

  const load = useCallback(async () => {
    try { const r = await api.get<{ models: string[] }>("/admin/v1/canonical-models"); setModels(r.models); }
    catch (e) { show("err", errMsg(e)); }
  }, [api, show]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!newModel.trim()) return;
    try { await api.post("/admin/v1/canonical-models", { model: newModel.trim() }); setNewModel(""); show("ok", t("mkt.saved")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }
  async function remove(model: string) {
    try { await api.delete(`/admin/v1/canonical-models/${encodeURIComponent(model)}`); show("ok", t("mkt.deleted")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.canonical.title")}</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
        <label className="formField" style={{ flex: 1 }}><span>{t("mkt.canonical.newModel")}</span><input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="grok-3" /></label>
        <button className="primaryButton" onClick={() => void add()}>{t("mkt.canonical.add")}</button>
      </div>
      <div className="tableWrap" style={{ overflowX: "auto" }}>
        <table className="mktTable">
          <thead><tr><th>{t("mkt.canonical.model")}</th><th></th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m}><td>{m}</td><td style={{ textAlign: "right" }}><button className="ghostButton" onClick={() => void remove(m)}>{t("mkt.delete")}</button></td></tr>
            ))}
            {models.length === 0 && <tr><td colSpan={2} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 12 }}>{t("mkt.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <small style={{ color: "var(--color-text-muted)" }}>{t("mkt.canonical.note")}</small>
    </div>
  );
}

// ── Business webhook ─────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = ["usage.recorded", "grant.exhausted", "wallet.low", "quota.blocked", "supply.unhealthy"] as const;

function WebhookPanel({ api }: { api: ApiClient }) {
  const { t } = useLang();
  const { node: flash, show } = useFlash();
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secretSet, setSecretSet] = useState(false);
  const [newSecret, setNewSecret] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ enabled: boolean; url: string; events: string[]; secretSet: boolean }>("/admin/v1/business-webhook");
      setEnabled(r.enabled); setUrl(r.url); setEvents(r.events ?? []); setSecretSet(r.secretSet);
    } catch (e) { show("err", errMsg(e)); }
  }, [api, show]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const body: Record<string, unknown> = { enabled, url, events };
    if (newSecret.trim()) body.secret = newSecret.trim(); // only send on explicit change
    try { await api.put("/admin/v1/business-webhook", body); setNewSecret(""); show("ok", t("mkt.saved")); await load(); }
    catch (e) { show("err", errMsg(e)); }
  }
  function toggleEvent(ev: string) {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  }

  return (
    <div>
      {flash}
      <h3 style={{ marginBottom: 12 }}>{t("mkt.webhook.title")}</h3>
      <div className="tableWrap" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t("mkt.webhook.enabled")}
        </label>
        <label className="formField"><span>{t("mkt.webhook.url")}</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></label>
        <label className="formField">
          <span>{t("mkt.webhook.secret")} {secretSet && <em style={{ color: "var(--color-text-muted)" }}>({t("mkt.webhook.secretSet")})</em>}</span>
          <input type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder={secretSet ? "••••••••" : t("mkt.webhook.secretPlaceholder")} />
        </label>
        <div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>{t("mkt.webhook.events")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />{ev}
              </label>
            ))}
          </div>
        </div>
        <div><button className="primaryButton" onClick={() => void save()}>{t("mkt.save")}</button></div>
      </div>
    </div>
  );
}

