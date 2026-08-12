"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X, Plus, ChevronDown, LogOut } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ConsoleSidebar } from "./console-sidebar";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { useAuth } from "@/components/providers/auth-provider";

export function ConsoleShell({
  children,
  isAdmin = false,
  balanceSlot,
}: {
  children: React.ReactNode;
  isAdmin?: boolean;
  balanceSlot?: React.ReactNode;
}) {
  const t = useTranslations("console");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <ConsoleSidebar isAdmin={isAdmin} />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <ConsoleSidebar isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-border lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
              <span className="font-semibold tabular-nums">{balanceSlot}</span>
              <Link
                href="/console/wallet"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("topUp")}
              </Link>
            </div>
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function UserMenu() {
  const auth = useAuth();
  const t = useTranslations("console");
  const [open, setOpen] = useState(false);

  const user = auth.user ?? { name: "luc dao kim", email: "khiconlauca9xx@gmail.com" };
  const initial = user.name.charAt(0).toUpperCase();

  function handleSignOut() {
    setOpen(false);
    // Auth.js clears the JWT cookie server-side, then hard-redirects to "/".
    void auth.signOut();
  }

  return (
    <div className="relative border-l border-border pl-2 sm:pl-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-secondary"
        aria-label={user.name}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
          {initial}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight">
            {user.name}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {user.email}
          </span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-48 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-elevated">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <LogOut className="h-4 w-4" />
              {t("signOut")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
