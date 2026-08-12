import { setRequestLocale, getTranslations } from "next-intl/server";
import { Layers, Power, Activity, Wallet, Boxes } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { ListingRow, type MyListing } from "./listing-row";
import { AddModelPanel } from "./add-model-panel";
import { xrouter } from "@/lib/xrouter/adapter";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";

export const dynamic = "force-dynamic";

function providerOf(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("sonnet") || m.includes("opus") || m.includes("haiku")) return "Anthropic";
  if (m.includes("gpt") || m.includes("codex")) return "OpenAI";
  if (m.includes("gemini")) return "Google";
  if (m.includes("deepseek")) return "DeepSeek";
  if (m.includes("mistral")) return "Mistral";
  return model.slice(0, 2).toUpperCase();
}

export default async function ConsoleModels({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("modelsPage");

  // Live listings for the current user's seller. Only a registered seller sees
  // listings, and only their OWN — never fall back to showing everyone else's.
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  const mine = acct?.sellerId
    ? (await xrouter.listListings()).filter((l) => l.sellerId === acct.sellerId)
    : [];

  const isApprovedSeller = acct?.sellerId != null && acct.sellerStatus === "approved";

  // Dropdown data for the "Add model" form (only needed for approved sellers).
  let canonical: string[] = [];
  let instanceOpts: { id: string; name: string; type: string }[] = [];
  let accountOpts: { id: string; providerInstanceId: string; displayName: string; status: string }[] = [];
  if (isApprovedSeller) {
    const [canon, instances, accounts] = await Promise.all([
      xrouter.listCanonicalModels(),
      xrouter.listProviderInstances(),
      xrouter.listProviderAccounts(),
    ]);
    canonical = canon;
    instanceOpts = instances.filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name, type: i.type }));
    accountOpts = accounts.map((a) => ({
      id: a.id,
      providerInstanceId: a.providerInstanceId,
      displayName: a.displayName,
      status: a.status,
    }));
  }

  const listings: MyListing[] = mine.map((l) => ({
    id: l.id,
    model: l.baseModel,
    namespaced: l.namespacedModel,
    provider: providerOf(l.baseModel),
    inputPerM: `$${l.costPrice.inputPerM}`,
    outputPerM: `$${l.costPrice.outputPerM}`,
    enabled: l.enabled,
    requests: "—",
  }));

  const stats = [
    { icon: Layers, value: String(listings.length), label: t("totalListings") },
    { icon: Power, value: String(listings.filter((l) => l.enabled).length), label: t("activeListings") },
    { icon: Activity, value: "—", label: t("totalRequests") },
    { icon: Wallet, value: "$0.00", label: t("earnings") },
  ];

  const rowLabels = {
    active: t("active"),
    disabled: t("disabled"),
    enable: t("enable"),
    disable: t("disable"),
    delete: t("delete"),
    pricing: t("pricing"),
    requests: t("requests"),
  };

  const addLabels = {
    addModel: t("addModel"),
    cancel: t("cancel"),
    notSeller: t("notSeller"),
    title: t("listingTitle"),
    model: t("listingModel"),
    inputPrice: t("listingInput"),
    outputPrice: t("listingOutput"),
    instance: t("listingInstance"),
    account: t("listingAccount"),
    create: t("listingCreateBtn"),
    created: t("listingCreated"),
    noAccounts: t("listingNoAccounts"),
  };

  return (
    <div className="mx-auto max-w-5xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      <div className="mb-6">
        <AddModelPanel
          isApprovedSeller={isApprovedSeller}
          canonicalModels={canonical}
          instances={instanceOpts}
          accounts={accountOpts}
          labels={addLabels}
        />
      </div>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary">
            <Boxes className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-lg font-semibold">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            {t("emptyHint")}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-5">
                <s.icon className="mb-2 h-4 w-4 text-muted-foreground" />
                <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {listings.map((l) => (
              <ListingRow key={l.id} listing={l} labels={rowLabels} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
