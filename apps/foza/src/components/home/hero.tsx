import { useTranslations } from "next-intl";
import { Zap, CodeXml } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ToolLogo } from "@/components/brand/brand-logo";

const TOOL_TILES = [
  { name: "OpenCode", type: "cli", tone: "primary", descKey: "toolOpenCodeDesc" },
  { name: "Cursor", type: "AI editor", tone: "foreground", descKey: "toolCursorDesc" },
  { name: "Claude Code", type: "CLI", tone: "success", descKey: "toolClaudeCodeDesc" },
  { name: "Codex CLI", type: "terminal", tone: "primary", descKey: "toolCodexDesc" },
  { name: "OpenClaw", type: "agent", tone: "foreground", descKey: "toolOpenClawDesc" },
  { name: "Harness Agent", type: "workflow", tone: "success", descKey: "toolHarnessDesc" },
] as const;

const TONE: Record<string, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  foreground: "bg-foreground/[0.08] text-foreground border-border",
  success: "bg-success/15 text-success border-success/20",
};

export function Hero() {
  const t = useTranslations("home");

  const stats = [
    { v: "120M+", l: t("statRequests") },
    { v: "150+", l: t("statModels") },
    { v: "30+", l: t("statProviders") },
    { v: "<2000ms", l: t("statLatency") },
  ];

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pt-20">
      <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr]">
        {/* Left */}
        <div>
          <span className="mb-6 inline-flex items-center rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground">
            <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            {t("badge")}
          </span>
          <h1 className="mb-5 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-7xl">
            {t("heroTitle1")}
            <br />
            <span className="text-primary">{t("heroTitle2")}</span>
          </h1>
          <p className="mb-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:text-xl">
            {t("heroSubtitle")}
          </p>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">{t("startFree")}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/console/marketplace">{t("browseModels")}</Link>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-border/80 bg-card p-4"
              >
                <p className="text-xl font-bold tabular-nums text-foreground sm:text-2xl">
                  {s.v}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Vexa Gateway panel */}
        <div className="hidden lg:block">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* header */}
            <div className="border-b border-border bg-accent/30 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold leading-none">{t("gatewayName")}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                      /v1 · models · usage
                    </p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                  {t("gatewayCompat")}
                </span>
              </div>
            </div>

            {/* tool grid with connector lines + floating center badge */}
            <div className="relative px-5 py-5">
              {/* decorative connector lines */}
              <div className="pointer-events-none absolute left-1/2 top-9 h-[238px] w-px -translate-x-1/2 bg-border" />
              <div className="pointer-events-none absolute left-10 right-10 top-[118px] h-px bg-border" />
              <div className="pointer-events-none absolute left-10 right-10 top-[206px] h-px bg-border" />

              {/* floating center badge */}
              <div className="relative mx-auto mb-5 flex w-fit items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Zap className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold leading-none">{t("gatewayName")}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                    /v1 · models · usage
                  </p>
                </div>
              </div>

              <div className="relative grid grid-cols-2 gap-3">
                {TOOL_TILES.map((tool) => (
                  <div
                    key={tool.name}
                    className="group relative rounded-lg border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border [&_svg]:h-[18px] [&_svg]:w-[18px] ${TONE[tool.tone]}`}
                        >
                          <ToolLogo tool={tool.name} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-none text-foreground">
                            {tool.name}
                          </p>
                          <span className="mt-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <CodeXml className="h-3 w-3 text-primary" />
                            {tool.type}
                          </span>
                        </div>
                      </div>
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-success" />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t(tool.descKey)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* footer base url */}
            <div className="border-t border-border bg-accent/30 px-5 py-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sharedBaseUrl")}
                  </p>
                  <p className="truncate font-mono text-xs text-foreground">
                    https://api.vexa.ai/v1
                  </p>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <Link href="/register">{t("setupNow")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
