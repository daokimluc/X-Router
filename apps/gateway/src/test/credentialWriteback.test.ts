import { describe, expect, it, vi } from "vitest";
import { CredentialWritebackService } from "../services/CredentialWritebackService.js";
import { SecretService } from "../services/SecretService.js";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";

const now = new Date("2026-01-01T00:00:00.000Z");

function buildSecretService(accountId: string): SecretService {
  const enc = new LocalEncryptionService("test-key");
  const svc = new SecretService(enc);
  svc.addSecret({
    id: `secret_${accountId}`,
    accountId,
    credentialType: "oauth",
    encryptedPayload: enc.encryptJson({ accessToken: "old", refreshToken: "rt" }),
    updatedAt: now
  });
  return svc;
}

describe("CredentialWritebackService", () => {
  it("writes the rotated credential AND triggers a durable persist", () => {
    const secretService = buildSecretService("acc1");
    const onPersist = vi.fn();
    const svc = new CredentialWritebackService(secretService, onPersist);

    svc.persistCredential("acc1", { accessToken: "new", refreshToken: "rt2" });

    const secret = secretService.getSecretForAccount("acc1")!;
    expect(secretService.decryptSecretPayload(secret).accessToken).toBe("new");
    // The fix: an adapter-initiated refresh must trigger a durable save, not
    // only update the in-memory secret.
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("does not persist when the account has no secret", () => {
    const secretService = buildSecretService("acc1");
    const onPersist = vi.fn();
    const svc = new CredentialWritebackService(secretService, onPersist);

    svc.persistCredential("missing", { accessToken: "x" });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("legacy persist() alias still works", () => {
    const secretService = buildSecretService("acc1");
    const onPersist = vi.fn();
    const svc = new CredentialWritebackService(secretService, onPersist);
    svc.persist("acc1", { accessToken: "viaAlias" });
    expect(onPersist).toHaveBeenCalledTimes(1);
  });
});
