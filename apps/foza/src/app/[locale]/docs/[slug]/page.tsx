import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ALL_DOCS } from "@/lib/docs";
import { DocProse } from "@/components/docs/doc-prose";
import { CodeBlock } from "@/components/ui/code-block";
import { DOC_CONTENT } from "@/components/docs/content";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    ALL_DOCS.map((d) => ({ locale, slug: d.slug })),
  );
}

export default async function DocArticle({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const meta = ALL_DOCS.find((d) => d.slug === slug);
  if (!meta) notFound();

  const content = DOC_CONTENT[slug];

  return (
    <DocProse>
      <div className="text-[13px] font-medium text-primary">Documentation</div>
      <h1 className="mt-1">{meta.label}</h1>
      {content ? (
        content
      ) : (
        <>
          <p>
            Hướng dẫn dùng <strong>{meta.label}</strong> với Vexa Gateway. Trỏ
            client của bạn tới base URL và dùng API key dạng{" "}
            <code>sk-vexa-xxxx</code>.
          </p>
          <CodeBlock title="base url" className="mt-4">
            https://api.vexa.ai/v1
          </CodeBlock>
          <p>
            Xem <Link href="/docs/quick-start">Quick Start</Link> để bắt đầu.
          </p>
        </>
      )}
    </DocProse>
  );
}
