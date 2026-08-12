import "server-only";
import { xrouterConfig } from "./config";
import { xrouterFetch } from "./client";
import {
  mockModels,
  mockUsage,
  mockPlans,
  mockSellers,
  mockListings,
  mockListingMetrics,
  mockMarkup,
  mockWebhookConfig,
} from "./mock";
import { ledger } from "./ledger";
import type {
  XModel,
  XUsageSummary,
  CreateKeyInput,
  CreateKeyResult,
  KeyToggleResult,
  KeyPatchResult,
  KeyRevokeResult,
  ProvisionedKey,
  ListKeysResult,
  GrantPlanInput,
  GrantPlanResult,
  WalletTopupInput,
  WalletTopupResult,
  MarkupInput,
  MarkupResult,
  CreateSellerInput,
  SellerResult,
  CreateListingInput,
  ListingResult,
  ListingMetric,
  ListingMetricsResponse,
  TokenPackGrantInput,
  TokenPackGrantResult,
  TokenPacksResult,
  ProviderInstance,
  ProviderAccount,
  MarkPaidInput,
  EarningsSnapshot,
  WalletRead,
  PlatformEarnings,
  Plan,
  PlanInput,
  Seller,
  SellerListing,
  UsagePage,
  SettlementPage,
  RawSettlementRow,
  WebhookConfig,
  WebhookConfigInput,
} from "./types";
import { XRouterError } from "./types";

// X-Router's OpenAI-standard /v1/public/models response.
type XModelsResponse = {
  object: "list";
  data: Array<{ id: string; object: string; owned_by?: string }>;
};

/**
 * The single integration seam between Foza and X-Router.
 * - Reads (models): public /v1/* — fall back to mock on failure.
 * - Provision writes: /provision/* with the provision key — surface typed errors.
 * - Usage: arrives via the usage.recorded webhook into Foza's ledger, not pulled.
 */
export const xrouter = {
  // ---- Reads ----

  async listModels(): Promise<XModel[]> {
    if (!xrouterConfig.enabled) return mockModels;
    try {
      const res = await xrouterFetch<XModelsResponse>("/v1/public/models", {
        auth: "internal",
      });
      return res.data.map((m) => {
        const known = mockModels.find((k) => k.id === m.id || k.name === m.id);
        return (
          known ?? {
            id: m.id,
            name: m.id,
            provider: m.owned_by ?? "—",
            input: "—",
            output: "—",
            tag: "",
          }
        );
      });
    } catch {
      return mockModels;
    }
  },

  /**
   * Aggregate usage summary. The realtime source is the in-memory ledger (fed by
   * usage.recorded webhooks); the reconciliation sweep tops it up from
   * /provision/usage. Mock summary only when disabled.
   */
  async getUsage(): Promise<XUsageSummary> {
    if (!xrouterConfig.enabled) return mockUsage;
    const s = ledger.summary();
    return {
      totalRequests: s.totalRequests,
      totalSpend: `$${s.totalSpendUsd.toFixed(2)}`,
      avgLatency: "—",
    };
  },

  // ---- Provision reads (website ← X-Router, GET, provision key) ----

  async getWallet(keyId: string): Promise<WalletRead> {
    if (!xrouterConfig.enabled) {
      return { keyId, walletUsd: 0, provisioned: false };
    }
    return read(`/provision/wallet/${encodeURIComponent(keyId)}`, {
      keyId,
      walletUsd: 0,
      provisioned: false,
    });
  },

  async getEarnings(sellerId: string): Promise<EarningsSnapshot> {
    const fallback: EarningsSnapshot = { sellerId, day: 0, month: 0, lifetime: 0, unpaid: 0 };
    if (!xrouterConfig.enabled) return fallback;
    return read(`/provision/earnings/${encodeURIComponent(sellerId)}`, fallback);
  },

  async getPlatformMargin(): Promise<PlatformEarnings> {
    if (!xrouterConfig.enabled) return { platformMarginUsd: 0 };
    return read("/provision/earnings/platform", { platformMarginUsd: 0 });
  },

  async listPlans(): Promise<Plan[]> {
    if (!xrouterConfig.enabled) return mockPlans;
    const res = await read<{ plans: Plan[] }>("/provision/plans", { plans: mockPlans });
    return res.plans;
  },

  async listSellers(status?: "pending" | "approved" | "suspended"): Promise<Seller[]> {
    if (!xrouterConfig.enabled) {
      return status ? mockSellers.filter((s) => s.status === status) : mockSellers;
    }
    const qs = status ? `?status=${status}` : "";
    const res = await read<{ sellers: Seller[] }>(`/provision/sellers${qs}`, {
      sellers: mockSellers,
    });
    return res.sellers;
  },

  async listListings(baseModel?: string): Promise<SellerListing[]> {
    if (!xrouterConfig.enabled) {
      return baseModel ? mockListings.filter((l) => l.baseModel === baseModel) : mockListings;
    }
    const qs = baseModel ? `?baseModel=${encodeURIComponent(baseModel)}` : "";
    const res = await read<{ listings: SellerListing[] }>(`/provision/listings${qs}`, {
      listings: mockListings,
    });
    return res.listings;
  },

  /**
   * Per-listing card metrics (GET /provision/listings/metrics). Provision-scope.
   * Returns one row per listing; metrics carry THREE time horizons (see
   * ListingMetric) — the caller must label them, not blend them. Missing values
   * are null (never a fake 100%/0). Mock fallback returns demo numbers in dev.
   */
  async listListingsMetrics(opts?: {
    baseModel?: string;
    since?: string;
  }): Promise<ListingMetric[]> {
    if (!xrouterConfig.enabled) {
      return opts?.baseModel
        ? mockListingMetrics.filter((m) => m.baseModel === opts.baseModel)
        : mockListingMetrics;
    }
    const params = new URLSearchParams();
    if (opts?.baseModel) params.set("baseModel", opts.baseModel);
    if (opts?.since) params.set("since", opts.since);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await read<ListingMetricsResponse>(
      `/provision/listings/metrics${qs}`,
      { meta: { settlementWindowSince: null, successHorizon: "lifetime", latencyWindowSeconds: 300 }, metrics: [] },
    );
    return res.metrics;
  },

  /**
   * Grant a prepaid token pack (POST /provision/token-pack). Foza calls this
   * ONLY after collecting payment; idempotent on `idempotencyKey` (a retried
   * payment webhook returns the same pack, never a second grant).
   */
  async grantTokenPack(input: TokenPackGrantInput): Promise<TokenPackGrantResult> {
    if (!xrouterConfig.enabled) {
      return {
        grant: {
          id: `pack_mock_${input.idempotencyKey}`,
          keyId: input.keyId,
          baseModel: input.baseModel,
          tokensTotal: input.tokens,
          tokensRemaining: input.tokens,
          pricePaidUsd: input.pricePaidUsd,
          expiresAt: input.expiresAt,
          createdAt: Date.now(),
          idempotencyKey: input.idempotencyKey,
        },
      };
    }
    return write("/provision/token-pack", "POST", input);
  },

  /** List a key's token packs (GET /provision/token-packs?keyId=). */
  async listTokenPacks(keyId: string): Promise<TokenPacksResult> {
    if (!xrouterConfig.enabled) return { keyId, tokenPacks: [] };
    return read(`/provision/token-packs?keyId=${encodeURIComponent(keyId)}`, {
      keyId,
      tokenPacks: [],
    });
  },

  async getMarkup(): Promise<MarkupResult> {
    if (!xrouterConfig.enabled) return mockMarkup;
    return read("/provision/markup", mockMarkup);
  },

  /** Reconciliation-grade usage records (NOT settlement replay). */
  async getUsageSince(
    since: string,
    keyId?: string,
    limit = 200,
  ): Promise<UsagePage> {
    if (!xrouterConfig.enabled) return { data: [], total: 0 };
    const params = new URLSearchParams({ since, limit: String(limit) });
    if (keyId) params.set("keyId", keyId);
    return read(`/provision/usage?${params.toString()}`, { data: [], total: 0 });
  },

  /**
   * Per-record settlement replay (Phase 34d) — the money-accurate source for
   * reconciliation. Each row carries collected/sellerCredit/platformMargin/
   * settlementId/reversed. Filter by since/keyId/sellerId.
   *
   * NOTE: X-Router returns rows shaped `{id, ts, ...}` (id = settlementId, ts =
   * epoch ms). We map them to the SettlementRecord contract (`settlementId`,
   * `createdAt` ISO) so reconcile keys + checkpoints work correctly.
   */
  async getSettlements(opts: {
    since?: string;
    reversedSince?: string;
    keyId?: string;
    sellerId?: string;
    limit?: number;
  } = {}): Promise<SettlementPage> {
    if (!xrouterConfig.enabled) return { data: [], total: 0 };
    const params = new URLSearchParams({ limit: String(opts.limit ?? 500) });
    if (opts.since) params.set("since", opts.since);
    if (opts.reversedSince) params.set("reversedSince", opts.reversedSince);
    if (opts.keyId) params.set("keyId", opts.keyId);
    if (opts.sellerId) params.set("sellerId", opts.sellerId);
    const raw = await read<{ data: RawSettlementRow[]; total: number }>(
      `/provision/settlements?${params.toString()}`,
      { data: [], total: 0 },
    );
    return {
      total: raw.total,
      data: raw.data.map((r) => ({
        settlementId: r.id,
        requestId: r.requestId ?? undefined,
        buyerKeyId: r.buyerKeyId ?? "",
        sellerId: r.sellerId ?? "",
        baseModel: r.baseModel ?? undefined,
        promptTokens: r.promptTokens ?? undefined,
        completionTokens: r.completionTokens ?? undefined,
        collected: r.collected,
        sellerCredit: r.sellerCredit,
        platformMargin: r.platformMargin,
        billTrack: (r.billTrack as "plan" | "payg" | undefined) ?? undefined,
        reversed: r.reversed,
        reversedAt: r.reversedAt ?? null,
        createdAt:
          typeof r.ts === "number" ? new Date(r.ts).toISOString() : undefined,
      })),
    };
  },

  async getWebhookConfig(): Promise<WebhookConfig> {
    if (!xrouterConfig.enabled) return mockWebhookConfig;
    return read("/provision/webhook", mockWebhookConfig);
  },

  async setWebhookConfig(input: WebhookConfigInput): Promise<WebhookConfig> {
    if (!xrouterConfig.enabled) return { ...mockWebhookConfig, ...input, secretSet: !!input.secret };
    return write("/provision/webhook", "PUT", input);
  },

  // ---- Provision commands (website → X-Router) ----

  async createKey(input: CreateKeyInput): Promise<CreateKeyResult> {
    if (!xrouterConfig.enabled) {
      return { id: "mock-" + Date.now(), key: "igw_mock_xxxx", planId: input.planId ?? null };
    }
    return write("/provision/key", "POST", input);
  },

  /** List keys for an owner → GET /provision/keys?owner= (incl. walletUsd, provisioned). */
  async listKeys(owner: string): Promise<ProvisionedKey[]> {
    if (!xrouterConfig.enabled) return [];
    const res = await read<ListKeysResult>(
      `/provision/keys?owner=${encodeURIComponent(owner)}`,
      { keys: [] },
    );
    return res.keys;
  },

  /** Disable/enable a key → POST /provision/key/:id/(disable|enable). */
  async setKeyEnabled(keyId: string, enabled: boolean): Promise<KeyToggleResult> {
    if (!xrouterConfig.enabled) return { id: keyId, enabled };
    const action = enabled ? "enable" : "disable";
    return write(`/provision/key/${encodeURIComponent(keyId)}/${action}`, "POST", {});
  },

  /** Patch a key (enabled / expiresAt) → PATCH /provision/key/:id. */
  async patchKey(
    keyId: string,
    patch: { enabled?: boolean; expiresAt?: string | null },
  ): Promise<KeyPatchResult> {
    if (!xrouterConfig.enabled) {
      return { id: keyId, enabled: patch.enabled ?? true, expiresAt: patch.expiresAt ?? null };
    }
    return write(`/provision/key/${encodeURIComponent(keyId)}`, "PATCH", patch);
  },

  /** Soft-revoke a key → DELETE /provision/key/:id. */
  async revokeKey(keyId: string): Promise<KeyRevokeResult> {
    if (!xrouterConfig.enabled) return { id: keyId, revoked: true };
    return write(`/provision/key/${encodeURIComponent(keyId)}`, "DELETE");
  },

  /** Rotate a key's secret → POST /provision/key/:id/rotate (new plaintext once). */
  async rotateKey(keyId: string): Promise<CreateKeyResult> {
    if (!xrouterConfig.enabled) {
      return { id: keyId, key: "igw_mock_rotated", planId: null };
    }
    return write(`/provision/key/${encodeURIComponent(keyId)}/rotate`, "POST", {});
  },

  async grantPlan(input: GrantPlanInput): Promise<GrantPlanResult> {
    if (!xrouterConfig.enabled) {
      return {
        id: input.keyId,
        planId: input.planId,
        overageEnabled: input.overageEnabled ?? false,
        paygDailyLimitUsd: input.paygDailyLimitUsd ?? null,
      };
    }
    return write("/provision/grant", "POST", input);
  },

  async topUpWallet(input: WalletTopupInput): Promise<WalletTopupResult> {
    if (!xrouterConfig.enabled) {
      return { keyId: input.keyId, walletUsd: input.usd };
    }
    return write("/provision/wallet/topup", "POST", input);
  },

  async setMarkup(input: MarkupInput): Promise<MarkupResult> {
    if (!xrouterConfig.enabled) {
      return { defaultMarkup: input.defaultMarkup ?? 0.15, perModel: input.perModel ?? {} };
    }
    return write("/provision/markup", "PUT", input);
  },

  async createSeller(input: CreateSellerInput): Promise<SellerResult> {
    if (!xrouterConfig.enabled) {
      return {
        seller: { id: "seller_mock", displayName: input.displayName, status: "pending" },
      };
    }
    return write("/provision/seller", "POST", input);
  },

  async approveSeller(id: string): Promise<SellerResult> {
    if (!xrouterConfig.enabled) {
      return { seller: { id, displayName: id, status: "approved" } };
    }
    return write(`/provision/seller/${encodeURIComponent(id)}/approve`, "POST", {});
  },

  async suspendSeller(id: string): Promise<SellerResult> {
    if (!xrouterConfig.enabled) {
      return { seller: { id, displayName: id, status: "suspended" } };
    }
    return write(`/provision/seller/${encodeURIComponent(id)}/suspend`, "POST", {});
  },

  async createListing(input: CreateListingInput): Promise<ListingResult> {
    if (!xrouterConfig.enabled) {
      return {
        listing: {
          id: "listing_mock",
          namespacedModel: `${input.sellerId}/${input.baseModel}`,
          sellerId: input.sellerId,
          baseModel: input.baseModel,
          enabled: true,
        },
      };
    }
    return write("/provision/listing", "POST", input);
  },

  async setListingEnabled(id: string, enabled: boolean): Promise<ListingResult> {
    if (!xrouterConfig.enabled) {
      return { listing: { id, namespacedModel: "", enabled } };
    }
    return write(`/provision/listing/${encodeURIComponent(id)}`, "PATCH", { enabled });
  },

  async deleteListing(id: string): Promise<{ deleted: string }> {
    if (!xrouterConfig.enabled) return { deleted: id };
    return write(`/provision/listing/${encodeURIComponent(id)}`, "DELETE");
  },

  async markEarningsPaid(
    sellerId: string,
    input: MarkPaidInput,
  ): Promise<EarningsSnapshot> {
    if (!xrouterConfig.enabled) {
      return { sellerId, day: 0, month: 0, lifetime: 0, unpaid: 0 };
    }
    return write(
      `/provision/earnings/${encodeURIComponent(sellerId)}/mark-paid`,
      "POST",
      input,
    );
  },

  // ---- Admin commands (/admin/v1/*, admin key — gated by FOZA_ADMIN_EMAILS) ----

  /** Create a plan → POST /admin/v1/plans. */
  async createPlan(input: PlanInput): Promise<{ plan: Plan }> {
    return adminWrite("/admin/v1/plans", "POST", input);
  },

  /** Update a plan → PATCH /admin/v1/plans/:id. */
  async updatePlan(id: string, input: Partial<PlanInput>): Promise<{ plan: Plan }> {
    return adminWrite(`/admin/v1/plans/${encodeURIComponent(id)}`, "PATCH", input);
  },

  /** Delete a plan → DELETE /admin/v1/plans/:id. */
  async deletePlan(id: string): Promise<{ deleted: string }> {
    return adminWrite(`/admin/v1/plans/${encodeURIComponent(id)}`, "DELETE");
  },

  /**
   * Clear (or set) a key's plan → PATCH /admin/v1/keys/:id/plan. Pass planId=null
   * to remove the plan (used by plan cancellation so X-Router state matches Foza).
   */
  async setKeyPlan(
    keyId: string,
    planId: string | null,
    overageEnabled?: boolean,
  ): Promise<{ id: string; planId: string | null }> {
    if (!xrouterConfig.enabled) return { id: keyId, planId };
    return adminWrite(`/admin/v1/keys/${encodeURIComponent(keyId)}/plan`, "PATCH", {
      planId,
      ...(overageEnabled === undefined ? {} : { overageEnabled }),
    });
  },

  /** Reject a pending seller → POST /admin/v1/sellers/:id/reject. */
  async rejectSeller(id: string): Promise<{ rejected: string }> {
    return adminWrite(`/admin/v1/sellers/${encodeURIComponent(id)}/reject`, "POST", {});
  },

  /** Edit seller terms → PATCH /admin/v1/sellers/:id. */
  async updateSellerTerms(
    id: string,
    patch: { commissionPct?: number; payoutRef?: string },
  ): Promise<{ seller: Seller }> {
    return adminWrite(`/admin/v1/sellers/${encodeURIComponent(id)}`, "PATCH", patch);
  },

  /** List canonical base models → GET /admin/v1/canonical-models. */
  async listCanonicalModels(): Promise<string[]> {
    if (!xrouterConfig.enabled) return [];
    const res = await adminRead<{ models: string[] }>("/admin/v1/canonical-models", { models: [] });
    return res.models;
  },

  /** Add a canonical base model → POST /admin/v1/canonical-models. */
  async addCanonicalModel(model: string): Promise<{ models: string[] }> {
    return adminWrite("/admin/v1/canonical-models", "POST", { model });
  },

  /** Remove a canonical base model → DELETE /admin/v1/canonical-models/:model. */
  async removeCanonicalModel(model: string): Promise<{ models: string[] }> {
    return adminWrite(`/admin/v1/canonical-models/${encodeURIComponent(model)}`, "DELETE");
  },

  /** List provider instances → GET /admin/v1/provider-instances (for listing dropdowns). */
  async listProviderInstances(): Promise<ProviderInstance[]> {
    if (!xrouterConfig.enabled) return [];
    const res = await adminRead<{ data: ProviderInstance[] }>(
      "/admin/v1/provider-instances",
      { data: [] },
    );
    return res.data ?? [];
  },

  /** List provider accounts → GET /admin/v1/accounts (for listing dropdowns). */
  async listProviderAccounts(): Promise<ProviderAccount[]> {
    if (!xrouterConfig.enabled) return [];
    const res = await adminRead<{ data: ProviderAccount[] }>("/admin/v1/accounts", {
      data: [],
    });
    return res.data ?? [];
  },
};

/** Provision writes do NOT fall back silently — surface the error to the caller. */
async function write<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  try {
    return await xrouterFetch<T>(path, {
      method,
      auth: "provision",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw err instanceof XRouterError ? err : new XRouterError(`provision ${path} failed`);
  }
}

/** Admin writes use the admin key. No silent mock — surface the error. */
async function adminWrite<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  try {
    return await xrouterFetch<T>(path, {
      method,
      auth: "admin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw err instanceof XRouterError ? err : new XRouterError(`admin ${path} failed`);
  }
}

/** Admin reads fall back to the supplied default if the gateway is unreachable. */
async function adminRead<T>(path: string, fallback: T): Promise<T> {
  try {
    return await xrouterFetch<T>(path, { auth: "admin" });
  } catch {
    return fallback;
  }
}

/**
 * Provision reads fall back to the supplied mock on failure so the console stays
 * alive if X-Router is briefly unreachable (the realtime ledger remains the
 * authoritative source for usage; reads are authoritative for wallet/earnings/etc).
 */
async function read<T>(path: string, fallback: T): Promise<T> {
  try {
    return await xrouterFetch<T>(path, { auth: "provision" });
  } catch {
    return fallback;
  }
}
