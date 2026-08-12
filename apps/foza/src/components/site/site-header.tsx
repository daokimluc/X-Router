"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X, LayoutDashboard } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { useAuth } from "@/components/providers/auth-provider";

export function SiteHeader() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const { user, ready } = useAuth();

  const links = [
    { href: "/console/marketplace", label: t("marketplace") },
    { href: "/plans", label: t("plans") },
    { href: "/#how-it-works", label: t("howItWorks") },
    { href: "/#providers", label: t("providers") },
    { href: "/docs", label: t("docs") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-sidebar backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            V
          </span>
          <span className="text-lg font-bold tracking-tight">Vexa</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-semibold lg:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-foreground transition-colors hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          {ready && user ? (
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/console">
                <LayoutDashboard className="h-4 w-4" />
                {t("console")}
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">{t("signIn")}</Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/register">{t("getStarted")}</Link>
              </Button>
            </>
          )}
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-border lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-secondary"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-3">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/login" onClick={() => setOpen(false)}>
                  {t("signIn")}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register" onClick={() => setOpen(false)}>
                  {t("getStarted")}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
