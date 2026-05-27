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
  /** Token balance (credits). Infinity = unlimited. Deducted per request. */
  balance?: number;
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
  createdAt: Date;
};

export type CreatedInternalApiKey = InternalApiKeyRecord & {
  key: string;
};

export class ApiKeyService {
  private readonly keys = new Map<string, InternalApiKeyRecord & { key: string }>();

  constructor(initialKeys: string[] = []) {
    initialKeys.forEach((key, index) => {
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

  /** Check if key has sufficient balance. Returns true if unlimited or balance > 0. */
  hasBalance(keyHash: string): boolean {
    const record = this.findByHash(keyHash);
    if (!record) return false;
    if (record.balance === undefined) return true; // unlimited
    return record.balance > 0;
  }

  /** Deduct tokens from key balance. No-op if balance is undefined (unlimited). */
  deductBalance(keyHash: string, tokens: number): void {
    const record = this.findByHash(keyHash);
    if (!record || record.balance === undefined) return;
    record.balance = Math.max(0, record.balance - tokens);
  }

  /** Add tokens to key balance (top-up). */
  topup(id: string, amount: number): InternalApiKeyRecord | null {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    if (!record) return null;
    record.balance = (record.balance ?? 0) + amount;
    const { key: _key, ...safeRecord } = record;
    return structuredClone(safeRecord);
  }

  /** Get balance for a key. Returns undefined if unlimited. */
  getBalance(id: string): number | undefined {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    return record?.balance;
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
