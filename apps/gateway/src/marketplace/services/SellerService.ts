/**
 * SellerService — seller-supply (#4).
 *
 * Marketplace seller identity + per-seller listings. A seller registers
 * (→ pending), an admin approves (→ approved), and an approved seller's
 * listings become routable supply. A reserved `house` seller (the platform's
 * own supply) is always present and approved.
 *
 * Listings carry a wholesale COST price; the SELL price is derived elsewhere
 * (lowest-cost-routing #5). Seller earnings/commission are applied in #6.
 */

export type SellerStatus = "pending" | "approved" | "suspended";

export type Seller = {
  id: string;
  displayName: string;
  status: SellerStatus;
  /** Opaque string the website maps to a payout account. */
  payoutRef?: string;
  /** Platform commission on this seller's credit (0..1); applied in #6. */
  commissionPct?: number;
  createdAt: string;
};

export type ListingCost = {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
};

export type SellerListing = {
  id: string;
  sellerId: string;
  baseModel: string;
  displayName: string;
  namespacedModel: string;
  costPrice: ListingCost;
  providerInstanceId: string;
  providerAccountId: string;
  enabled: boolean;
  createdAt: string;
};

export type PersistedSellers = {
  sellers: Seller[];
  listings: SellerListing[];
  canonicalBaseModels?: string[];
};

export const HOUSE_SELLER_ID = "house";

const DEFAULT_CANONICAL_MODELS = [
  "gpt-5.5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "gemini-2.5-pro"
];

function houseSeller(): Seller {
  return { id: HOUSE_SELLER_ID, displayName: "house", status: "approved", commissionPct: 0, createdAt: new Date().toISOString() };
}

export class SellerService {
  private readonly sellers = new Map<string, Seller>();
  private readonly listings = new Map<string, SellerListing>();
  private canonicalBaseModels = new Set<string>(DEFAULT_CANONICAL_MODELS);
  private onPersist?: () => void;

  constructor() {
    this.sellers.set(HOUSE_SELLER_ID, houseSeller());
  }

  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  private persist(): void {
    this.onPersist?.();
  }

  // ── Sellers ───────────────────────────────────────────────────────────────

  register(input: { displayName: string; payoutRef?: string; commissionPct?: number }): Seller {
    const id = `seller_${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now().toString(36)}`;
    const seller: Seller = {
      id,
      displayName: input.displayName,
      status: "pending",
      payoutRef: input.payoutRef,
      commissionPct: input.commissionPct,
      createdAt: new Date().toISOString()
    };
    this.sellers.set(id, seller);
    this.persist();
    return structuredClone(seller);
  }

  approve(id: string): Seller | null {
    return this.setStatus(id, "approved");
  }

  suspend(id: string): Seller | null {
    return this.setStatus(id, "suspended");
  }

  /** Reject a pending seller — removes the record (cannot reject house). */
  reject(id: string): boolean {
    if (id === HOUSE_SELLER_ID) return false;
    const ok = this.sellers.delete(id);
    if (ok) this.persist();
    return ok;
  }

  private setStatus(id: string, status: SellerStatus): Seller | null {
    const s = this.sellers.get(id);
    if (!s) return null;
    s.status = status;
    this.persist();
    return structuredClone(s);
  }

  getSeller(id: string): Seller | undefined {
    const s = this.sellers.get(id);
    return s ? structuredClone(s) : undefined;
  }

  listSellers(status?: SellerStatus): Seller[] {
    return Array.from(this.sellers.values())
      .filter((s) => !status || s.status === status)
      .map((s) => structuredClone(s));
  }

  // ── Canonical base models ───────────────────────────────────────────────

  listCanonicalBaseModels(): string[] {
    return Array.from(this.canonicalBaseModels);
  }

  addCanonicalBaseModel(model: string): void {
    this.canonicalBaseModels.add(model);
    this.persist();
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  /**
   * Create a listing for an APPROVED seller. baseModel must be canonical.
   * Throws on a non-approved seller or non-canonical base model.
   */
  createListing(input: {
    sellerId: string;
    baseModel: string;
    costPrice: ListingCost;
    providerInstanceId: string;
    providerAccountId: string;
  }): SellerListing {
    const seller = this.sellers.get(input.sellerId);
    if (!seller) throw new Error(`seller ${input.sellerId} not found`);
    if (seller.status !== "approved") throw new Error(`seller ${input.sellerId} is not approved`);
    if (!this.canonicalBaseModels.has(input.baseModel)) {
      throw new Error(`baseModel ${input.baseModel} is not in the canonical list`);
    }
    const id = `listing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const namespacedModel = `${seller.displayName}/${input.baseModel}`;
    const listing: SellerListing = {
      id,
      sellerId: input.sellerId,
      baseModel: input.baseModel,
      displayName: namespacedModel,
      namespacedModel,
      costPrice: input.costPrice,
      providerInstanceId: input.providerInstanceId,
      providerAccountId: input.providerAccountId,
      enabled: true,
      createdAt: new Date().toISOString()
    };
    this.listings.set(id, listing);
    this.persist();
    return structuredClone(listing);
  }

  setListingEnabled(id: string, enabled: boolean): SellerListing | null {
    const l = this.listings.get(id);
    if (!l) return null;
    l.enabled = enabled;
    this.persist();
    return structuredClone(l);
  }

  deleteListing(id: string): boolean {
    const ok = this.listings.delete(id);
    if (ok) this.persist();
    return ok;
  }

  getListing(id: string): SellerListing | undefined {
    const l = this.listings.get(id);
    return l ? structuredClone(l) : undefined;
  }

  listListings(baseModel?: string): SellerListing[] {
    return Array.from(this.listings.values())
      .filter((l) => !baseModel || l.baseModel === baseModel)
      .map((l) => structuredClone(l));
  }

  /**
   * Cost read model consumed by lowest-cost-routing (#5): all ENABLED listings
   * for a base model whose seller is approved, with their account + cost.
   */
  listingCostFor(baseModel: string): Array<{ listingId: string; accountId: string; providerInstanceId: string; sellerId: string; costPrice: ListingCost }> {
    return Array.from(this.listings.values())
      .filter((l) => l.enabled && l.baseModel === baseModel)
      .filter((l) => this.sellers.get(l.sellerId)?.status === "approved")
      .map((l) => ({
        listingId: l.id,
        accountId: l.providerAccountId,
        providerInstanceId: l.providerInstanceId,
        sellerId: l.sellerId,
        costPrice: structuredClone(l.costPrice)
      }));
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  toPersisted(): PersistedSellers {
    return {
      sellers: this.listSellers(),
      listings: this.listListings(),
      canonicalBaseModels: this.listCanonicalBaseModels()
    };
  }

  load(state: PersistedSellers | undefined | null): void {
    if (!state) return;
    if (Array.isArray(state.sellers) && state.sellers.length > 0) {
      this.sellers.clear();
      for (const s of state.sellers) this.sellers.set(s.id, structuredClone(s));
      // Guarantee house always exists + approved.
      if (!this.sellers.has(HOUSE_SELLER_ID)) this.sellers.set(HOUSE_SELLER_ID, houseSeller());
    }
    if (Array.isArray(state.listings)) {
      this.listings.clear();
      for (const l of state.listings) this.listings.set(l.id, structuredClone(l));
    }
    if (Array.isArray(state.canonicalBaseModels) && state.canonicalBaseModels.length > 0) {
      this.canonicalBaseModels = new Set(state.canonicalBaseModels);
    }
  }
}
