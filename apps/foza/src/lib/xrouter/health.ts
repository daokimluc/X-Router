import "server-only";
import { xrouterConfig } from "./config";

/**
 * Liveness probe for X-Router. GET /healthz needs no auth (per X-Router answers
 * §F3) and returns {status:"ok"} when the gateway is up. Used so the console can
 * surface an "unreachable" state instead of bare errors. Best-effort: any failure
 * (down, timeout) resolves to false rather than throwing.
 */
export async function isXRouterUp(): Promise<boolean> {
  if (!xrouterConfig.enabled) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${xrouterConfig.url}/healthz`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
