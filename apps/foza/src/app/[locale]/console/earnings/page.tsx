import { setRequestLocale, getTranslations } from "next-intl/server";
import { Store } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { DataTable } from "@/components/console/data-table";
import { xrouter } from "@/lib/xrouter/adapter";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";

// Reads the seller's live earnings snapshot per request.
export const dynamic = "force-dynamic";

export default async function ConsoleEarnings({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("earningsPage");

  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;

  // Not a seller yet → prompt to register instead of hardcoded data.
  if (!acct?.sellerId) {
    return (
      <div className="mx-auto max-w-6xl">
        <ConsolePageHeader title={t("title")} description={t("subtitle")} />
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary">
            <Store className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-lg font-semibold">{t("notSellerTitle")}</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            {t("notSellerHint")}
          </p>
        </div>
      </div>
    );
  }

  const earnings = await xrouter.getEarnings(acct.sellerId);
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const pending = acct.sellerStatus === "pending";

  const kpis = [
    { label: t("totalEarnings"), value: fmt(earnings.lifetime), green: true },
    { label: t("pendingEarnings"), value: fmt(earnings.unpaid) },
    { label: t("thisMonth"), value: fmt(earnings.month) },
    { label: t("today"), value: fmt(earnings.day) },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      {pending && (
        <div className="mb-5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t("pendingApproval")}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div
              className={`mt-2 text-2xl font-bold tracking-tight tabular-nums ${k.green ? "text-success" : ""}`}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-foreground">
        {t("providerLog")}
      </h2>
      <DataTable
        columns={[
          t("time"),
          t("model"),
          t("tokens"),
          t("providerEarning"),
          t("latency"),
          t("status"),
          t("type"),
        ]}
        emptyTitle={t("empty")}
      />
    </div>
  );
}
