"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, X, QrCode } from "lucide-react";
import { DiscordLogo, ZaloLogo } from "@/components/brand/brand-logo";

const DISCORD_URL = "https://discord.gg/H9NMKakYQ";
const ZALO_URL = "https://zalo.me/g/owwzqvrg6rpjvlrsryt1";

/**
 * Discord + Zalo community/support entry points, mirrored from the foza.ai
 * template. Two layouts:
 *  - "floating": fixed bottom-right pills (marketing pages)
 *  - "sidebar": full-width buttons inside the console sidebar
 * Discord opens directly in a new tab; Zalo opens a QR-code modal (the link is
 * also tappable inside it for mobile).
 */
export function SupportWidget({
  variant = "floating",
}: {
  variant?: "floating" | "sidebar";
}) {
  const t = useTranslations("community");
  const [qrOpen, setQrOpen] = useState(false);

  if (variant === "sidebar") {
    return (
      <>
        <div className="flex flex-col gap-1.5">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            <DiscordLogo className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{t("discord")}</span>
          </a>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            <ZaloLogo className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{t("zalo")}</span>
          </button>
        </div>
        <ZaloQrModal open={qrOpen} onClose={() => setQrOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div className="fixed bottom-5 right-4 z-[80] flex flex-col items-end gap-2 sm:right-6">
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={t("discord")}
          className="group flex h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-lg shadow-background/20 transition-colors hover:border-primary hover:bg-accent hover:text-primary"
        >
          <DiscordLogo className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">{t("discord")}</span>
          <ExternalLink className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:text-primary sm:inline" />
        </a>
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          aria-label={t("zalo")}
          className="group flex h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-lg shadow-background/20 transition-colors hover:border-primary hover:bg-accent hover:text-primary"
        >
          <ZaloLogo className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">{t("zalo")}</span>
          <QrCode className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:text-primary sm:inline" />
        </button>
      </div>
      <ZaloQrModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  );
}

function ZaloQrModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("community");
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm animate-fade-in-up rounded-2xl border border-border bg-card p-6 shadow-elevated">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <ZaloLogo className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-lg font-bold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

          {/* QR — dark-on-white so it scans in either theme. */}
          <div className="mt-5 rounded-xl border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/zalo-qr.svg"
              alt={t("zaloQrAlt")}
              width={176}
              height={176}
              className="h-44 w-44"
            />
          </div>

          <p className="mt-3 text-sm font-medium text-foreground">
            {t("zaloQrTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("zaloQrDescription")}
          </p>

          <a
            href={ZALO_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ZaloLogo className="h-4 w-4" />
            {t("openZalo")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
