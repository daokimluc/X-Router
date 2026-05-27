import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProxyPoolService } from "./ProxyPoolService.js";
import type { ProxyFetchOptions } from "./types.js";

export function resolveAccountProxyOptions(
  account: ProviderAccount,
  proxyPoolService: ProxyPoolService,
  globalProxy?: ProxyFetchOptions
): ProxyFetchOptions | undefined {
  const proxyPoolId =
    account.proxyPoolId ??
    ((account.metadata as Record<string, unknown> | undefined)?.proxyPoolId as string | undefined);

  if (!proxyPoolId) {
    return globalProxy;
  }

  const pool = proxyPoolService.getById(proxyPoolId);
  if (!pool || !pool.isActive) {
    return globalProxy;
  }

  if (pool.type === "vercel") {
    return {
      enabled: true,
      vercelRelayUrl: pool.proxyUrl,
      noProxy: pool.noProxy || undefined,
      strictProxy: pool.strictProxy
    };
  }

  return {
    enabled: true,
    url: pool.proxyUrl,
    noProxy: pool.noProxy || undefined,
    strictProxy: pool.strictProxy
  };
}
