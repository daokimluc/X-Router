import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LocalEncryptionService } from "../services/LocalEncryptionService.js";
import { SecretService } from "../services/SecretService.js";

describe("LocalEncryptionService", () => {
  it("encrypts and decrypts JSON payloads", () => {
    const service = new LocalEncryptionService("test-key");
    const encrypted = service.encryptJson({
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("access-token");
    expect(encrypted).not.toContain("refresh-token");
    expect(service.decryptJson(encrypted)).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });
  });
});

describe("SecretService", () => {
  it("loads credentials from a secrets file and encrypts inline payloads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gateway-secret-test-"));
    const filePath = join(tempDir, "provider-accounts.json");
    const encryptionService = new LocalEncryptionService("test-key");
    const secretService = new SecretService(encryptionService);

    await writeFile(
      filePath,
      JSON.stringify([
        {
          id: "secret_1",
          accountId: "account_1",
          credentialType: "refresh_token",
          credentialPayload: {
            accessToken: "access-token",
            refreshToken: "refresh-token"
          },
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]),
      "utf8"
    );

    try {
      await secretService.loadFromFile(filePath);
      const secret = secretService.getSecretForAccount("account_1");

      expect(secret).toMatchObject({
        id: "secret_1",
        accountId: "account_1",
        credentialType: "refresh_token"
      });
      expect(secret?.encryptedPayload).not.toContain("access-token");
      expect(secret ? secretService.decryptSecretPayload(secret) : undefined).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token"
      });
    } finally {
      await rm(tempDir, {
        recursive: true,
        force: true
      });
    }
  });
});

