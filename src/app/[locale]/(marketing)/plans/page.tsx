import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function PlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PlansContent />;
}

function PlansContent() {
  const t = useTranslations("plans");
  const nav = useTranslations("nav");
  const features = [
    { title: t("predictableQuota"), desc: t("predictableQuotaDesc") },
    { title: t("curatedBundles"), desc: "" },
    { title: t("overageControl"), desc: "" },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <Badge>{t("availablePlans")}</Badge>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>
        <div className="mt-7 flex justify-center gap-3">
          <Button asChild>
            <Link href="/register">{t("createAccount")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/login">{nav("signIn")}</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-14 grid max-w-4xl gap-5 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <div className="text-4xl font-bold tracking-tight">0</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t("availablePlans")}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <div className="text-4xl font-bold tracking-tight">0</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t("includedModels")}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-5 grid max-w-4xl gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-5">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-primary">
              <Check className="h-4 w-4" />
            </span>
            <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
            {f.desc && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {f.desc}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-border bg-card px-8 py-12 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{t("readyTitle")}</h2>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link href="/register">{t("createAccount")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/console/plans">{t("openConsolePlans")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
