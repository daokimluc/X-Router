// Types for the X-Router marketplace integration, matching the field names in
// D:\Project\Accountrouter\docs\MARKETPLACE_INTEGRATION.md exactly.

export type XModel = {
  id: string;
  name: string;
  provider: string;
  input: string;
  output: string;
  tag: string;
};

export type XUsageSummary = {
  totalRequests: number;
  totalSpend: string;
  avgLatency: string;
};

// ---- Provision command inputs/outputs (website → x-router) ----

/** POST /provision/key */
export type CreateKeyInput = { label?: string; planId?: string };
export type CreateKeyResult = { id: string; key: string; planId: string | null };

/** Key lifecycle (marketplace-lifecycle #3, provision key) */
export type KeyToggleResult = { id: string; enabled: boolean };
export type KeyPatchResult = { id: string; enabled: boolean; expiresAt: string | null };
export type KeyRevokeResult = { id: string; revoked: boolean };
/** GET /provision/keys?owner= (Phase 34d: includes walletUsd + provisioned) */
export type ProvisionedKey = {
  id: string;
  owner: string | null;
  enabled: boolean;
  expiresAt: string | null;
  planId: string | null;
  walletUsd: number;
  provisioned: boolean;
  /** Subscription period end, epoch-ms | null (v0.5.0+). */
  planPeriodEnd?: number | null;
  planChargedAt?: number | null;
  /** Compact token-pack list for the keys page (v0.6.0+). */
  tokenPacks?: Array<{ baseModel: string; tokensRemaining: number; expiresAt: number | null }>;
};
export type ListKeysResult = { keys: ProvisionedKey[] };

/** POST /provision/grant. planId=null cancels the subscription (clears all 3 plan fields). */
export type GrantPlanInput = {
  keyId: string;
  planId: string | null;
  overageEnabled?: boolean;
  paygDailyLimitUsd?: number;
};
export type GrantPlanResult = {
  id: string;
  planId: string | null;
  overageEnabled: boolean | null;
  paygDailyLimitUsd: number | null;
  /** Epoch-ms of the current period end (null = Free / no cycle). v0.5.0+. */
  planPeriodEnd?: number | null;
  /** Epoch-ms of the last charge (null = never charged). v0.5.0+. */
  planChargedAt?: number | null;
  walletUsd?: number;
  idempotent?: boolean;
};

/** POST /provision/wallet/topup. idempotencyKey (v0.6.3+) makes a re-credit a no-op. */
export type WalletTopupInput = { keyId: string; usd: number; idempotencyKey?: string };
export type WalletTopupResult = { keyId: string; walletUsd: number; idempotent?: boolean };

/** PUT /provision/markup */
export type MarkupInput = {
  defaultMarkup?: number;
  perModel?: Record<string, number>;
};
export type MarkupResult = {
  defaultMarkup: number;
  perModel: Record<string, number>;
};

/** POST /provision/seller, /:id/approve, /:id/suspend */
export type CreateSellerInput = {
  displayName: string;
  payoutRef?: string;
  commissionPct?: number;
};
export type Seller = {
  id: string;
  displayName: string;
  status: "pending" | "approved" | "suspended";
  payoutRef?: string;
  commissionPct?: number;
};
export type SellerResult = { seller: Seller };

/** POST /provision/listing, PATCH/DELETE /provision/listing/:id */
export type CreateListingInput = {
  sellerId: string;
  baseModel: string;
  costPrice: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
  providerInstanceId: string;
  providerAccountId: string;
};

/** GET /admin/v1/provider-instances (admin) — for the listing-create dropdowns. */
export type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
};

/** GET /admin/v1/accounts (admin) — provider accounts for the dropdowns. */
export type ProviderAccount = {
  id: string;
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  status: string;
};
export type Listing = {
  id: string;
  namespacedModel: string;
  sellerId?: string;
  baseModel?: string;
  enabled?: boolean;
};
export type ListingResult = { listing: Listing };

/** POST /provision/earnings/:sellerId/mark-paid */
export type MarkPaidInput = { usd: number; payoutRef?: string };
export type EarningsSnapshot = {
  sellerId: string;
  day: number;
  month: number;
  lifetime: number;
  unpaid: number;
};

// ---- Provision read-side (website ← x-router, GET, provision key) ----

/** GET /provision/wallet/:keyId */
export type WalletRead = {
  keyId: string;
  walletUsd: number;
  provisioned: boolean;
  /** Subscription fields (v0.5.0+); epoch-ms, null = Free/no cycle. */
  planId?: string | null;
  planPeriodEnd?: number | null;
  planChargedAt?: number | null;
};

/** GET /provision/earnings/platform */
export type PlatformEarnings = { platformMarginUsd: number };

/** GET /provision/plans → { plans } */
export type Plan = {
  id: string;
  name: string;
  priceUsd: number;
  modelGroups: string[];
  /**
   * Expanded concrete model list for display (X-Router v0.4.4+). `["*"]` means
   * grant-all (render "all models"); otherwise the actual models the plan grants.
   * Optional: older gateways omit it — callers fall back to `modelGroups`.
   */
  models?: string[];
  buckets: { hourUsd: number; dayUsd: number; monthUsd: number };
  overageEnabled: boolean;
  paygDailyLimitUsd?: number;
};

/** Body for POST/PATCH /admin/v1/plans (admin key). id optional on create. */
export type PlanInput = {
  id?: string;
  name: string;
  priceUsd: number;
  modelGroups: string[];
  buckets: { hourUsd: number; dayUsd: number; monthUsd: number };
  overageEnabled: boolean;
  paygDailyLimitUsd?: number;
};

/** GET /provision/sellers → { sellers } (Seller defined below) */

/** GET /provision/listings?baseModel= → { listings } */
export type SellerListing = {
  id: string;
  sellerId: string;
  baseModel: string;
  namespacedModel: string;
  costPrice: { inputPerM: number; outputPerM: number; cachedInputPerM?: number };
  enabled: boolean;
};

/**
 * GET /provision/listings/metrics → per-listing card metrics.
 * THREE different time horizons live in one row — never blend them into one
 * number (read `meta`):
 *  - requests / *Tokens: settlement window (`since`), reversed excluded
 *  - successRate / *Lifetime: cumulative LIFETIME per account (null if never used)
 *  - latency p50/p95 + rps: rolling 5-min in-memory (null if no recent traffic)
 * Any metric without a source is `null` — never a fake 100%/0.
 */
export type ListingMetric = {
  listingId: string;
  sellerId: string;
  baseModel: string;
  providerInstanceId: string;
  providerAccountId: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  successRate: number | null;
  totalRequestsLifetime: number | null;
  failedRequestsLifetime: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  rps: number | null;
};

export type ListingMetricsResponse = {
  meta: {
    settlementWindowSince: string | null;
    successHorizon: string; // "lifetime"
    latencyWindowSeconds: number; // 300
  };
  metrics: ListingMetric[];
};

/**
 * Prepaid token pack (X-Router v0.6.0). One pack = one baseModel; price locked
 * at purchase. `expiresAt`/`createdAt` are epoch-ms. Field names follow the
 * SHIPPED shape (id, tokensTotal — NOT packId/tokens).
 */
export type TokenPack = {
  id: string;
  keyId: string;
  baseModel: string;
  tokensTotal: number;
  tokensRemaining: number;
  pricePaidUsd: number;
  expiresAt: number | null;
  createdAt: number;
  idempotencyKey: string;
};

/** POST /provision/token-pack body (Foza calls AFTER collecting payment). */
export type TokenPackGrantInput = {
  keyId: string;
  baseModel: string;
  tokens: number;
  pricePaidUsd: number;
  expiresAt: number; // epoch-ms, must be future
  idempotencyKey: string;
};

/** POST /provision/token-pack → { grant: TokenPack }. */
export type TokenPackGrantResult = { grant: TokenPack };
/** GET /provision/token-packs?keyId= → { keyId, tokenPacks: TokenPack[] }. */
export type TokenPacksResult = { keyId: string; tokenPacks: TokenPack[] };

/** GET /provision/usage → { data, total } (reconciliation-grade, NOT settlement replay) */
export type UsageRecord = {
  requestId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  apiKeyHash?: string;
  createdAt: string;
};
export type UsagePage = { data: UsageRecord[]; total: number };

/**
 * GET /provision/settlements → per-record money replay (Phase 34d). Each row is
 * recorded (not estimated): collected = sellerCredit + platformMargin.
 */
export type SettlementRecord = {
  settlementId: string;
  requestId?: string;
  buyerKeyId: string;
  sellerId: string;
  baseModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  collected: number;
  sellerCredit: number;
  platformMargin: number;
  billTrack?: "plan" | "payg";
  reversed?: boolean;
  /** Epoch-ms when the row was reversed, or null/undefined if not reversed (v0.6.3+). */
  reversedAt?: number | null;
  createdAt?: string;
};
export type SettlementPage = { data: SettlementRecord[]; total: number };

/**
 * Raw row shape as X-Router's GET /provision/settlements actually returns it:
 * `id` (= settlementId) and `ts` (epoch ms). The adapter maps this to
 * SettlementRecord so callers use the stable contract names.
 */
export type RawSettlementRow = {
  id: string;
  requestId: string | null;
  ts: number;
  buyerKeyId: string | null;
  baseModel: string | null;
  sellerId: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  collected: number;
  sellerCredit: number;
  platformMargin: number;
  billTrack: string | null;
  reversed: boolean;
  reversedAt?: number | null;
};

/** GET/PUT /provision/webhook (secret masked on read) */
export type WebhookConfig = {
  enabled: boolean;
  url: string;
  events: string[];
  secretSet: boolean;
  secret?: string;
};
export type WebhookConfigInput = {
  enabled?: boolean;
  url?: string;
  secret?: string;
  events?: string[];
};

// ---- Business webhook events (x-router → website) ----

export type BusinessEvent =
  | "usage.recorded"
  | "quota.blocked"
  | "wallet.low"
  | "grant.exhausted"
  | "supply.unhealthy"
  | "plan.renewed"
  | "plan.downgraded"
  | "settlement.reversed";

export type WebhookEnvelope<T = unknown> = {
  event: BusinessEvent;
  timestamp: string;
  data: T;
};

export type UsageRecordedData = {
  /** Stable settlement id (stl_<uuid>) — idempotency key (Phase 34d.1). */
  settlementId?: string;
  /** Request id — join key to GET /provision/usage (Phase 34d.1). */
  requestId?: string;
  buyerKeyId: string;
  buyerKeyHash: string;
  baseModel: string;
  sellerId: string;
  promptTokens: number;
  completionTokens: number;
  actualSellCost: number;
  sellerCredit: number;
  platformMargin: number;
  billTrack: "plan" | "payg";
};

export type QuotaBlockedData = {
  keyId: string;
  httpStatus: number;
  reason: string;
  model: string | null;
};

export type WalletLowData = {
  keyId: string;
  balanceUsd: number;
  thresholdUsd: number;
};

export type GrantExhaustedData = {
  keyId: string;
  planId: string | null;
  group: string | null;
  monthUsd: number;
};

/** plan.renewed — a paid plan auto-renewed for a new month (v0.5.0+). */
export type PlanRenewedData = {
  keyId: string;
  planId: string;
  priceUsd: number;
  periodEnd: number; // epoch-ms
  walletUsd: number;
};

/** plan.downgraded — renewal underfunded → key dropped to Free (v0.5.0+). */
export type PlanDowngradedData = {
  keyId: string;
  fromPlanId: string;
  reason: string; // "renewal_underfunded"
  walletUsd: number;
};

/**
 * settlement.reversed — a settled request was reversed/refunded (v0.6.3+). The
 * website unwinds its mirrored buyer-spend / seller-payable / margin. Idempotent
 * on `settlementId` (gateway emits once per real transition; dedupe anyway).
 */
export type SettlementReversedData = {
  settlementId: string;
  buyerKeyId: string;
  sellerId: string;
  collected: number;
  sellerCredit: number;
  platformMargin: number;
  billTrack: "plan" | "payg" | "tokenpack";
  reason: string | null;
  reversedAt: number; // epoch-ms
};

export type SupplyUnhealthyData = {
  sellerId: string;
  providerAccountId: string;
  reason: string;
};

export class XRouterError extends Error {
  constructor(
    message: string,
    public status?: number,
    /** Machine-readable error code from X-Router's `{ error: { code } }` body
     *  (e.g. "insufficient_funds", "amount_too_large", "amount_exceeds_unpaid").
     *  Prefer branching on this over the human message. */
    public code?: string,
  ) {
    super(message);
    this.name = "XRouterError";
  }
}

/** Thrown when X-Router rate-limits a provision route and retries are exhausted. */
export class XRouterRateLimitError extends XRouterError {
  constructor(message = "X-Router rate limit exceeded") {
    super(message, 429, "provision_rate_limit_exceeded");
    this.name = "XRouterRateLimitError";
  }
}
