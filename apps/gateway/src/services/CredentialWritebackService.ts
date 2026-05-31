import type { SecretService } from "./SecretService.js";

export type WritebackEvent = {
  accountId: string;
  credentialPayload: Record<string, unknown>;
};

export class CredentialWritebackService {
  constructor(
    private readonly secretService: SecretService,
    /**
     * Optional durable-persist trigger. The adapter refresh callback writes the
     * rotated token into the in-memory secret store; without this the new token
     * only reaches disk if some later mutation happens to save. Wired to
     * app.persistState() so a background/adapter-initiated refresh is durable.
     */
    private readonly onPersist?: () => void
  ) {}

  persistCredential(accountId: string, credentialPayload: Record<string, unknown>): void {
    const secret = this.secretService.getSecretForAccount(accountId);
    if (secret) {
      this.secretService.updateSecretPayload(secret.id, credentialPayload);
      this.onPersist?.();
    }
  }

  /** @deprecated use persistCredential — kept for the existing call site. */
  persist(accountId: string, credentialPayload: Record<string, unknown>): void {
    this.persistCredential(accountId, credentialPayload);
  }
}
