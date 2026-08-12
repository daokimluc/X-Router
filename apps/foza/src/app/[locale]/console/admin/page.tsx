import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ShieldCheck, TrendingUp, Layers, ListChecks, Store, Users } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { canModerate, hasPermission } from "@/lib/xrouter/admin";
import { currentRole } from "@/lib/roles";
import { listStaff } from "@/lib/users";
import { xrouter } from "@/lib/xrouter/adapter";
import {
  SellerRow,
  MarkupForm,
  WebhookForm,
  PlanEditor,
  CanonicalManager,
  RoleManager,
} from "./admin-controls";
import { ListingEditor } from "../provider/listing-editor";

export const dynamic = "force-dynamic";

export default async function ConsoleAdmin({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Moderator+ may reach the page; sections render per-permission below.
  if (!(await canModerate())) notFound();

  const [cur, canPlans, canCatalog, canMoney, canRoles] = await Promise.all([
    currentRole(),
    hasPermission("managePlans"),
    hasPermission("manageCatalog"),
    hasPermission("moneyReverse"),
    hasPermission("manageRoles"),
  ]);

  const t = await getTranslations("adminPage");

  // Seller queue is the only thing a moderator needs. Admin+ also loads the
  // catalog/money panels. Staff list only for owners (manageRoles).
  const pending = await xrouter.listSellers("pending");
  const [markup, margin, webhook, plans, canonical, listings, instances, accounts] =
    canPlans || canCatalog || canMoney
      ? await Promise.all([
          xrouter.getMarkup(),
          xrouter.getPlatformMargin(),
          xrouter.getWebhookConfig(),
          xrouter.listPlans(),
          xrouter.listCanonicalModels(),
          xrouter.listListings(),
          xrouter.listProviderInstances(),
          xrouter.listProviderAccounts(),
        ])
      : [null, null, null, [], [], [], [], []];
  const staff = canRoles ? await listStaff() : [];

  const houseListings = listings.filter((l) => l.sellerId === "house");
  const instanceOpts = instances
    .filter((i) => i.enabled)
    .map((i) => ({ id: i.id, name: i.name, type: i.type }));
  const accountOpts = accounts.map((a) => ({
    id: a.id,
    providerInstanceId: a.providerInstanceId,
    displayName: a.displayName,
    status: a.status,
  }));
  const listingLabels = {
    title: t("listingCreate"),
    model: t("listingModel"),
    inputPrice: t("listingInput"),
    outputPrice: t("listingOutput"),
    instance: t("listingInstance"),
    account: t("listingAccount"),
    create: t("listingCreateBtn"),
    created: t("listingCreated"),
    noAccounts: t("listingNoAccounts"),
  };

  const planLabels = {
    name: t("planName"),
    price: t("planPrice"),
    groups: t("planGroups"),
    hour: t("planHour"),
    day: t("planDay"),
    month: t("planMonth"),
    overage: t("planOverage"),
    save: t("save"),
    create: t("planCreate"),
    saved: t("saved"),
    del: t("planDelete"),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      {/* Platform margin (money) */}
      {canMoney && margin && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-1 flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("platformMargin")}
            </span>
          </div>
          <p className="text-3xl font-bold tabular-nums text-success">
            ${margin.platformMarginUsd.toFixed(2)}
          </p>
        </div>
      )}

      {/* Seller approval queue */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5" />
          {t("sellerQueue")}
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {pending.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {t("noPending")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((s) => (
                <SellerRow
                  key={s.id}
                  seller={{ id: s.id, displayName: s.displayName, status: s.status }}
                  labels={{ approve: t("approve"), suspend: t("suspend") }}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Plans (admin key) */}
      {canPlans && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Layers className="h-5 w-5" />
            {t("plans")}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {plans.map((p) => (
              <PlanEditor
                key={p.id}
                plan={{
                  id: p.id,
                  name: p.name,
                  priceUsd: p.priceUsd,
                  modelGroups: p.modelGroups,
                  buckets: p.buckets,
                  overageEnabled: p.overageEnabled,
                }}
                labels={planLabels}
              />
            ))}
            <PlanEditor labels={planLabels} />
          </div>
        </section>
      )}

      {/* Canonical models (admin key) — precondition for listings */}
      {canCatalog && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <ListChecks className="h-5 w-5" />
            {t("canonical")}
          </h2>
          <CanonicalManager
            models={canonical}
            labels={{
              add: t("canonicalAdd"),
              placeholder: t("canonicalPlaceholder"),
              remove: t("canonicalRemove"),
            }}
          />
        </section>
      )}

      {/* House listings (platform supply — full margin to the platform) */}
      {canCatalog && (
        <section>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <Store className="h-5 w-5" />
            {t("houseListings")}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">{t("houseListingsHint")}</p>
          {houseListings.length > 0 && (
            <ul className="mb-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {houseListings.map((l) => (
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
            source="house"
            canonicalModels={canonical}
            instances={instanceOpts}
            accounts={accountOpts}
            labels={listingLabels}
          />
        </section>
      )}

      {/* Markup */}
      {canPlans && markup && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("markup")}</h2>
          <MarkupForm
            defaultMarkup={markup.defaultMarkup}
            labels={{
              label: t("defaultMarkup"),
              hint: t("markupHint"),
              save: t("save"),
              saved: t("saved"),
            }}
          />
        </section>
      )}

      {/* Business webhook */}
      {canCatalog && webhook && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("webhook")}</h2>
          <WebhookForm
            config={{
              url: webhook.url,
              enabled: webhook.enabled,
              secretSet: webhook.secretSet,
            }}
            labels={{
              url: t("webhookUrl"),
              secret: t("webhookSecret"),
              secretSet: t("secretSet"),
              enabled: t("webhookEnabled"),
              save: t("save"),
              saved: t("saved"),
            }}
          />
        </section>
      )}

      {/* Role management (owner only) */}
      {canRoles && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5" />
            {t("rolesTitle")}
          </h2>
          <RoleManager
            staff={staff}
            currentEmail={cur?.email ?? ""}
            labels={{
              hint: t("rolesHint"),
              email: t("rolesEmail"),
              role: t("rolesRole"),
              add: t("rolesAdd"),
              addHint: t("rolesAddHint"),
              save: t("save"),
              saved: t("saved"),
              roleOwner: t("roleOwner"),
              roleAdmin: t("roleAdmin"),
              roleModerator: t("roleModerator"),
              roleUser: t("roleUser"),
              self: t("rolesSelf"),
              locked: t("rolesLocked"),
              empty: t("rolesEmpty"),
            }}
          />
        </section>
      )}
    </div>
  );
}
