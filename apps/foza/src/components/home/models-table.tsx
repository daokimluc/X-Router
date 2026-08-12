import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/brand/brand-logo";
import { MODELS } from "@/lib/data";

export function ModelsTable() {
  const t = useTranslations("home");

  return (
    <section
      id="marketplace"
      className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8"
    >
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="mb-3 text-3xl font-bold sm:text-4xl md:text-5xl">
            {t("modelsTitle")}
          </h2>
          <p className="text-base text-muted-foreground sm:text-lg">
            {t("modelsSubtitle")}
          </p>
        </div>
        <Link
          href="/console/marketplace"
          className="flex items-center gap-1 self-start text-sm font-medium text-primary sm:self-auto"
        >
          {t("viewAll")} →
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>{t("thModel")}</Th>
                <Th>{t("thProvider")}</Th>
                <Th className="text-right">{t("thInput")}</Th>
                <Th className="text-right">{t("thOutput")}</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr
                  key={m.name}
                  className="border-t border-border transition-colors hover:bg-accent/30"
                >
                  <td className="px-6 py-3.5">
                    <span className="flex items-center gap-2.5 font-semibold">
                      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-card text-foreground [&_svg]:h-4 [&_svg]:w-4">
                        <ProviderLogo provider={m.provider} />
                      </span>
                      {m.name}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-[13px] text-muted-foreground">
                    {m.provider}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono text-[13px]">
                    {m.input}
                  </td>
                  <td className="px-6 py-3.5 text-right font-mono text-[13px]">
                    {m.output}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <Badge size="sm">{m.tag}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}
