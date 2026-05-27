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
  owner?: string;
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

