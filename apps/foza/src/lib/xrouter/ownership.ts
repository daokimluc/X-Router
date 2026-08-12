import "server-only";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";

/**
 * Ownership guard. X-Router performs NO tenant isolation — it executes any
 * keyId/sellerId/listingId passed on a /provision/* call. Foza is the trust
 * boundary and MUST verify a client-supplied resource id belongs to the
 * authenticated user BEFORE forwarding the call.
 *
 * Ownership is decided from Foza's durable mapping (buyers/sellers tables via
 * accountStore), never from client-supplied claims.
 */

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Resolve the logged-in user's email, or throw if unauthenticated. */
async function requireEmail(): Promise<string> {
  const session = await getServerSession();
  if (!session) throw new ForbiddenError("Not signed in");
  return session.email;
}

/** Assert the given keyId belongs to the logged-in user. Returns the email. */
export async function assertOwnsKey(keyId: string): Promise<string> {
  const email = await requireEmail();
  if (!keyId) throw new ForbiddenError("Missing keyId");
  const acct = accountStore.get(email);
  const owns = acct?.keys.some((k) => k.keyId === keyId);
  if (!owns) throw new ForbiddenError("You do not own this key");
  return email;
}

/** Assert the given sellerId belongs to the logged-in user. Returns the email. */
export async function assertOwnsSeller(sellerId: string): Promise<string> {
  const email = await requireEmail();
  if (!sellerId) throw new ForbiddenError("Missing sellerId");
  const acct = accountStore.get(email);
  if (acct?.sellerId !== sellerId) {
    throw new ForbiddenError("You do not own this seller");
  }
  return email;
}

/**
 * Assert the given listingId belongs to a listing under the logged-in user's
 * seller. The listing's sellerId is resolved live from X-Router (Foza does not
 * store listings — only the seller mapping).
 */
export async function assertOwnsListing(listingId: string): Promise<string> {
  const email = await requireEmail();
  if (!listingId) throw new ForbiddenError("Missing listingId");
  const acct = accountStore.get(email);
  if (!acct?.sellerId) throw new ForbiddenError("You are not a seller");
  const listings = await xrouter.listListings();
  const listing = listings.find((l) => l.id === listingId);
  if (!listing) throw new ForbiddenError("Listing not found");
  if (listing.sellerId !== acct.sellerId) {
    throw new ForbiddenError("You do not own this listing");
  }
  return email;
}
