"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { DocsSidebar } from "./docs-sidebar";

export function DocsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("docs");
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="grid h-9 w-9 place-items-center rounded-md border border-border xl:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                V
              </span>
              <span className="text-lg font-bold tracking-tight">Vexa</span>
              <span className="text-sm text-muted-foreground">/ {t("title")}</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex sm:items-center sm:gap-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/console">{t("console")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-4 sm:px-6">
        {/* Left sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 py-8 xl:block">
          <DocsSidebar />
        </aside>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 xl:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto border-r border-border bg-background p-4">
              <DocsSidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 py-10">{children}</main>
      </div>
    </>
  );
}
