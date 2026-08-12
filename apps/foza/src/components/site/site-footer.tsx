import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";

export function SiteFooter() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");

  const links = [
    { href: "/console/marketplace", label: nav("marketplace") },
    { href: "/login", label: nav("signIn") },
    { href: "/register", label: t("register") },
    { href: "/", label: t("terms") },
    { href: "/", label: t("privacy") },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 lg:flex-row lg:px-8">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            V
          </span>
          <span className="font-semibold text-foreground">Vexa</span>
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          <span>LLM Marketplace API</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 text-center">
          {links.map((l, i) => (
            <Link
              key={`${l.href}-${i}`}
              href={l.href}
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
          {t("rights")}
        </div>
      </div>
    </footer>
  );
}
