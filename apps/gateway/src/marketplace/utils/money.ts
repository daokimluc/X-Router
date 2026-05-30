/**
 * Money helpers (marketplace layer).
 *
 * The wallet stores integer micro-USD (1 micro-USD = $0.000001) to avoid float
 * drift across millions of sub-cent debits. Conversion happens only at the API
 * boundary. ModelPricingService rounds cost to 6 decimals, so usdToMicro is
 * lossless for any cost it produces.
 */

/** Convert a USD amount (human-facing) to integer micro-USD (storage). */
export function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/** Convert integer micro-USD (storage) back to a USD amount (human-facing). */
export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}
