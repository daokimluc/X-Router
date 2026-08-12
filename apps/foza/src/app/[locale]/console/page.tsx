import { setRequestLocale, getTranslations } from "next-intl/server";
import { KeyRound, Store, Wallet, Terminal, Wallet as WalletIcon, KeyRound as KeyIcon, BarChart3, CircleDollarSign } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { ledger } from "@/lib/xrouter/ledger";
import { xrouter } from "@/lib/xrouter/adapter";

// Reads live wallet + ledger + session per request.
export const dynamic = "force-dynamic";

export default async function ConsoleDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("console");

  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  const summary = ledger.summary();
  const walletUsd = acct ? (await xrouter.getWallet(acct.keyId)).walletUsd : 0;
  const activeKeys = acct?.keys.length ?? 0;
  const name = session?.name ?? "—";

  const kpis = [
    { label: t("walletBalance"), value: `$${walletUsd.toFixed(2)}`, icon: WalletIcon },
    { label: t("activeKeys"), value: String(activeKeys), icon: KeyIcon },
    { label: t("totalRequests"), value: String(summary.totalRequests), icon: BarChart3 },
    { label: t("totalSpend"), value: `$${summary.totalSpendUsd.toFixed(2)}`, icon: CircleDollarSign },
  ];

  const steps = [
    { n: "01", title: t("qs1"), action: t("viewKeys"), href: "/console/keys", icon: KeyRound },
    { n: "02", title: t("qs2"), action: t("marketplace"), href: "/console/marketplace", icon: Store },
    { n: "03", title: t("qs3Title"), desc: t("qs3Desc"), action: t("wallet"), href: "/console/wallet", icon: Wallet },
    { n: "04", title: t("qs4"), action: t("viewKeys"), href: "/console/keys", icon: Terminal },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("welcome", { name })}
      </h1>
      <p className="mt-1 text-muted-foreground">{t("overviewDesc")}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">{t("quickStart")}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {steps.map((s) => (
          <div
            key={s.n}
            className="hover-lift flex items-start gap-4 rounded-xl border border-border bg-card p-5"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
              <s.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] text-muted-foreground">{s.n}</div>
              <h3 className="mt-0.5 font-semibold">{s.title}</h3>
              {s.desc && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              )}
              <Button asChild size="sm" variant="ghost" className="mt-3">
                <Link href={s.href}>{s.action} →</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
