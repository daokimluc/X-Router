export type AccountSelectionStrategy =
  | "round_robin"
  | "weighted_round_robin"
  | "least_busy"
  | "lowest_error_rate"
  | "lowest_latency";

export type ProviderCircuitBreakerConfig = {
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxRequests: number;
};

export type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  baseUrl?: string;
  priority?: number;
  config: Record<string, unknown>;
  defaultTimeoutMs: number;
  maxRetries: number;
  cooldownMs: number;
  accountSelectionStrategy: AccountSelectionStrategy;
  maxConcurrentRequests: number;
  maxConcurrentRequestsPerAccount: number;
  circuitBreaker: ProviderCircuitBreakerConfig;
  createdAt: Date;
  updatedAt: Date;
};

