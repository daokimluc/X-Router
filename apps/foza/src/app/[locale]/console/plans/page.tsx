import { setRequestLocale, getTranslations } from "next-intl/server";
import { CreditCard, Boxes, Wallet, Layers, Clock, CalendarDays, CalendarRange } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { SubscribeButton } from "./subscribe-button";
import { ActivePlanPanel } from "./active-plan-panel";
import { xrouter } from "@/lib/xrouter/adapter";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { ledger } from "@/lib/xrouter/ledger";
import { PLANS } from "@/lib/data";

// Plan catalog comes from X-Router /provision/plans (live) when enabled,
// merged with local presentation fields (desc, model chips, featured).
export const dynamic = "force-dynamic";

/**
 * Rolling-window start timestamps (ISO) for quota usage, computed once per
 * request. Isolated at module scope so the render body stays pure (no `Date.now`
 * call during render — same pattern as usage/page.tsx's daysAgoIso).
 */
function windowStarts(): { hourAgoIso: string; dayAgoIso: string } {
  const now = Date.now();
  return {
    hourAgoIso: new Date(now - 60 * 60 * 1000).toISOString(),
    dayAgoIso: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function ConsolePlans({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("planPage");

  // Authoritative plan catalog (price + quota buckets) from the gateway.
  const livePlans = await xrouter.listPlans();
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const fmtBucket = (n: number) => `${n} USD`;

  // Merge: gateway is source of truth for price/quota AND model coverage. Prefer
  // the expanded `lp.models` (X-Router v0.4.4+, the concrete models the plan
  // grants); fall back to `lp.modelGroups` (older gateways) then the curated
  // local list. Local PLANS only supplies presentation (description, featured).
  const plans = livePlans.map((lp) => {
    const local = PLANS.find((p) => p.id === lp.id || p.name === lp.name);

    // `["*"]` → grant-all, render a friendly label. An expanded list → show the
    // real models. Empty/missing → fall back to modelGroups, then local chips.
    const expanded = lp.models ?? lp.modelGroups ?? [];
    const isWildcard = expanded.includes("*");
    let models: string[];
    let totalModels: number;
    if (isWildcard) {
      models = [t("allModels")];
      totalModels = 1;
    } else if (expanded.length > 0) {
      models = expanded;
      totalModels = expanded.length;
    } else {
      models = local?.models ?? [];
      totalModels = local?.totalModels ?? local?.models.length ?? 0;
    }

    return {
      id: lp.id,
      name: lp.name,
      desc: local?.desc ?? "",
      priceUsd: usd(lp.priceUsd),
      hourUsd: fmtBucket(lp.buckets.hourUsd),
      dayUsd: fmtBucket(lp.buckets.dayUsd),
      monthUsd: fmtBucket(lp.buckets.monthUsd),
      models,
      totalModels,
      featured: local?.featured ?? false,
      buckets: lp.buckets,
    };
  });

  // Resolve the current user's active plan grant. Trust the GATEWAY's planId
  // (from getWallet) as the source of truth, not the local store: a renewal
  // underfunded → plan.downgraded leaves the local mirror stale, which would
  // otherwise show a "ghost plan" the user no longer has (subscribed badge +
  // full quota). The local store is only a cache; the gateway decides.
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  let walletUsd = 0;
  let planPeriodEnd: number | null = null;
  let planChargedAt: number | null = null;
  let activePlanId: string | null = null;
  if (acct) {
    const w = await xrouter.getWallet(acct.keyId);
    walletUsd = w.walletUsd;
    planPeriodEnd = w.planPeriodEnd ?? null;
    planChargedAt = w.planChargedAt ?? null;
    // Prefer the gateway's planId; fall back to the local mirror only when the
    // gateway omits it (older gateway that doesn't return planId on the wallet).
    activePlanId = w.planId !== undefined ? w.planId : (acct.planId ?? null);
  }
  const activeDef = activePlanId ? plans.find((p) => p.id === activePlanId) : null;
  let activePlan = null;
  if (activeDef && acct) {
    // Period-scoped usage: spend since the plan was last charged (the start of
    // the current billing period), not lifetime — otherwise "this period" climbs
    // forever past the monthUsd cap. Hour/day windows are rolling from now.
    const monthStartIso =
      planChargedAt != null ? new Date(planChargedAt).toISOString() : null;
    const { hourAgoIso, dayAgoIso } = windowStarts();
    const monthUsed = ledger.spendUsdForKeySince(acct.keyId, monthStartIso);
    const hourUsed = ledger.spendUsdForKeySince(acct.keyId, hourAgoIso);
    const dayUsed = ledger.spendUsdForKeySince(acct.keyId, dayAgoIso);
    // Renewal date from the live period end (epoch-ms). Fall back to a generic
    // label when there's no cycle yet (e.g. grandfathered key).
    const renewLabel =
      planPeriodEnd != null
        ? t("renewsOn", {
            date: new Date(planPeriodEnd).toLocaleDateString(
              locale === "vi" ? "vi-VN" : "en-US",
            ),
          })
        : t("expiresIn", { date: "—", days: 30 });
    activePlan = {
      name: activeDef.name,
      overageEnabled: acct.overageEnabled,
      expiresLabel: renewLabel,
      quota: {
        hour: { used: Number(hourUsed.toFixed(2)), cap: activeDef.buckets.hourUsd },
        day: { used: Number(dayUsed.toFixed(2)), cap: activeDef.buckets.dayUsd },
        month: { used: Number(monthUsed.toFixed(2)), cap: activeDef.buckets.monthUsd },
      },
    };
  }

  const totalModels = new Set(plans.flatMap((p) => p.models)).size;
  const stats = [
    { icon: Layers, value: String(plans.length), label: t("availablePlans") },
    { icon: Boxes, value: String(totalModels), label: t("includedModels") },
    { icon: Wallet, value: usd(walletUsd), label: t("walletBalance") },
    {
      icon: CreditCard,
      value: activeDef?.name ?? t("noPlan"),
      label: t("currentPlan"),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      {/* stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-muted/25 p-4">
            <s.icon className="mb-2 h-4 w-4 text-muted-foreground" />
            <p className="truncate text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {activePlan && (
        <ActivePlanPanel
          plan={activePlan}
          labels={{
            active: t("activeStatus"),
            overageOn: t("overageOn"),
            allowOverage: t("allowOverage"),
            cancel: t("cancelPlan"),
            usageThisPeriod: t("usageThisPeriod"),
            hourly: t("hourly"),
            daily: t("daily"),
            monthly: t("monthly"),
          }}
        />
      )}

      {/* plan cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.id}
            className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
          >
            {p.featured && <div className="h-1 bg-primary" />}
            <div className="flex h-full flex-col">
              <div className="border-b border-border bg-card px-5 py-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-foreground">
                      {p.name}
                    </h2>
                    <p className="mt-1 line-clamp-3 min-h-14 text-sm text-muted-foreground">
                      {p.desc}
                    </p>
                  </div>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {p.priceUsd}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">
                    / {t("month")}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  {t("quota")}
                </p>
                <div className="space-y-2 text-sm">
                  <QuotaRow icon={Clock} label={t("hourly")} value={p.hourUsd} />
                  <QuotaRow icon={CalendarDays} label={t("daily")} value={p.dayUsd} />
                  <QuotaRow icon={CalendarRange} label={t("monthly")} value={p.monthUsd} />
                </div>

                <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">
                  {t("includedModelsShort", { n: p.totalModels })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.models.map((m) => (
                    <span
                      key={m}
                      className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {m}
                    </span>
                  ))}
                  {p.totalModels > p.models.length && (
                    <span className="rounded-md px-2 py-0.5 text-[11px] font-medium text-primary">
                      {t("showAll", { n: p.totalModels })}
                    </span>
                  )}
                </div>

                <SubscribeButton
                  planId={p.id}
                  planName={p.name}
                  priceLabel={`${p.priceUsd} / ${t("month")}`}
                  walletLabel={`${t("walletBalance")}: ${usd(walletUsd)}`}
                  isActive={p.id === activePlanId}
                  currentPlanName={activeDef && activeDef.id !== p.id ? activeDef.name : null}
                  labels={{
                    subscribe: t("subscribe"),
                    subscribed: t("subscribed"),
                    switchTo: t("switchTo"),
                    // Raw template — the client fills {plan} (which plan you're
                    // switching from). Calling t() here throws on the missing var.
                    switchWarning: t.raw("switchWarning"),
                    confirmTitle: t("confirmTitle"),
                    switchConfirmTitle: t("switchConfirmTitle"),
                    allowOverage: t("allowOverage"),
                    overageDesc: t("overageDesc"),
                    cancel: t("cancelModal"),
                    confirm: t("confirm"),
                    confirmSwitch: t("confirmSwitch"),
                    topUp: t("topUp"),
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuotaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
