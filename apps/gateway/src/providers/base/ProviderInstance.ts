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

export type StatusCodeAction = "retry" | "disable" | "passthrough";

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

  /** Phase 20b — shallow-merged into request body before forwarding upstream. */
  paramOverride?: Record<string, unknown>;
  /** Phase 20b — injected into request headers (reserved keys ignored). */
  headerOverride?: Record<string, string>;
  /** Phase 20b — persisted but not yet consumed by routing logic. */
  statusCodeMapping?: Record<string, StatusCodeAction>;
  /** Phase 20c — optional channel group label for group-based routing. */
  groupName?: string;

  /** Array of media kinds this provider supports (e.g., embedding, tts, image) */
  serviceKinds?: MediaKind[];
  /** Per-kind media configuration for this provider instance */
  mediaConfig?: Partial<Record<MediaKind, MediaServiceConfig>>;
};

