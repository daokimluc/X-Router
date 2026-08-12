import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { DocProse } from "@/components/docs/doc-prose";
import { CodeBlock } from "@/components/ui/code-block";

export default async function DocsOverview({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("docs");

  const toc = [
    { id: "what-is-vexa", label: "What is Vexa" },
    { id: "base-url", label: "Base URL" },
    { id: "first-request", label: "First request" },
    { id: "next-steps", label: "Next steps" },
  ];

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        <DocProse>
          <div className="text-[13px] font-medium text-primary">Introduction</div>
          <h1 className="mt-1">Overview</h1>
          <p>
            Vexa is a P2P LLM API marketplace. It exposes GPT, Claude, Gemini,
            Mistral and 50+ models behind a single, OpenAI-compatible endpoint —
            so you can switch models without touching your SDK.
          </p>

          <h2 id="what-is-vexa">What is Vexa</h2>
          <p>
            One API key unlocks every provider-listed model. Pricing is
            pay-as-you-go and transparent, billed per token. Providers can list
            their own inference endpoints and earn on every request.
          </p>
          <ul>
            <li>OpenAI and Anthropic compatible — no SDK changes.</li>
            <li>Pay per token, no subscriptions or seats.</li>
            <li>Verified providers with public uptime and latency metrics.</li>
          </ul>

          <h2 id="base-url">Base URL</h2>
          <p>Point any OpenAI-compatible client at the gateway:</p>
          <CodeBlock title="base url" className="mt-4">
            https://api.vexa.ai/v1
          </CodeBlock>

          <h2 id="first-request">First request</h2>
          <p>A minimal chat completion with cURL:</p>
          <CodeBlock title="curl" className="mt-4">{`curl https://api.vexa.ai/v1/chat/completions \\
  -H "Authorization: Bearer sk-vexa-xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "provider/gpt-5.4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}</CodeBlock>

          <h2 id="next-steps">Next steps</h2>
          <p>
            Continue with the{" "}
            <Link href="/docs/quick-start">Quick Start</Link>, set up{" "}
            <Link href="/docs/authentication">Authentication</Link>, or browse{" "}
            <Link href="/docs/chat-completions">Chat Completions</Link>.
          </p>
        </DocProse>
      </article>

      <aside className="sticky top-24 hidden h-fit w-48 shrink-0 lg:block">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("onThisPage")}
        </div>
        <nav className="flex flex-col gap-2 border-l border-border">
          {toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="-ml-px border-l border-transparent pl-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}
