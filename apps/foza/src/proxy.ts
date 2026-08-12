import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { getToken } from "next-auth/jwt";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

const LOCALES = routing.locales;
const localeAlt = `(?:${LOCALES.join("|")})`;
const CONSOLE_RE = new RegExp(`^/${localeAlt}/console(?:/.*)?$`);
const AUTH_RE = new RegExp(`^/${localeAlt}/(?:login|register)/?$`);

function localeOf(pathname: string): string {
  const seg = pathname.split("/")[1];
  return (LOCALES as readonly string[]).includes(seg)
    ? seg
    : routing.defaultLocale;
}

export default async function proxy(request: NextRequest) {
  // 1) Let next-intl resolve locale first (may redirect/rewrite).
  const intlResponse = intlMiddleware(request);

  // If next-intl is already redirecting (e.g. adding a locale prefix), respect it.
  if (intlResponse.headers.get("location")) {
    return intlResponse;
  }

  const { pathname, search } = request.nextUrl;
  const locale = localeOf(pathname);

  // Only decode the Auth.js JWT when the path is actually gated — avoids the
  // work on every asset/page. Optimistic check (cookie only), per Next.js guidance.
  const gated = CONSOLE_RE.test(pathname) || AUTH_RE.test(pathname);
  const token = gated
    ? await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: request.nextUrl.protocol === "https:",
      })
    : null;
  const authed = Boolean(token);

  // 2) Protect the console: unauthenticated → /{locale}/login?next=<path>
  if (CONSOLE_RE.test(pathname) && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(url);
    copyIntlCookies(intlResponse, redirect);
    return redirect;
  }

  // 3) Authenticated users shouldn't see login/register → /{locale}/console
  if (AUTH_RE.test(pathname) && authed) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/console`;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    copyIntlCookies(intlResponse, redirect);
    return redirect;
  }

  return intlResponse;
}

/** Preserve any cookies next-intl set (e.g. NEXT_LOCALE) on our redirect. */
function copyIntlCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
