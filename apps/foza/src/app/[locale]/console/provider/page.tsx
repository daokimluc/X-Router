import { setRequestLocale, getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { ProviderForm } from "./provider-form";
import { ListingEditor } from "./listing-editor";
import { ledger } from "@/lib/xrouter/ledger";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";

// Reads runtime ledger state (supply.unhealthy events) — render per request.
export const dynamic = "force-dynamic";

export default async function ConsoleProvider({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("providerPage");
  const c = await getTranslations("console");
  const unhealthy = ledger.listUnhealthy();

  // If the user is an approved seller, let them list their own supply.
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  const isApprovedSeller = acct?.sellerId != null && acct.sellerStatus === "approved";

  let canonical: string[] = [];
  let instanceOpts: { id: string; name: string; type: string }[] = [];
  let accountOpts: { id: string; providerInstanceId: string; displayName: string; status: string }[] = [];
  let myListings: { id: string; namespacedModel: string; enabled: boolean }[] = [];
  if (isApprovedSeller) {
    const [canon, instances, accounts, listings] = await Promise.all([
      xrouter.listCanonicalModels(),
      xrouter.listProviderInstances(),
      xrouter.listProviderAccounts(),
      xrouter.listListings(),
    ]);
    canonical = canon;
    instanceOpts = instances.filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name, type: i.type }));
    accountOpts = accounts.map((a) => ({
      id: a.id,
      providerInstanceId: a.providerInstanceId,
      displayName: a.displayName,
      status: a.status,
    }));
    myListings = listings
      .filter((l) => l.sellerId === acct!.sellerId)
      .map((l) => ({ id: l.id, namespacedModel: l.namespacedModel, enabled: l.enabled }));
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ConsolePageHeader title={c("provider")} description={t("subtitle")} />

      {unhealthy.length > 0 && (
        <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {c("supplyUnhealthy")}
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {unhealthy.map((u) => (
              <li key={u.sellerId + u.providerAccountId}>
                <span className="font-medium text-foreground">{u.sellerId}</span> ·{" "}
                {u.providerAccountId} — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isApprovedSeller ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
            <span className="font-medium text-foreground">{t("approvedSeller")}</span>{" "}
            <code className="font-mono text-xs text-muted-foreground">{acct!.sellerId}</code>
          </div>
          {myListings.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {myListings.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="font-mono text-sm text-foreground">{l.namespacedModel}</span>
                  <span className={`text-xs ${l.enabled ? "text-success" : "text-muted-foreground"}`}>
                    {l.enabled ? t("listingEnabled") : t("listingDisabled")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ListingEditor
            source="seller"
            canonicalModels={canonical}
            instances={instanceOpts}
            accounts={accountOpts}
            labels={{
              title: t("listingCreate"),
              model: t("listingModel"),
              inputPrice: t("listingInput"),
              outputPrice: t("listingOutput"),
              instance: t("listingInstance"),
              account: t("listingAccount"),
              create: t("listingCreateBtn"),
              created: t("listingCreated"),
              noAccounts: t("listingNoAccounts"),
            }}
          />
        </div>
      ) : (
        <ProviderForm
          labels={{
            registerTitle: t("registerTitle"),
            displayName: t("displayName"),
            slug: t("slug"),
            slugHint: t("slugHint"),
            email: t("email"),
            telegram: t("telegram"),
            description: t("description"),
            optional: t("optional"),
            agree: t("agree"),
            terms: t("terms"),
            submit: t("submit"),
            submitted: t("submitted"),
            sellerId: t("sellerId"),
          }}
        />
      )}
    </div>
  );
}
