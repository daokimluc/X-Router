import { useTranslations } from "next-intl";
import {
  Check,
  Wallet,
  Boxes,
  Activity,
  Gauge,
  LayoutDashboard,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export function HowItWorks() {
  const t = useTranslations("home");
  const steps = [
    { n: "01", title: t("step1Title"), desc: t("step1Desc") },
    { n: "02", title: t("step2Title"), desc: t("step2Desc") },
    { n: "03", title: t("step3Title"), desc: t("step3Desc") },
    { n: "04", title: t("step4Title"), desc: t("step4Desc") },
  ];

  return (
    <section
      id="how-it-works"
      className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mb-14 text-center">
        <h2 className="mb-4 text-3xl font-bold sm:text-4xl md:text-5xl">
          {t("howTitle")}
        </h2>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          {t("howSubtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.n} className="relative">
            {i < steps.length - 1 && (
              <div className="absolute left-[calc(100%-0.5rem)] top-7 z-10 hidden h-px w-8 bg-border lg:block" />
            )}
            <div className="h-full rounded-xl border border-border bg-card transition-colors hover:border-primary/30">
              <div className="p-5 pt-6">
                <div className="mb-4 font-mono text-3xl font-bold text-primary/25">
                  {s.n}
                </div>
                <h3 className="mb-2 font-semibold text-foreground">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Providers() {
  const t = useTranslations("home");
  const items = [t("pl1"), t("pl2"), t("pl3"), t("pl4"), t("pl5")];

  const stats = [
    { icon: Wallet, label: t("totalEarnings"), value: "$1,284.50", green: true },
    { icon: Boxes, label: t("activeModels"), value: t("modelsUnit") },
    { icon: Activity, label: t("requests30d"), value: "48,291" },
    { icon: Gauge, label: t("avgLatency"), value: "142ms" },
  ];

  return (
    <section
      id="providers"
      className="mx-auto w-full max-w-7xl scroll-mt-16 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
        <div>
          <span className="mb-5 inline-flex items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {t("providerBadge")}
          </span>
          <h2 className="mb-5 text-3xl font-bold sm:text-4xl md:text-5xl">
            {t("providerTitle1")} {t("providerTitle2")}
          </h2>
          <p className="mb-8 text-lg leading-relaxed text-muted-foreground">
            {t("providerDesc")}
          </p>
          <ul className="mb-10 space-y-3">
            {items.map((it) => (
              <li key={it} className="flex items-center gap-3 text-foreground">
                <Check className="h-4 w-4 shrink-0 text-success" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">{t("becomeProvider")}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/console/marketplace">{t("seeMarketplace")}</Link>
            </Button>
          </div>
        </div>

        {/* Provider console card */}
        <div className="rounded-xl border border-border bg-card">
          <div className="p-5 pt-6">
            <div className="mb-6 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <LayoutDashboard className="h-[18px] w-[18px] text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t("consoleTitle")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("consoleSubtitle")}
                </div>
              </div>
            </div>

            {stats.map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-between border-b border-border py-3.5 last:border-0"
              >
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <s.icon className="h-4 w-4" />
                  {s.label}
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${s.green ? "text-success" : "text-foreground"}`}
                >
                  {s.value}
                </span>
              </div>
            ))}

            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    gpt-4o-mini{" "}
                    <span className="font-normal text-muted-foreground">
                      (provider)
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    $0.15 / 1M input · $0.60 / 1M output
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                    {t("active")}
                  </span>
                  <div className="mt-1 text-[11px] font-medium text-success">
                    +12.4% {t("vsLastWeek")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  const t = useTranslations("home");
  const nav = useTranslations("nav");
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[760px] rounded-2xl border border-border bg-card px-8 py-14 text-center">
        <h2 className="text-3xl font-bold sm:text-4xl">{t("ctaTitle")}</h2>
        <p className="mx-auto mt-4 max-w-lg text-lg text-muted-foreground">
          {t("ctaSubtitle")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/register">{t("createFreeAccount")}</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/login">{nav("signIn")}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
