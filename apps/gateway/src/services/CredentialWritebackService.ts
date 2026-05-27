import type { SecretService } from "./SecretService.js";

export type WritebackEvent = {
  accountId: string;
  credentialPayload: Record<string, unknown>;
};

export class CredentialWritebackService {
  constructor(private readonly secretService: SecretService) {}

  persist(accountId: string, credentialPayload: Record<string, unknown>): void {
    const secret = this.secretService.getSecretForAccount(accountId);
    if (secret) {
      this.secretService.updateSecretPayload(secret.id, credentialPayload);
    }
  }
}
