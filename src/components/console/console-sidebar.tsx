"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";
import {
  LayoutDashboard,
  Store,
  CreditCard,
  KeyRound,
  BarChart3,
  Gift,
  Server,
  Boxes,
  Wallet,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { SupportWidget } from "@/components/site/support-widget";
import { cn } from "@/lib/utils";

export function ConsoleSidebar({
  onNavigate,
  isAdmin = false,
}: {
  onNavigate?: () => void;
  isAdmin?: boolean;
}) {
  const t = useTranslations("console");
  const pathname = usePathname();

  const main = [
    { href: "/console", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/console/marketplace", label: t("marketplace"), icon: Store },
    { href: "/console/plans", label: t("plans"), icon: CreditCard },
    { href: "/console/keys", label: t("keys"), icon: KeyRound },
    { href: "/console/usage", label: t("usage"), icon: BarChart3 },
    { href: "/console/referral", label: t("referral"), icon: Gift },
  ];
  const provider = [
    { href: "/console/provider", label: t("provider"), icon: Server },
    { href: "/console/models", label: t("myModels"), icon: Boxes },
    { href: "/console/earnings", label: t("earnings"), icon: Wallet },
  ];
  const admin = isAdmin
    ? [{ href: "/console/admin", label: t("admin"), icon: ShieldCheck }]
    : [];

  function isActive(href: string) {
    if (href === "/console") return pathname === "/console";
    return pathname.startsWith(href);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <Link href="/console" className="flex items-center gap-2.5" onClick={onNavigate}>
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            V
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">
            Vexa
          </span>
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto py-3">
        <Group>
          {main.map((item) => (
            <Item key={item.href} {...item} active={isActive(item.href)} onNavigate={onNavigate} />
          ))}
        </Group>

        <div className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("providerGroup")}
        </div>
        <Group>
          {provider.map((item) => (
            <Item key={item.href} {...item} active={isActive(item.href)} onNavigate={onNavigate} />
          ))}
        </Group>

        {admin.length > 0 && (
          <>
            <div className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("adminGroup")}
            </div>
            <Group>
              {admin.map((item) => (
                <Item key={item.href} {...item} active={isActive(item.href)} onNavigate={onNavigate} />
              ))}
            </Group>
          </>
        )}
      </nav>

      <div className="space-y-3 border-t border-border p-3">
        <Link
          href="/docs"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
        >
          <FileText className="h-[18px] w-[18px]" />
          {t("docs")}
        </Link>
        <SupportWidget variant="sidebar" />
      </div>
    </aside>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 px-3">{children}</div>;
}

function Item({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="flex-1">{label}</span>
      <NavPending />
    </Link>
  );
}

/**
 * Inline spinner shown while a sidebar link's destination is loading. Reads
 * Next's built-in navigation pending state (no extra dependency). Debounced via
 * the `animate-fade-in` delay so it only appears on slower transitions.
 */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
      aria-hidden
    />
  );
}
