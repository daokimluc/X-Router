import "server-only";
import { auth } from "@/auth";
import { type Session } from "@/lib/auth";

/** Read the current logged-in session server-side (via Auth.js). */
export async function getServerSession(): Promise<Session | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return { name: session.user?.name ?? email, email };
}

/**
 * Ensure the current user has an X-Router buyer key, creating one on first use.
 * Returns the keyId, or null if not logged in. Centralizes the user→keyId
 * mapping every provision command needs.
 */
export async function ensureUserKey(
  label?: string,
): Promise<{ email: string; keyId: string } | null> {
  const session = await getServerSession();
  if (!session) return null;

  const { accountStore, maskKey } = await import("@/lib/xrouter/account-store");
  const existing = accountStore.get(session.email);
  if (existing && existing.keyId) return { email: session.email, keyId: existing.keyId };

  const { xrouter } = await import("@/lib/xrouter/adapter");
  const created = await xrouter.createKey({ label: label ?? session.email });
  accountStore.set(session.email, {
    keyId: created.id,
    keyMasked: maskKey(created.key),
    planId: created.planId,
    overageEnabled: false,
    walletUsd: 0,
    keys: [
      {
        keyId: created.id,
        label: label ?? session.email,
        keyMasked: maskKey(created.key),
        models: [],
        createdAt: new Date().toISOString(),
      },
    ],
    sellerId: null,
    sellerStatus: null,
  });
  return { email: session.email, keyId: created.id };
}
