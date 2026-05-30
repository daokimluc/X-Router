export type AccountStatus = "active" | "cooldown" | "disabled";

export type ProviderAccountRuntime = {
  activeRequests: number;
  totalRequests: number;
  failedRequests: number;
  consecutiveFailures: number;
  lastUsedAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastError?: string;
  cooldownUntil?: Date;
};

export type ProviderAccount = {
  id: string;
  providerInstanceId: string;
  providerType: string;
  displayName: string;
  status: AccountStatus;
  weight: number;
  priority?: number;
  maxConcurrency: number;
  credentialRef: string;
  proxyPoolId?: string;
  allowedModels?: string[];
  tags?: string[];
  /** Human-facing owner label (e.g. team or user). Distinct from sellerId. */
  owner?: string;
  /**
   * seller-supply (#4) — marketplace seller that owns this account's supply.
   * Defaults to "house" (platform's own supply) for accounts with no explicit
   * seller, so single-tenant deployments are "all house". Set on load migration.
   */
  sellerId?: string;
  runtime: ProviderAccountRuntime;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderAccountSecret = {
  id: string;
  accountId: string;
  credentialType:
    | "api_key"
    | "bearer_token"
    | "oauth"
    | "refresh_token"
    | "session_cookie"
    | "custom_json";
  encryptedPayload: string;
  expiresAt?: Date;
  updatedAt: Date;
};

