import { useTranslations } from "next-intl";
import { Zap, ShieldCheck, CircleDollarSign, TrendingUp, BarChart3, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";

export function Features() {
  const t = useTranslations("home");

  const features = [
    { icon: Zap, title: t("f1Title"), desc: t("f1Desc"), more: true },
    { icon: ShieldCheck, title: t("f2Title"), desc: t("f2Desc"), more: true },
    { icon: CircleDollarSign, title: t("f3Title"), desc: t("f3Desc"), more: true },
    { icon: TrendingUp, title: t("f4Title"), desc: t("f4Desc"), more: true },
    { icon: BarChart3, title: t("f5Title"), desc: t("f5Desc"), more: true },
    { icon: Lock, title: t("f6Title"), desc: t("f6Desc"), more: true },
  ];

  return (
    <section id="features" className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="mb-14 text-center">
        <h2 className="mb-4 text-3xl font-bold sm:text-4xl md:text-5xl">
          {t("featuresTitle")}
        </h2>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          {t("featuresSubtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="group hover-lift h-full rounded-xl border border-border/80 bg-card"
          >
            <div className="p-5 pt-6">
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.desc}
              </p>
              {f.more && (
                <Link
                  href="/docs"
                  className="mt-4 flex items-center text-xs font-medium text-primary"
                >
                  {t("learnMore")} →
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
