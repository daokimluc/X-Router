"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { Globe } from "lucide-react";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: string) {
    if (next === locale) return;
    // pathname includes the current locale prefix, e.g. /vi/plans
    const segments = pathname.split("/");
    segments[1] = next;
    const target = segments.join("/") || `/${next}`;
    startTransition(() => router.replace(target));
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs font-semibold">
      <Globe className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
      {routing.locales.map((l) => (
        <button
          key={l}
          onClick={() => switchTo(l)}
          disabled={isPending}
          className={cn(
            "rounded px-1.5 py-1 uppercase transition-colors",
            l === locale
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
