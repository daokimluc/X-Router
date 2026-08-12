import { setRequestLocale, getTranslations } from "next-intl/server";
import { Search, BadgeCheck, Activity, CheckCircle2, Coins, Box, Timer, Gauge } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { ProviderLogo } from "@/components/brand/brand-logo";
import { SubscribeButton } from "./subscribe-button";
import { BuyPackButton } from "./buy-pack-button";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";
import { contextWindowFor } from "@/lib/model-context";
import { LISTINGS } from "@/lib/data";

// Live listings + per-listing metrics come from X-Router /provision/*. Metrics
// carry three different time horizons (settlement window / lifetime / 5-min);
// we label them and show "—" for any null source rather than faking a number.
export const dynamic = "force-dynamic";

/** Compact number label: 1234 → "1.2K", 2_500_000 → "2.5M". */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Card view model — successPct is null when the gateway has no lifetime data. */
type CardView = {
  model: string;
  seller: string;
  verified: boolean;
  namespaced: string;
  category: string;
  family: string;
  inputPerM: string;
  outputPerM: string;
  minCost: string;
  requests: string;
  successPct: number | null;
  tokens: string;
  context: string;
  latency: string;
  rps: string;
  sellOutputPerM: number;
};

function familyOf(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("sonnet") || m.includes("opus") || m.includes("haiku")) return "Claude";
  if (m.includes("gpt") || m.includes("codex") || m.startsWith("o3") || m.startsWith("o4")) return "GPT";
  if (m.includes("gemini")) return "Gemini";
  if (m.includes("deepseek")) return "DeepSeek";
  if (m.includes("mistral")) return "Mistral";
  if (m.includes("qwen")) return "Qwen";
  return "—";
}

export default async function ConsoleMarketplace({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("market");

  // Live listings + metrics + markup from the gateway, fetched together.
  const [live, metrics, markup] = await Promise.all([
    xrouter.listListings(),
    xrouter.listListingsMetrics(),
    xrouter.getMarkup(),
  ]);
  const metricById = new Map(metrics.map((m) => [m.listingId, m]));
  // Sell price = wholesale cost × (1 + markup). Used to price token packs by
  // the OUTPUT rate (conservative — the platform never loses on a pack).
  const markupMult = 1 + (markup.defaultMarkup ?? 0);

  const reqPerMin = t("reqPerMin");
  const listings: CardView[] = live.map((sl) => {
    const local = LISTINGS.find((x) => x.namespaced === sl.namespacedModel);
    const m = metricById.get(sl.id);

    // Pricing/presentation: prefer the curated local entry, else derive.
    const seller = local?.seller ?? sl.sellerId.replace(/^seller_/, "");
    const family = local?.family ?? familyOf(sl.baseModel);

    // Success: LIFETIME per account. null → "—" (never fake 100%).
    const successPct =
      m?.successRate != null ? Math.round(m.successRate * 1000) / 10 : null;

    // RPS is tiny for marketplace traffic — show req/min for readability.
    const rps =
      m?.rps != null ? `${(m.rps * 60).toFixed(1)} ${reqPerMin}` : "—";

    return {
      model: sl.baseModel,
      seller,
      verified: sl.enabled,
      namespaced: sl.namespacedModel,
      category: local?.category ?? "text",
      family,
      inputPerM: local?.inputPerM ?? `$${sl.costPrice.inputPerM}`,
      outputPerM: local?.outputPerM ?? `$${sl.costPrice.outputPerM}`,
      minCost: local?.minCost ?? "—",
      requests: m && m.requests > 0 ? fmtNum(m.requests) : "—",
      successPct,
      tokens: m && m.totalTokens > 0 ? fmtNum(m.totalTokens) : "—",
      context: contextWindowFor(sl.baseModel) ?? "—",
      latency: m?.latencyP50Ms != null ? `${m.latencyP50Ms}ms` : "—",
      rps,
      // Sell price per 1M OUTPUT tokens (USD) — token-pack pricing basis.
      sellOutputPerM: sl.costPrice.outputPerM * markupMult,
    };
  });

  // Existing keys for the "add to existing key" option in the subscribe modal.
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  const keyOptions = (acct?.keys ?? []).map((k) => ({ keyId: k.keyId, label: k.label }));
  const subLabels = {
    subscribe: t("subscribe"),
    subscribed: t("subscribed"),
    modalTitle: t("modalTitle"),
    addExisting: t("addExisting"),
    createNew: t("createNew"),
    chooseKey: t("chooseKey"),
    keyName: t("keyName"),
    cancel: t("cancel"),
  };
  const packLabels = {
    buyPack: t("buyPack"),
    buyPackTitle: t("buyPackTitle"),
    packSize: t("packSize"),
    tokens: t("packTokens"),
    continue: t("packContinue"),
    cancel: t("cancel"),
    checking: t("packChecking"),
    scanQr: t("packScanQr"),
    account: t("packAccount"),
    bank: t("packBank"),
    amount: t("packAmount"),
    transferNote: t("packTransferNote"),
    packCredited: t("packCredited"),
    close: t("packClose"),
  };

  return (
    <div className="mx-auto max-w-6xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12.5rem] max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder={t("search")}
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <FilterChip label={t("allFamilies")} />
        <FilterChip label={t("allCategories")} />
        <FilterChip label={t("mostRequests")} />
      </div>

      {/* Listing grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((l) => (
          <div
            key={l.namespaced}
            className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
          >
            <div className="h-1 bg-primary/70" />
            <div className="flex flex-1 flex-col gap-4 p-5">
              {/* header */}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground [&_svg]:h-[18px] [&_svg]:w-[18px]">
                  <ProviderLogo provider={familyToProvider(l.family)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                    {l.model}
                  </p>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs text-muted-foreground">
                      {l.namespaced}
                    </span>
                    {l.verified && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-medium text-success">
                        <BadgeCheck className="h-3 w-3" />
                        {t("verified")}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip>{l.seller}</Chip>
                    <Chip>{l.category}</Chip>
                    <Chip>{l.family}</Chip>
                  </div>
                </div>
              </div>

              {/* pricing box */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">{t("tokenPricing")}</p>
                  <span className="text-[11px] text-muted-foreground">
                    {t("min")} {l.minCost}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PriceCell label={t("input")} value={l.inputPerM} />
                  <PriceCell label={t("output")} value={l.outputPerM} />
                </div>
              </div>

              {/* metrics — labels carry their time horizon; null shows "—" */}
              <div className="grid grid-cols-2 gap-2">
                <Metric icon={Activity} label={t("requests")} value={l.requests} />
                <Metric
                  icon={CheckCircle2}
                  label={t("success")}
                  value={l.successPct != null ? `${l.successPct}%` : "—"}
                  title={l.successPct != null ? t("successHint") : undefined}
                  tone={l.successPct == null ? undefined : l.successPct < 70 ? "bad" : "good"}
                />
                <Metric icon={Coins} label={t("tokens")} value={l.tokens} />
                <Metric icon={Box} label={t("context")} value={l.context} />
                <Metric
                  icon={Timer}
                  label={t("latency")}
                  value={l.latency}
                  title={l.latency !== "—" ? t("latencyHint") : undefined}
                />
                <Metric
                  icon={Gauge}
                  label={t("rps")}
                  value={l.rps}
                  title={l.rps !== "—" ? t("latencyHint") : undefined}
                />
              </div>

              <SubscribeButton model={l.namespaced} keys={keyOptions} labels={subLabels} />
              <BuyPackButton
                baseModel={l.model}
                sellOutputPerM={l.sellOutputPerM}
                labels={packLabels}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function familyToProvider(family: string): string {
  const map: Record<string, string> = {
    GPT: "OpenAI",
    Claude: "Anthropic",
    Gemini: "Google",
    DeepSeek: "DeepSeek",
    Mistral: "Mistral",
  };
  return map[family] ?? family;
}

function FilterChip({ label }: { label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40">
      {label}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/70 px-3 py-2">
      <p className="mb-1 text-[10px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold leading-none text-foreground">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">/M</span>
      </p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "good" | "bad";
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2" title={title}>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <span
        className={`block truncate text-xs font-semibold ${tone === "bad" ? "text-destructive" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
