import type { MediaKind, MediaServiceConfig } from "../../media/types.js";

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

  /** Array of media kinds this provider supports (e.g., embedding, tts, image) */
  serviceKinds?: MediaKind[];
  /** Per-kind media configuration for this provider instance */
  mediaConfig?: Partial<Record<MediaKind, MediaServiceConfig>>;
};

