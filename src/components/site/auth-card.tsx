"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { signIn, getProviders } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  registerAction,
  resendVerificationAction,
  diagnoseLoginAction,
} from "@/app/[locale]/(auth)/actions";

// Validate an attacker-controllable `next` redirect target. Returns the path
// only if it's a safe same-origin relative path; otherwise null (caller falls
// back to a known-good default). Blocks absolute URLs ("https://evil.com"),
// scheme-relative ("//evil.com"), and backslash tricks ("/\\evil.com") that
// browsers can normalize to an external origin.
function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  // Reject whitespace and non-printable characters — browsers can
  // strip/normalize those to escape the path and reach an external origin.
  // A legitimate same-origin target is a single run of printable,
  // space-free path/query characters (ASCII 0x21-0x7E).
  if (!/^\/[\x21-\x7e]*$/.test(next)) return null;
  return next;
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function Wordmark() {
  return (
    <>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        V
      </span>
      <span className="font-semibold text-foreground">Vexa</span>
    </>
  );
}

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const isLogin = mode === "login";
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // After register: show a "check your email" screen instead of logging in.
  const [registered, setRegistered] = useState(false);
  // Dev only: when SMTP isn't configured, the verify link is returned here.
  const [devUrl, setDevUrl] = useState<string | null>(null);
  // Login: when the account exists but isn't verified, offer to resend.
  const [needVerify, setNeedVerify] = useState(false);
  const [resentMsg, setResentMsg] = useState<string | null>(null);
  // Google only works when AUTH_GOOGLE_ID/SECRET are set (provider registered
  // server-side). Ask Auth.js at runtime so the button reflects reality.
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getProviders()
      .then((p) => setGoogleEnabled(Boolean(p && "google" in p)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const next = searchParams.get("next");

  function go() {
    // Hard navigation so the freshly-set session cookie is present on the
    // request and the middleware guard re-evaluates (soft router.push can serve
    // a prefetched logged-out RSC of /console and bounce back to login).
    //
    // SECURITY: `next` is attacker-controllable (it's a query param), so only
    // honor it when it's a same-origin relative path. Reject absolute URLs,
    // scheme-relative `//host`, and anything not starting with a single `/`
    // — otherwise it's an open-redirect into a phishing site.
    const target = safeNext(next) ?? `/${locale}/console`;
    window.location.assign(target);
  }

  function handleGoogle() {
    if (!googleEnabled) {
      // Not configured — guide the user instead of failing silently.
      setError(t("googleUnavailable"));
      return;
    }
    // Auth.js redirects to Google then back to the callback URL.
    void signIn("google", { callbackUrl: safeNext(next) ?? `/${locale}/console` });
  }

  function isGmailClient(v: string): boolean {
    return /^[^\s@]+@gmail\.com$/.test(v.trim().toLowerCase());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setNeedVerify(false);
    setResentMsg(null);

    // Gmail-only, enforced client-side first for instant feedback.
    if (!isGmailClient(email)) {
      setError(t("errNotGmail"));
      return;
    }

    setPending(true);
    try {
      if (isLogin) {
        // Diagnose first so we can show a precise message (unverified vs bad).
        const diag = await diagnoseLoginAction({ email, password });
        if (!diag.ok) {
          if (diag.reason === "unverified") {
            setNeedVerify(true);
            setError(t("errUnverified"));
          } else if (diag.reason === "notGmail") {
            setError(t("errNotGmail"));
          } else if (diag.reason === "rateLimited") {
            setError(t("errRateLimited"));
          } else {
            setError(t("errInvalidCredentials"));
          }
          return;
        }
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });
        if (res?.error) {
          setError(t("errInvalidCredentials"));
          return;
        }
        go();
      } else {
        const res = await registerAction({ name, email, password, locale });
        if (!res.ok) {
          setError(
            res.error === "duplicate"
              ? t("errDuplicate")
              : res.error === "notGmail"
                ? t("errNotGmail")
                : res.error === "rateLimited"
                  ? t("errRateLimited")
                  : res.error === "invalid"
                    ? t("errInvalid")
                    : t("errUnknown"),
          );
          return;
        }
        setRegistered(true);
        setDevUrl(res.devUrl ?? null);
      }
    } catch {
      setError(t("errUnknown"));
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    setResentMsg(null);
    setError(null);
    const res = await resendVerificationAction({ email, locale });
    if (res.ok) {
      setResentMsg(t("verifyResent"));
      setDevUrl(res.devUrl ?? null);
    } else if (res.error === "rateLimited") {
      setError(t("errRateLimited"));
    } else if (res.error === "notGmail") {
      setError(t("errNotGmail"));
    } else {
      setError(t("errUnknown"));
    }
  }

  const benefits = isLogin
    ? [t("loginBenefit1"), t("loginBenefit2"), t("loginBenefit3"), t("loginBenefit4")]
    : [t("registerBenefit1"), t("registerBenefit2"), t("registerBenefit3"), t("registerBenefit4")];
  const brandTitle = isLogin ? t("loginBrandTitle") : t("registerBrandTitle");
  const brandSub = isLogin ? t("loginBrandSub") : t("registerBrandSub");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left sidebar — fixed 420px */}
      <div className="hidden w-[420px] shrink-0 flex-col border-r border-border bg-sidebar p-10 lg:flex">
        <Link href="/" className="mb-auto flex items-center gap-2.5">
          <Wordmark />
        </Link>
        <div className="mb-auto">
          <p className="mb-3 whitespace-pre-line text-2xl font-bold leading-snug text-foreground">
            {brandTitle}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {brandSub}
          </p>
          <div className="mt-8 space-y-3">
            {benefits.map((b) => (
              <div key={b} className="flex items-center gap-2.5">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                </div>
                <span className="text-sm text-foreground">{b}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">© 2026 Vexa</p>
      </div>

      {/* Right — centered card */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md rounded-xl border border-border bg-card">
          <div className="p-8">
            <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
              <Wordmark />
            </Link>

            {registered ? (
              <div className="text-center">
                <h1 className="mb-2 text-xl font-bold text-foreground">
                  {t("checkEmailTitle")}
                </h1>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t("checkEmailMsg", { email })}
                </p>
                {devUrl && (
                  <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3 text-left">
                    <p className="mb-1 text-xs font-medium text-foreground">
                      {t("devLinkLabel")}
                    </p>
                    <a
                      href={devUrl}
                      className="break-all text-xs text-primary hover:underline"
                    >
                      {devUrl}
                    </a>
                  </div>
                )}
                <Button asChild variant="ghost" size="sm" className="w-full">
                  <Link href="/login">{t("submitLogin")}</Link>
                </Button>
              </div>
            ) : (
              <>
                <h1 className="mb-1 text-xl font-bold text-foreground">
                  {isLogin ? t("loginTitle") : t("registerTitle")}
                </h1>
                <p className="mb-6 text-sm text-muted-foreground">
                  {isLogin ? t("loginSubtitle") : t("registerSubtitle")}
                </p>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={handleGoogle}
                  title={googleEnabled === false ? t("googleUnavailable") : undefined}
                >
                  <GoogleGlyph className="h-[18px] w-[18px]" />
                  {t("continueGoogle")}
                </Button>
                {googleEnabled === false && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {t("googleUnavailable")}
                  </p>
                )}

                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">{t("or")}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
                  {!isLogin && (
                    <Field label={t("name")} type="text" placeholder="luc dao kim" value={name} onChange={setName} />
                  )}
                  <Field label={t("email")} type="email" placeholder="you@gmail.com" value={email} onChange={setEmail} />
                  <Field label={t("password")} type="password" placeholder="••••••••" value={password} onChange={setPassword} />
                  {error && (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  {needVerify && (
                    <button
                      type="button"
                      onClick={handleResend}
                      className="text-left text-xs font-medium text-primary hover:underline"
                    >
                      {t("resendVerification")}
                    </button>
                  )}
                  {resentMsg && (
                    <p className="text-xs text-muted-foreground">{resentMsg}</p>
                  )}
                  {devUrl && (
                    <a href={devUrl} className="break-all text-xs text-primary hover:underline">
                      {devUrl}
                    </a>
                  )}
                  <Button type="submit" size="sm" className="w-full" disabled={pending}>
                    {pending
                      ? t("submitting")
                      : isLogin
                        ? t("submitLogin")
                        : t("createOneFree")}
                  </Button>
                </form>
              </>
            )}

            {!registered && (
              <>
                <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
                  {t("termsNotice")}{" "}
                  <a href="#" className="text-foreground hover:underline">
                    {t("termsOfService")}
                  </a>{" "}
                  {t("and")}{" "}
                  <a href="#" className="text-foreground hover:underline">
                    {t("privacyPolicy")}
                  </a>
                  .
                </p>

                <p className="mt-5 text-center text-sm text-muted-foreground">
                  {isLogin ? t("noAccount") : t("haveAccount")}{" "}
                  <Link
                    href={isLogin ? "/register" : "/login"}
                    className="font-medium text-primary hover:underline"
                  >
                    {isLogin ? t("createOneFree") : t("signUp")}
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
