import "server-only";
import { db } from "@/lib/db";

/**
 * Maps a logged-in Foza user (by email) to their X-Router account state, backed
 * by SQLite (`buyers` + `sellers` tables). globalThis is no longer used — state
 * is durable so the tenant-scoping guard and money ledger survive restarts.
 *
 * Security: the plaintext client key is NEVER persisted (X-Router only keeps a
 * hash; the contract says the website shouldn't store it either). We keep only a
 * masked form (`igw_xx…yyyy`) for display. The plaintext is shown once at
 * creation via the action's return value, then forgotten.
 *
 * The exported `accountStore` interface and the `Account`/`ApiKeyEntry` shapes are
 * unchanged from the former in-memory version (except `key` → `keyMasked`), so
 * callers need no behavioural change.
 */

export type ApiKeyEntry = {
  keyId: string;
  /** Display label shown in the keys table. */
  label: string;
  /** Masked key (igw_xx…yyyy) for display; plaintext is never stored. */
  keyMasked: string;
  /** Models this key is subscribed to (namespaced, e.g. hoang/gpt-5.5). */
  models: string[];
  createdAt: string;
};

type Account = {
  /** The user's primary/default key id (first created). */
  keyId: string;
  /** Masked primary key. */
  keyMasked: string;
  /** Currently granted plan id, or null. */
  planId: string | null;
  /** Whether overage/PAYG is enabled on the plan grant. */
  overageEnabled: boolean;
  walletUsd: number;
  /** All keys the user has created. */
  keys: ApiKeyEntry[];
  /** Seller id if this user registered as a provider, else null. */
  sellerId: string | null;
  /** Seller approval status. */
  sellerStatus: "pending" | "approved" | "suspended" | null;
};

/** Mask a plaintext key for display. Plaintext is never persisted. */
export function maskKey(key: string): string {
  if (!key || key.length <= 10) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

type BuyerRow = {
  keyId: string;
  userEmail: string;
  displayName: string;
  keyMasked: string;
  planId: string | null;
  overageEnabled: number;
  walletUsd: number;
  models: string;
  isPrimary: number;
  createdAt: string;
};

type SellerRow = {
  userEmail: string;
  sellerId: string;
  status: string | null;
  externalRef: string | null;
  createdAt: string;
};

// CHUNK2

function buyerRows(email: string): BuyerRow[] {
  return db()
    .prepare("SELECT * FROM buyers WHERE userEmail = ? ORDER BY createdAt ASC")
    .all(email) as BuyerRow[];
}

function sellerRow(email: string): SellerRow | undefined {
  return db().prepare("SELECT * FROM sellers WHERE userEmail = ?").get(email) as
    | SellerRow
    | undefined;
}

function buildAccount(email: string): Account | null {
  const rows = buyerRows(email);
  const seller = sellerRow(email);
  if (rows.length === 0 && !seller) return null;

  const primary = rows.find((r) => r.isPrimary === 1) ?? rows[0];
  const keys: ApiKeyEntry[] = rows.map((r) => ({
    keyId: r.keyId,
    label: r.displayName,
    keyMasked: r.keyMasked,
    models: JSON.parse(r.models) as string[],
    createdAt: r.createdAt,
  }));

  return {
    keyId: primary?.keyId ?? "",
    keyMasked: primary?.keyMasked ?? "",
    planId: primary?.planId ?? null,
    overageEnabled: primary ? primary.overageEnabled === 1 : false,
    walletUsd: primary?.walletUsd ?? 0,
    keys,
    sellerId: seller?.sellerId ?? null,
    sellerStatus: (seller?.status as Account["sellerStatus"]) ?? null,
  };
}

export const accountStore = {
  get(email: string): Account | null {
    return buildAccount(email);
  },

  set(email: string, acc: Account) {
    // Upsert the primary key row + each key; mirror seller if present.
    const conn = db();
    for (const k of acc.keys.length ? acc.keys : [primaryAsEntry(acc)]) {
      upsertBuyer(email, k, acc, k.keyId === acc.keyId);
    }
    if (acc.sellerId) {
      conn
        .prepare(
          `INSERT INTO sellers (userEmail, sellerId, status, externalRef, createdAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(userEmail) DO UPDATE SET sellerId=excluded.sellerId, status=excluded.status`,
        )
        .run(email, acc.sellerId, acc.sellerStatus, email, new Date().toISOString());
    }
  },

  update(email: string, patch: Partial<Account>) {
    const rows = buyerRows(email);
    if (rows.length === 0) return;
    const primary = rows.find((r) => r.isPrimary === 1) ?? rows[0];
    const conn = db();
    if (patch.planId !== undefined)
      conn.prepare("UPDATE buyers SET planId = ? WHERE keyId = ?").run(patch.planId, primary.keyId);
    if (patch.overageEnabled !== undefined)
      conn.prepare("UPDATE buyers SET overageEnabled = ? WHERE keyId = ?").run(patch.overageEnabled ? 1 : 0, primary.keyId);
    if (patch.walletUsd !== undefined)
      conn.prepare("UPDATE buyers SET walletUsd = ? WHERE keyId = ?").run(patch.walletUsd, primary.keyId);
  },

  has(email: string) {
    return buyerRows(email).length > 0 || !!sellerRow(email);
  },

  /** Append a key to the user's key list (creating the account if needed). */
  addKey(email: string, entry: ApiKeyEntry) {
    const isFirst = buyerRows(email).length === 0;
    upsertBuyerEntry(email, entry, isFirst);
  },

  /** Update the masked key after a rotate (plaintext is shown once, not stored). */
  updateKeyMasked(keyId: string, keyMasked: string) {
    db().prepare("UPDATE buyers SET keyMasked = ? WHERE keyId = ?").run(keyMasked, keyId);
  },

  /** Set a key's cached wallet balance (from a webhook), keyed by keyId. */
  setWalletByKey(keyId: string, walletUsd: number) {
    db().prepare("UPDATE buyers SET walletUsd = ? WHERE keyId = ?").run(walletUsd, keyId);
  },

  /** Clear a key's plan (renewal underfunded → downgraded to Free), by keyId. */
  clearPlanByKey(keyId: string) {
    db()
      .prepare("UPDATE buyers SET planId = NULL, overageEnabled = 0 WHERE keyId = ?")
      .run(keyId);
  },

  /** Add a model to a specific key's subscription list. */
  addModelToKey(email: string, keyId: string, model: string) {
    const row = db().prepare("SELECT models FROM buyers WHERE keyId = ? AND userEmail = ?").get(keyId, email) as
      | { models: string }
      | undefined;
    if (!row) return;
    const models = JSON.parse(row.models) as string[];
    if (!models.includes(model)) {
      models.push(model);
      db().prepare("UPDATE buyers SET models = ? WHERE keyId = ?").run(JSON.stringify(models), keyId);
    }
  },

  /** Record that the user registered as a seller. */
  setSeller(email: string, sellerId: string, status: "pending" | "approved" | "suspended") {
    db()
      .prepare(
        `INSERT INTO sellers (userEmail, sellerId, status, externalRef, createdAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userEmail) DO UPDATE SET sellerId=excluded.sellerId, status=excluded.status`,
      )
      .run(email, sellerId, status, email, new Date().toISOString());
  },
};

function primaryAsEntry(acc: Account): ApiKeyEntry {
  return { keyId: acc.keyId, label: acc.keyMasked || acc.keyId, keyMasked: acc.keyMasked, models: [], createdAt: new Date().toISOString() };
}

function upsertBuyer(email: string, entry: ApiKeyEntry, acc: Account, isPrimary: boolean) {
  db()
    .prepare(
      `INSERT INTO buyers (keyId, userEmail, displayName, keyMasked, planId, overageEnabled, walletUsd, models, isPrimary, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(keyId) DO UPDATE SET displayName=excluded.displayName, keyMasked=excluded.keyMasked`,
    )
    .run(
      entry.keyId, email, entry.label, entry.keyMasked,
      isPrimary ? acc.planId : null,
      isPrimary && acc.overageEnabled ? 1 : 0,
      isPrimary ? acc.walletUsd : 0,
      JSON.stringify(entry.models ?? []),
      isPrimary ? 1 : 0,
      entry.createdAt,
    );
}

function upsertBuyerEntry(email: string, entry: ApiKeyEntry, isPrimary: boolean) {
  db()
    .prepare(
      `INSERT INTO buyers (keyId, userEmail, displayName, keyMasked, planId, overageEnabled, walletUsd, models, isPrimary, createdAt)
       VALUES (?, ?, ?, ?, NULL, 0, 0, ?, ?, ?)
       ON CONFLICT(keyId) DO UPDATE SET displayName=excluded.displayName, keyMasked=excluded.keyMasked`,
    )
    .run(entry.keyId, email, entry.label, entry.keyMasked, JSON.stringify(entry.models ?? []), isPrimary ? 1 : 0, entry.createdAt);
}

export type { Account };

