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

  update(id: string, patch: { owner?: string; teamId?: string }): InternalApiKeyRecord | null {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    if (!record) return null;
    if (patch.owner !== undefined) record.owner = patch.owner || undefined;
    if (patch.teamId !== undefined) record.teamId = patch.teamId || undefined;
    const { key: _key, ...safeRecord } = record;
    return structuredClone(safeRecord);
  }

  /** Reveal the raw key value for an admin. Returns null if not found. */
  reveal(id: string): string | null {
    const record = Array.from(this.keys.values()).find((r) => r.id === id);
    return record?.key || null;
  }

  create(owner?: string, teamId?: string): CreatedInternalApiKey {
    const key = `igw_${randomBytes(24).toString("hex")}`;
    const record = {
      id: `internal_key_${this.keys.size + 1}`,
      key,
      keyHash: hashApiKey(key),
      enabled: true,
      owner,
      teamId,
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
}
