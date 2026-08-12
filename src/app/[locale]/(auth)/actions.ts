"use server";

import { headers } from "next/headers";
import {
  createUser,
  setVerifyToken,
  verifyEmailToken,
  checkCredentials,
  isGmail,
} from "@/lib/users";
import { sendVerificationEmail, mailerConfigured } from "@/lib/mailer";
import { rateLimit, sweepExpired } from "@/lib/rate-limit";

/**
 * Account actions. Registration creates an UNVERIFIED user and emails a verify
 * link — it does NOT sign the user in. Sign-in only succeeds after the email is
 * verified (enforced in auth.ts `authorize`). Only Gmail addresses are allowed.
 *
 * All three entry points are rate-limited (see `@/lib/rate-limit`) to blunt
 * password brute-forcing and verification-email bombing.
 */

/** Best-effort client IP for rate-limit keys (behind a proxy: first XFF hop). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

/** Only surface the verify link in the UI in non-production (never in prod). */
const IS_PROD = process.env.NODE_ENV === "production";
function devLink(sent: boolean, url: string): string | undefined {
  return !sent && !IS_PROD ? url : undefined;
}

export type RegisterState =
  | { ok: true; devUrl?: string }
  | { ok: false; error: "invalid" | "notGmail" | "duplicate" | "rateLimited" | "unknown" };

export async function registerAction(input: {
  name: string;
  email: string;
  password: string;
  locale: string;
}): Promise<RegisterState> {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";
  const locale = input.locale === "en" ? "en" : "vi";

  // Throttle by client IP: 5 new accounts per 10 minutes per IP.
  sweepExpired();
  const ip = await clientIp();
  if (!rateLimit(`register:${ip}`, 5, 10 * 60_000).allowed) {
    return { ok: false, error: "rateLimited" };
  }

  if (name.length < 2 || password.length < 8) {
    return { ok: false, error: "invalid" };
  }
  if (!isGmail(email)) {
    return { ok: false, error: "notGmail" };
  }

  const created = await createUser({ name, email, password });
  if (!created.ok) {
    return { ok: false, error: "duplicate" };
  }

  try {
    const { sent, url } = await sendVerificationEmail({
      to: created.email,
      name: created.name,
      token: created.token,
      locale,
    });
    return { ok: true, devUrl: devLink(sent, url) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

export type ResendState =
  | { ok: true; devUrl?: string }
  | { ok: false; error: "notGmail" | "rateLimited" | "unknown" };

export async function resendVerificationAction(input: {
  email: string;
  locale: string;
}): Promise<ResendState> {
  const email = input.email?.trim() ?? "";
  const locale = input.locale === "en" ? "en" : "vi";
  if (!isGmail(email)) return { ok: false, error: "notGmail" };

  // Throttle hard — this triggers an outbound email. 3 per 10 min per email
  // and per IP, so it can't be used to bomb a victim's inbox.
  sweepExpired();
  const ip = await clientIp();
  const key = email.toLowerCase();
  if (
    !rateLimit(`resend:email:${key}`, 3, 10 * 60_000).allowed ||
    !rateLimit(`resend:ip:${ip}`, 10, 10 * 60_000).allowed
  ) {
    return { ok: false, error: "rateLimited" };
  }

  const res = await setVerifyToken(email);
  // Anti-enumeration: do NOT reveal whether the account exists or is already
  // verified. On any non-actionable outcome, return the same generic success
  // the UI shows ("if an account exists, we sent a link"). Only actually send
  // when there is a pending unverified user.
  if (!res.ok) {
    return { ok: true };
  }
  try {
    const { sent, url } = await sendVerificationEmail({
      to: res.email,
      name: res.name,
      token: res.token,
      locale,
    });
    return { ok: true, devUrl: devLink(sent, url) };
  } catch {
    // Don't leak that the address exists via an error, either.
    return { ok: true };
  }
}

export type VerifyState =
  | { ok: true }
  | { ok: false; error: "invalid" | "expired" | "already" };

export async function verifyEmailAction(token: string): Promise<VerifyState> {
  const res = await verifyEmailToken(token);
  if (res.ok) return { ok: true };
  return { ok: false, error: res.reason };
}

/**
 * Diagnose why a credentials sign-in would fail, so the login form can show a
 * precise message (bad credentials vs unverified). The actual session is still
 * created client-side via `signIn("credentials")`.
 */
export type LoginDiagnosis =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unverified" | "notGmail" | "rateLimited" };

export async function diagnoseLoginAction(input: {
  email: string;
  password: string;
}): Promise<LoginDiagnosis> {
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";
  if (!isGmail(email)) return { ok: false, reason: "notGmail" };

  // Brute-force guard: 8 attempts per 5 min per email, 30 per 5 min per IP.
  // The per-email window blunts password guessing; the per-IP window blunts a
  // single host spraying many accounts.
  sweepExpired();
  const ip = await clientIp();
  const key = email.toLowerCase();
  if (
    !rateLimit(`login:email:${key}`, 8, 5 * 60_000).allowed ||
    !rateLimit(`login:ip:${ip}`, 30, 5 * 60_000).allowed
  ) {
    return { ok: false, reason: "rateLimited" };
  }

  const res = await checkCredentials(email, password);
  if (res.ok) return { ok: true };
  return { ok: false, reason: res.reason };
}

/** Expose whether real email delivery is configured (UI hint). */
export async function mailerStatusAction(): Promise<{ configured: boolean }> {
  return { configured: mailerConfigured() };
}
