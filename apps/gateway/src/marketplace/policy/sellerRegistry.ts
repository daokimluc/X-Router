/**
 * Seller registry wiring — seller-supply (#4).
 *
 * Translates listing enable/disable into engine ModelRegistry mappings:
 *   - a DIRECT mapping for the namespaced name (`hoang/gpt-5.5`) → the listing's
 *     provider instance,
 *   - a POOLED mapping under the base model (`gpt-5.5`) so the base name resolves
 *     to every enabled listing (Phase 31 multi-mapping).
 *
 * Mapping ids are derived from the listing id so they can be removed precisely
 * on disable/delete. The engine ModelRegistry stays marketplace-agnostic; this
 * module (marketplace side) drives it.
 */
import type { ModelRegistry } from "../../router/ModelRegistry.js";
import type { ProviderRuntimeRegistry } from "../../provider-runtime/ProviderRuntimeRegistry.js";
import type { SellerListing, SellerService } from "../services/SellerService.js";

function directMappingId(listingId: string): string {
  return `seller_direct_${listingId}`;
}
function pooledMappingId(listingId: string): string {
  return `seller_pool_${listingId}`;
}

function providerTypeOf(registry: ProviderRuntimeRegistry, providerInstanceId: string): string {
  return registry.getProviderInstance(providerInstanceId)?.type ?? "unknown";
}

/** Register both tiers for an enabled listing. Idempotent (removes first). */
export function registerListingMappings(
  modelRegistry: ModelRegistry,
  runtimeRegistry: ProviderRuntimeRegistry,
  listing: SellerListing
): void {
  removeListingMappings(modelRegistry, listing.id);
  const providerType = providerTypeOf(runtimeRegistry, listing.providerInstanceId);

  modelRegistry.register({
    id: directMappingId(listing.id),
    publicModel: listing.namespacedModel,
    providerInstanceId: listing.providerInstanceId,
    providerType,
    upstreamModel: listing.baseModel,
    enabled: true,
    capabilities: ["chat", "streaming"]
  });

  modelRegistry.register({
    id: pooledMappingId(listing.id),
    publicModel: listing.baseModel,
    providerInstanceId: listing.providerInstanceId,
    providerType,
    upstreamModel: listing.baseModel,
    enabled: true,
    capabilities: ["chat", "streaming"]
  });
}

/** Remove both tiers for a listing (safe if absent). */
export function removeListingMappings(modelRegistry: ModelRegistry, listingId: string): void {
  for (const id of [directMappingId(listingId), pooledMappingId(listingId)]) {
    try {
      modelRegistry.deleteById(id);
    } catch {
      // not registered — ignore
    }
  }
}

/** Sync all enabled listings into the registry at boot. */
export function syncAllListings(
  modelRegistry: ModelRegistry,
  runtimeRegistry: ProviderRuntimeRegistry,
  sellerService: SellerService
): void {
  for (const listing of sellerService.listListings()) {
    if (listing.enabled) {
      registerListingMappings(modelRegistry, runtimeRegistry, listing);
    }
  }
}
