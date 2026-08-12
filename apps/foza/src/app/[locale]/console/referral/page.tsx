import { setRequestLocale, getTranslations } from "next-intl/server";
import { Gift, Copy, Link2, Users, CircleDollarSign, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsolePageHeader } from "@/components/console/page-header";

export default async function ConsoleReferral({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("referralPage");

  const code = "REFFY4CY";
  const link = `https://vexa.ai/register?ref=${code}`;
  const steps = [t("step1"), t("step2"), t("step3"), t("step4")];
  const stats = [
    { icon: Users, value: "0", label: t("totalReferrals") },
    { icon: CircleDollarSign, value: "$0.0000", label: t("totalCommission") },
    { icon: Percent, value: "5%", label: t("commissionRate") },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <ConsolePageHeader title={t("title")} />

      <div className="mb-5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        {t("comingSoon")}
      </div>

      {/* code card */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary">
            <Gift className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold">{t("yourCode")}</p>
            <p className="font-mono text-lg font-bold tracking-wider text-primary">
              {code}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost">
            <Copy className="h-4 w-4" />
            {t("copyCode")}
          </Button>
          <Button size="sm" variant="ghost">
            <Link2 className="h-4 w-4" />
            {t("copyLink")}
          </Button>
        </div>
        <div className="mt-3 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
          {link}
        </div>
      </div>

      {/* how it works */}
      <div className="mt-4 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold">{t("howItWorks")}</h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
                {i + 1}
              </span>
              <span className="text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* stats */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-5">
            <s.icon className="mb-2 h-4 w-4 text-muted-foreground" />
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* referral list */}
      <div className="mt-4 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold">{t("referralList")}</h2>
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/50 text-muted-foreground">
            <Users className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p>
          <Button size="sm" variant="ghost" className="mt-4">
            <Link2 className="h-4 w-4" />
            {t("copyLink")}
          </Button>
        </div>
      </div>
    </div>
  );
}
