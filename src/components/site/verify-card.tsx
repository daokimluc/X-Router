"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "@/app/[locale]/(auth)/actions";

type Status = "loading" | "ok" | "invalid" | "expired" | "already";

export function VerifyCard() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  // No token → invalid from the start; otherwise start in loading and resolve
  // asynchronously in the effect (async setState is fine; only synchronous
  // setState in an effect body is discouraged).
  const [status, setStatus] = useState<Status>(token ? "loading" : "invalid");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return; // guard double-invoke + no-token case
    ran.current = true;
    verifyEmailAction(token)
      .then((res) => setStatus(res.ok ? "ok" : res.error))
      .catch(() => setStatus("invalid"));
  }, [token]);

  const title =
    status === "ok"
      ? t("verifyOkTitle")
      : status === "loading"
        ? t("verifyLoading")
        : t("verifyFailTitle");

  const message =
    status === "ok"
      ? t("verifyOkMsg")
      : status === "already"
        ? t("verifyAlready")
        : status === "expired"
          ? t("verifyExpired")
          : status === "invalid"
            ? t("verifyInvalid")
            : t("verifyLoading");

  const showLogin = status === "ok" || status === "already";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <Link href="/" className="mb-6 inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            V
          </span>
          <span className="font-semibold text-foreground">Vexa</span>
        </Link>
        <h1 className="mb-2 text-xl font-bold text-foreground">{title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{message}</p>
        {showLogin ? (
          <Button asChild size="sm" className="w-full">
            <Link href={`/login`}>{t("submitLogin")}</Link>
          </Button>
        ) : status !== "loading" ? (
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href={`/register`}>{t("createOneFree")}</Link>
          </Button>
        ) : null}
        <p className="mt-4 text-xs text-muted-foreground">{locale.toUpperCase()}</p>
      </div>
    </div>
  );
}
