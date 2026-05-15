import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ProviderAccountSecret } from "../providers/base/ProviderAccount.js";
import { LocalEncryptionService } from "./LocalEncryptionService.js";

const secretFileEntrySchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  credentialType: z.enum([
    "api_key",
    "bearer_token",
    "oauth",
    "refresh_token",
    "session_cookie",
    "custom_json"
  ]),
  encryptedPayload: z.string().optional(),
  credentialPayload: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

const secretFileSchema = z.array(secretFileEntrySchema);

export type SecretFileEntry = z.infer<typeof secretFileEntrySchema>;

export class SecretService {
  private readonly secrets = new Map<string, ProviderAccountSecret>();

  constructor(private readonly encryptionService?: LocalEncryptionService) {}

  addSecret(secret: ProviderAccountSecret): void {
    this.secrets.set(secret.accountId, structuredClone(secret));
  }

  addCredentialPayload(options: {
    id: string;
    accountId: string;
    credentialType: ProviderAccountSecret["credentialType"];
    credentialPayload: Record<string, unknown>;
    expiresAt?: Date;
  }): ProviderAccountSecret {
    if (!this.encryptionService) {
      throw new Error("Encryption service is required to add credential payloads");
    }

    const secret: ProviderAccountSecret = {
      id: options.id,
      accountId: options.accountId,
      credentialType: options.credentialType,
      encryptedPayload: this.encryptionService.encryptJson(options.credentialPayload),
      expiresAt: options.expiresAt,
      updatedAt: new Date()
    };

    this.addSecret(secret);
    return structuredClone(secret);
  }

  /** Update an existing secret with a new credential payload (e.g. after token refresh). */
  updateSecretPayload(
    secretId: string,
    credentialPayload: Record<string, unknown>,
    expiresAt?: Date
  ): ProviderAccountSecret | undefined {
    if (!this.encryptionService) {
      throw new Error("Encryption service is required to update credential payloads");
    }
    const existing = Array.from(this.secrets.values()).find((s) => s.id === secretId);
    if (!existing) {
      return undefined;
    }
    existing.encryptedPayload = this.encryptionService.encryptJson(credentialPayload);
    existing.updatedAt = new Date();
    if (expiresAt) {
      existing.expiresAt = expiresAt;
    }
    return structuredClone(existing);
  }

  async loadFromFile(filePath: string): Promise<void> {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const entries = secretFileSchema.parse(parsed);

    for (const entry of entries) {
      this.secrets.set(entry.accountId, this.toSecret(entry));
    }
  }

  getSecretForAccount(accountId: string): ProviderAccountSecret | undefined {
    const secret = this.secrets.get(accountId);
    return secret ? structuredClone(secret) : undefined;
  }

  deleteSecretForAccount(accountId: string): boolean {
    return this.secrets.delete(accountId);
  }

  listSecrets(): ProviderAccountSecret[] {
    return Array.from(this.secrets.values()).map((secret) =>
      structuredClone(secret)
    );
  }

  decryptSecretPayload(secret: ProviderAccountSecret): Record<string, unknown> {
    if (!this.encryptionService) {
      throw new Error("Encryption service is required to decrypt secret payloads");
    }

    return this.encryptionService.decryptJson(secret.encryptedPayload);
  }

  private toSecret(entry: SecretFileEntry): ProviderAccountSecret {
    const encryptedPayload =
      entry.encryptedPayload ?? this.encryptInlineCredentialPayload(entry);

    return {
      id: entry.id,
      accountId: entry.accountId,
      credentialType: entry.credentialType,
      encryptedPayload,
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : undefined,
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date()
    };
  }

  private encryptInlineCredentialPayload(entry: SecretFileEntry): string {
    if (!entry.credentialPayload) {
      throw new Error(`Secret ${entry.id} must include encryptedPayload or credentialPayload`);
    }

    if (!this.encryptionService) {
      throw new Error(
        `Secret ${entry.id} includes credentialPayload but no encryption service is configured`
      );
    }

    return this.encryptionService.encryptJson(entry.credentialPayload);
  }
}
