import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const ivLength = 12;
const authTagLength = 16;

export class LocalEncryptionService {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    if (!secretKey) {
      throw new Error("Encryption key is required");
    }

    this.key = createHash("sha256").update(secretKey).digest();
  }

  encryptJson(payload: Record<string, unknown>): string {
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv(algorithm, this.key, iv, {
      authTagLength
    });
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      "v1",
      iv.toString("base64url"),
      authTag.toString("base64url"),
      encrypted.toString("base64url")
    ].join(".");
  }

  decryptJson(encryptedPayload: string): Record<string, unknown> {
    const [version, ivText, authTagText, encryptedText] = encryptedPayload.split(".");

    if (version !== "v1" || !ivText || !authTagText || !encryptedText) {
      throw new Error("Invalid encrypted payload format");
    }

    const decipher = createDecipheriv(
      algorithm,
      this.key,
      Buffer.from(ivText, "base64url"),
      {
        authTagLength
      }
    );
    decipher.setAuthTag(Buffer.from(authTagText, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]);

    const parsed: unknown = JSON.parse(decrypted.toString("utf8"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Decrypted payload must be an object");
    }

    return parsed as Record<string, unknown>;
  }

  /**
   * Encrypt a single string value (e.g. a webhook HMAC secret). Wraps it in a
   * JSON envelope so the same AES-GCM path is reused. Returns the `v1.…`
   * ciphertext format (distinguishable from any plaintext that isn't itself a
   * `v1.iv.tag.data` 4-part token).
   */
  encryptString(value: string): string {
    return this.encryptJson({ v: value });
  }

  /** Decrypt a value produced by encryptString. */
  decryptString(ciphertext: string): string {
    const parsed = this.decryptJson(ciphertext);
    const v = parsed.v;
    if (typeof v !== "string") throw new Error("Decrypted value is not a string");
    return v;
  }

  /** True if `value` looks like our `v1.iv.tag.data` ciphertext (not plaintext). */
  isCiphertext(value: string): boolean {
    const parts = value.split(".");
    return parts.length === 4 && parts[0] === "v1" && parts.every((p, i) => i === 0 || p.length > 0);
  }
}

