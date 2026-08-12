import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ToolLogo } from "@/components/brand/brand-logo";

type Line = { text: string; tone?: "dim" | "fg" | "primary" | "success" };

const LINE_TONE: Record<NonNullable<Line["tone"]>, string> = {
  dim: "text-muted-foreground/50",
  fg: "text-foreground/80",
  primary: "text-primary",
  success: "text-success",
};

const CARDS: Array<{ name: string; badge: string; desc: string; code: Line[] }> = [
  {
    name: "OpenCode",
    badge: "CLI",
    desc: "Cấu hình Vexa như provider OpenAI-compatible cho các workflow local.",
    code: [
      { text: "# ~/.config/opencode/config.json", tone: "dim" },
      { text: '"providers": {', tone: "fg" },
      { text: '  "vexa": {', tone: "fg" },
      { text: '    "base_url": "https://api.vexa.ai/v1",', tone: "primary" },
      { text: '    "api_key": "sk-vexa-xxxx"', tone: "success" },
      { text: "  }", tone: "fg" },
      { text: "}", tone: "fg" },
    ],
  },
  {
    name: "Cursor",
    badge: "AI Editor",
    desc: "Dùng trong editor AI với base URL tùy chỉnh và model alias của Vexa.",
    code: [
      { text: "# Cursor Settings → Models", tone: "dim" },
      { text: "Override AI Base URL:", tone: "fg" },
      { text: "  https://api.vexa.ai/v1", tone: "primary" },
      { text: "API Key: sk-vexa-xxxx", tone: "success" },
      { text: "Model: provider/gpt-4o", tone: "fg" },
    ],
  },
  {
    name: "Claude Code",
    badge: "CLI Agent",
    desc: "Kết nối các model Claude-compatible hoặc route qua gateway cho tác vụ coding.",
    code: [
      { text: "# terminal", tone: "dim" },
      { text: "$ ANTHROPIC_BASE_URL=\\", tone: "fg" },
      { text: "  https://api.vexa.ai/v1 \\", tone: "primary" },
      { text: "  ANTHROPIC_API_KEY=sk-vexa-xxxx \\", tone: "success" },
      { text: "  claude", tone: "fg" },
    ],
  },
  {
    name: "Codex CLI",
    badge: "Terminal",
    desc: "Chạy tác vụ terminal với một khóa API và danh sách model thống nhất.",
    code: [
      { text: "# terminal", tone: "dim" },
      { text: "$ OPENAI_API_KEY=sk-vexa-xxxx \\", tone: "success" },
      { text: "  OPENAI_BASE_URL=\\", tone: "fg" },
      { text: "  https://api.vexa.ai/v1 \\", tone: "primary" },
      { text: '  codex "Fix the bug in main.ts"', tone: "fg" },
    ],
  },
  {
    name: "OpenClaw",
    badge: "Agent",
    desc: "Gắn gateway vào agent runtime để chuyển model mà không đổi logic.",
    code: [
      { text: "# openclaw.config.ts", tone: "dim" },
      { text: "llm: {", tone: "fg" },
      { text: '  provider: "openai",', tone: "fg" },
      { text: '  base_url: "https://api.vexa.ai/v1",', tone: "primary" },
      { text: '  api_key: "sk-vexa-xxxx",', tone: "success" },
      { text: '  model: "provider/claude-sonnet-4.6"', tone: "fg" },
      { text: "}", tone: "fg" },
    ],
  },
  {
    name: "Harness Agent",
    badge: "Workflow",
    desc: "Dùng trong workflow agent có kiểm soát chi phí, token và log.",
    code: [
      { text: "# harness-agent.yaml", tone: "dim" },
      { text: "ai_provider:", tone: "fg" },
      { text: "  type: openai_compatible", tone: "fg" },
      { text: "  base_url: https://api.vexa.ai/v1", tone: "primary" },
      { text: "  model: provider/gpt-5.4", tone: "success" },
    ],
  },
];

export function Integrations() {
  const t = useTranslations("home");

  return (
    <section
      id="integrations"
      className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mb-14 text-center">
        <span className="mb-5 inline-flex items-center rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground">
          <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          {t("integrationsBadge")}
        </span>
        <h2 className="mb-4 text-3xl font-bold sm:text-4xl md:text-5xl">
          {t("integrationsTitle")}
        </h2>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          {t("integrationsSubtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <div
            key={c.name}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">
                  <ToolLogo tool={c.name} />
                </span>
                <div>
                  <p className="font-semibold text-foreground">{c.name}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                    {c.badge}
                  </span>
                </div>
              </div>
              <span className="mt-1 flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_rgba(34,197,94,0.15)]" />
            </div>
            <p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground">
              {c.desc}
            </p>
            <div className="mx-4 mb-5 flex-1 overflow-hidden rounded-lg border border-border bg-muted/40">
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-destructive/50" />
                <span className="h-2 w-2 rounded-full bg-primary/40" />
                <span className="h-2 w-2 rounded-full bg-success/50" />
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  config
                </span>
              </div>
              <pre className="overflow-x-auto px-3 py-3 font-mono text-[10px] leading-5">
                {c.code.map((line, i) => (
                  <div key={i} className={line.tone ? LINE_TONE[line.tone] : "text-foreground/80"}>
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-5 py-4">
        <code className="font-mono text-xs text-foreground">
          <span className="text-muted-foreground">{t("sharedBaseUrl")}</span>
          &nbsp;&nbsp;https://api.vexa.ai/v1 — {t("dropIn")}
        </code>
        <Button size="sm">{t("setupNow")}</Button>
      </div>
    </section>
  );
}
