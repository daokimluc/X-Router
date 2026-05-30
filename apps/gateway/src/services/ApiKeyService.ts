import { randomBytes } from "node:crypto";
import { hashApiKey } from "../utils/hash.js";

export type InternalApiKeyRecord = {
  id: string;
  keyHash: string;
  enabled: boolean;
  owner?: string;
  teamId?: string;
  rpmLimit?: number;
  dailyLimit?: number;
  dailyTokenLimit?: number;
  /**
   * usd-wallet (#1) — prepaid USD balance in integer micro-USD, managed by the
   * marketplace WalletService. The field is persisted on the key record but the
   * authoritative live value lives in WalletService keyed by key id. Absent =
   * no wallet provisioned. Replaces the legacy token `balance` field.
   */
  walletMicroUsd?: number;
  /** Expiry timestamp. undefined = never expires. */
  expiresAt?: Date;
  /** Public model whitelist. undefined or empty = all models allowed. */
  allowedModels?: string[];
  /** Client IP allowlist. undefined or empty = all IPs allowed. Entries: single IP or CIDR (IPv4/IPv6). */
  allowedIps?: string[];
  /** Optional grouping label, reserved for Phase 20c routing. */
  groupName?: string;
  /** Phase 20c — when true, fall back to all groups if no candidate matches the key's group. */
  crossGroupRetry?: boolean;
  /** Phase 32 — hard daily USD spend cap. undefined = unlimited (or inherit from team). */
  dailySpendLimitUsd?: number;
  /** Phase 32 — hard monthly USD spend cap. undefined = unlimited (or inherit from team). */
  monthlySpendLimitUsd?: number;
  /** Phase 32 — semantic-response-cache mode. undefined → "client_choice". */
  cacheMode?: "client_choice" | "force_use" | "force_skip";
  /** marketplace-plans (#3) — bound plan preset id. undefined = no plan (legacy enforcement). */
  planId?: string;
  /** marketplace-plans (#3) — per-key override of the plan's overage flag. */
  overageEnabled?: boolean;
  /** marketplace-plans (#3) — user-set PAYG wallet daily limit (USD). */
  paygDailyLimitUsd?: number;
  /** two-sided-settlement (#6) — opt in to boost (PAYG past a speed-limit). */
  boostEnabled?: boolean;
  createdAt: Date;
};

export type CreatedInternalApiKey = InternalApiKeyRecord & {
  key: string;
};

export class ApiKeyService {
  private readonly keys = new Map<string, InternalApiKeyRecord & { key: string }>();

  /**
   * @param seedKeys  Optional initial keys (legacy boot-strap, mainly used
   *                  by tests). Production runtime starts with an empty list
   *                  and admins create client keys via the dashboard.
   */
  constructor(seedKeys: string[] = []) {
    seedKeys.forEach((key, index) => {
      this.keys.set(key, {
        id: `internal_key_${index + 1}`,
        key,
        keyHash: hashApiKey(key),
        enabled: true,
        createdAt: new Date()
      });
    });
  }

  isValid(key: string): boolean {
    const keyHash = hashApiKey(key);
    return Array.from(this.keys.values()).some(
      (record) => record.enabled && record.keyHash === keyHash
    );
  }

  /** Find key record by hash (for team lookup). */
  findByHash(keyHash: string): (InternalApiKeyRecord & { key: string }) | undefined {
    return Array.from(this.keys.values()).find((r) => r.keyHash === keyHash);
  }

  /** Find key record by id. */
  findById(id: string): (InternalApiKeyRecord & { key: string }) | undefined {
    return Array.from(this.keys.values()).find((r) => r.id === id);
  }

  /**
   * Sync a key record's persisted wallet snapshot (micro-USD). The live
   * authority is the marketplace WalletService; this keeps `list()` coherent so
   * the dashboard reflects balances without reaching into WalletService.
   * Pass undefined to mark the key as having no wallet.
   */
  setWalletMicroUsd(id: string, micro: number | undefined): void {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    if (!record) return;
    record.walletMicroUsd = micro;
  }

  list(): InternalApiKeyRecord[] {
    return Array.from(this.keys.values()).map(({ key: _key, ...record }) =>
      structuredClone(record)
    );
  }

  /** List with raw keys included — for persistence only. */
  listWithKeys(): Array<InternalApiKeyRecord & { key: string }> {
    return Array.from(this.keys.values()).map((record) => structuredClone(record));
  }

  setEnabled(id: string, enabled: boolean): InternalApiKeyRecord {
    const record = Array.from(this.keys.values()).find((keyRecord) => keyRecord.id === id);

    if (!record) {
      throw new Error(`API key ${id} not found`);
    }

    record.enabled = enabled;
    const { key: _key, ...safeRecord } = record;
    return structuredClone(safeRecord);
  }

  delete(id: string): InternalApiKeyRecord {
    const entry = Array.from(this.keys.entries()).find(
      ([, keyRecord]) => keyRecord.id === id
    );

    if (!entry) {
      throw new Error(`API key ${id} not found`);
    }

    const [mapKey, record] = entry;
    this.keys.delete(mapKey);
    const { key: _key, ...safeRecord } = record;
    return structuredClone(safeRecord);
  }

  update(id: string, patch: {
    owner?: string;
    teamId?: string;
    rpmLimit?: number;
    dailyLimit?: number;
    dailyTokenLimit?: number;
    enabled?: boolean;
    expiresAt?: Date | null;
    allowedModels?: string[];
    allowedIps?: string[];
    groupName?: string | null;
    crossGroupRetry?: boolean;
    dailySpendLimitUsd?: number | null;
    monthlySpendLimitUsd?: number | null;
    cacheMode?: "client_choice" | "force_use" | "force_skip";
    planId?: string | null;
    overageEnabled?: boolean | null;
    paygDailyLimitUsd?: number | null;
    boostEnabled?: boolean | null;
  }): InternalApiKeyRecord | null {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    if (!record) return null;
    if (patch.owner !== undefined) record.owner = patch.owner || undefined;
    if (patch.teamId !== undefined) record.teamId = patch.teamId || undefined;
    if (patch.rpmLimit !== undefined) record.rpmLimit = patch.rpmLimit > 0 ? patch.rpmLimit : undefined;
    if (patch.dailyLimit !== undefined) record.dailyLimit = patch.dailyLimit > 0 ? patch.dailyLimit : undefined;
    if (patch.dailyTokenLimit !== undefined) record.dailyTokenLimit = patch.dailyTokenLimit > 0 ? patch.dailyTokenLimit : undefined;
    if (patch.enabled !== undefined) record.enabled = patch.enabled;
    if (patch.expiresAt !== undefined) record.expiresAt = patch.expiresAt ?? undefined;
    if (patch.allowedModels !== undefined) record.allowedModels = patch.allowedModels.length > 0 ? patch.allowedModels : undefined;
    if (patch.allowedIps !== undefined) record.allowedIps = patch.allowedIps.length > 0 ? patch.allowedIps : undefined;
    if (patch.groupName !== undefined) record.groupName = patch.groupName ?? undefined;
    if (patch.crossGroupRetry !== undefined) record.crossGroupRetry = patch.crossGroupRetry;
    if (patch.dailySpendLimitUsd !== undefined) record.dailySpendLimitUsd = (patch.dailySpendLimitUsd ?? 0) > 0 ? (patch.dailySpendLimitUsd as number) : undefined;
    if (patch.monthlySpendLimitUsd !== undefined) record.monthlySpendLimitUsd = (patch.monthlySpendLimitUsd ?? 0) > 0 ? (patch.monthlySpendLimitUsd as number) : undefined;
    if (patch.cacheMode !== undefined) record.cacheMode = patch.cacheMode;
    if (patch.planId !== undefined) record.planId = patch.planId || undefined;
    if (patch.overageEnabled !== undefined) record.overageEnabled = patch.overageEnabled ?? undefined;
    if (patch.paygDailyLimitUsd !== undefined) record.paygDailyLimitUsd = (patch.paygDailyLimitUsd ?? -1) >= 0 ? (patch.paygDailyLimitUsd as number) : undefined;
    if (patch.boostEnabled !== undefined) record.boostEnabled = patch.boostEnabled ?? undefined;
    const { key: _key, ...safeRecord } = record;
    return structuredClone(safeRecord);
  }

  /** Reveal the raw key value for an admin. Returns null if not found. */
  reveal(id: string): string | null {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    return record?.key || null;
  }

  create(input: {
    owner?: string;
    teamId?: string;
    rpmLimit?: number;
    dailyLimit?: number;
    dailyTokenLimit?: number;
    expiresAt?: Date;
    allowedModels?: string[];
    allowedIps?: string[];
    groupName?: string;
    crossGroupRetry?: boolean;
    dailySpendLimitUsd?: number;
    monthlySpendLimitUsd?: number;
    cacheMode?: "client_choice" | "force_use" | "force_skip";
    planId?: string;
    overageEnabled?: boolean;
    paygDailyLimitUsd?: number;
  } = {}): CreatedInternalApiKey {
    const key = `igw_${randomBytes(24).toString("hex")}`;
    const record = {
      id: `internal_key_${this.keys.size + 1}`,
      key,
      keyHash: hashApiKey(key),
      enabled: true,
      owner: input.owner,
      teamId: input.teamId,
      rpmLimit: input.rpmLimit && input.rpmLimit > 0 ? input.rpmLimit : undefined,
      dailyLimit: input.dailyLimit && input.dailyLimit > 0 ? input.dailyLimit : undefined,
      dailyTokenLimit: input.dailyTokenLimit && input.dailyTokenLimit > 0 ? input.dailyTokenLimit : undefined,
      expiresAt: input.expiresAt,
      allowedModels: input.allowedModels && input.allowedModels.length > 0 ? input.allowedModels : undefined,
      allowedIps: input.allowedIps && input.allowedIps.length > 0 ? input.allowedIps : undefined,
      groupName: input.groupName,
      crossGroupRetry: input.crossGroupRetry,
      dailySpendLimitUsd: input.dailySpendLimitUsd && input.dailySpendLimitUsd > 0 ? input.dailySpendLimitUsd : undefined,
      monthlySpendLimitUsd: input.monthlySpendLimitUsd && input.monthlySpendLimitUsd > 0 ? input.monthlySpendLimitUsd : undefined,
      cacheMode: input.cacheMode,
      planId: input.planId,
      overageEnabled: input.overageEnabled,
      paygDailyLimitUsd: input.paygDailyLimitUsd !== undefined && input.paygDailyLimitUsd >= 0 ? input.paygDailyLimitUsd : undefined,
      createdAt: new Date()
    };

    this.keys.set(key, record);
    return structuredClone(record);
  }

  addRecord(record: InternalApiKeyRecord & { key?: string }): void {
    const rawKey = record.key ?? "";
    this.keys.set(record.id, {
      ...structuredClone(record),
      key: rawKey
    });
  }

  /** Returns true if the key has expired (expiresAt set and in the past). */
  isExpired(record: Pick<InternalApiKeyRecord, "expiresAt">): boolean {
    return record.expiresAt !== undefined && record.expiresAt.getTime() < Date.now();
  }

  /** Delete multiple keys atomically. Returns counts. */
  bulkDelete(ids: string[]): { deleted: number; notFound: string[] } {
    const idSet = new Set(ids);
    const notFound: string[] = [];
    const found = new Set<string>();
    for (const [mapKey, record] of this.keys.entries()) {
      if (idSet.has(record.id)) {
        this.keys.delete(mapKey);
        found.add(record.id);
      }
    }
    for (const id of ids) {
      if (!found.has(id)) notFound.push(id);
    }
    return { deleted: found.size, notFound };
  }
}
