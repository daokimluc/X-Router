import type {
  XModel,
  XUsageSummary,
  Plan,
  Seller,
  SellerListing,
  ListingMetric,
  MarkupResult,
  WebhookConfig,
} from "./types";
import { MODELS, PLANS, LISTINGS } from "@/lib/data";

// Mock fixtures used when MARKETPLACE_ENABLED is off or X-Router is unreachable.
// Shaped identically to the live responses so the UI never changes.

export const mockModels: XModel[] = MODELS.map((m) => ({
  id: m.name.toLowerCase().replace(/\s+/g, "-"),
  name: m.name,
  provider: m.provider,
  input: m.input,
  output: m.output,
  tag: m.tag,
}));

export const mockUsage: XUsageSummary = {
  totalRequests: 0,
  totalSpend: "$0.00",
  avgLatency: "—",
};

const usd = (s: string) => Number(s.replace(/[^0-9.]/g, "")) || 0;

export const mockPlans: Plan[] = PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  priceUsd: usd(p.priceUsd),
  modelGroups: p.id === "pro" ? ["*"] : [p.id],
  buckets: {
    hourUsd: usd(p.hourUsd),
    dayUsd: usd(p.dayUsd),
    monthUsd: usd(p.monthUsd),
  },
  overageEnabled: false,
}));

export const mockSellers: Seller[] = [
  { id: "house", displayName: "House", status: "approved" },
  { id: "seller_hoang", displayName: "Hoang", status: "approved", commissionPct: 0.08 },
  { id: "seller_cinb", displayName: "Cinb", status: "approved", commissionPct: 0.1 },
];

export const mockListings: SellerListing[] = LISTINGS.map((l, i) => ({
  id: `listing_${i + 1}`,
  sellerId: `seller_${l.seller.toLowerCase()}`,
  baseModel: l.model,
  namespacedModel: l.namespaced,
  costPrice: { inputPerM: usd(l.inputPerM), outputPerM: usd(l.outputPerM) },
  enabled: true,
}));

// Deterministic demo metrics so the card looks alive in dev (MARKETPLACE off).
// Mirrors the real shape incl. the three time horizons; the last listing is left
// with null dynamic metrics to exercise the "no traffic yet" rendering path.
export const mockListingMetrics: ListingMetric[] = mockListings.map((l, i) => {
  const noTraffic = i === mockListings.length - 1;
  const reqs = 40 + i * 37;
  return {
    listingId: l.id,
    sellerId: l.sellerId,
    baseModel: l.baseModel,
    providerInstanceId: `inst_${i + 1}`,
    providerAccountId: `acc_${i + 1}`,
    requests: noTraffic ? 0 : reqs,
    promptTokens: noTraffic ? 0 : reqs * 312,
    completionTokens: noTraffic ? 0 : reqs * 144,
    totalTokens: noTraffic ? 0 : reqs * 456,
    successRate: noTraffic ? null : Math.min(0.999, 0.94 + i * 0.01),
    totalRequestsLifetime: noTraffic ? null : reqs * 12,
    failedRequestsLifetime: noTraffic ? null : Math.round(reqs * 12 * (0.06 - i * 0.01)),
    latencyP50Ms: noTraffic ? null : 90 + i * 25,
    latencyP95Ms: noTraffic ? null : 400 + i * 120,
    rps: noTraffic ? null : Math.round((reqs / 300) * 100) / 100,
  };
});

export const mockMarkup: MarkupResult = { defaultMarkup: 0.15, perModel: {} };

export const mockWebhookConfig: WebhookConfig = {
  enabled: false,
  url: "",
  events: [],
  secretSet: false,
};
