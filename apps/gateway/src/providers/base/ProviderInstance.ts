import type { MediaKind, MediaServiceConfig } from "../../media/types.js";

export type AccountSelectionStrategy =
  | "round_robin"
  | "weighted_round_robin"
  | "least_busy"
  | "lowest_error_rate"
  | "lowest_latency"
  | "lowest_cost"
  | "priority";

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
  /** Phase 25 — single tag for batch operations. */
  tag?: string;
  /** Phase 25 — maximum input tokens; reject upstream call if request exceeds this estimate. */
  maxInputTokens?: number;
  /** Phase 25 — system prompt prepended to every request (or replaces existing system message). */
  systemPromptOverride?: string;
  /** Phase 29 — admin notes/remark for this channel. */
  remark?: string;
  /** Phase 29 — timestamp of the last test (single or batch). */
  lastTestAt?: Date;
  /** Phase 29 — duration of the last test in ms. */
  lastTestDurationMs?: number;
  /** Phase 29 — status of the last test ("ok" | "degraded" | "down" | "error"). */
  lastTestStatus?: "ok" | "degraded" | "down" | "error";
  /** Phase 29 — upstream account balance in USD (provider-reported, may be stale). */
  upstreamBalance?: number;
  /** Phase 29 — when upstreamBalance was last refreshed. */
  upstreamBalanceUpdatedAt?: Date;
  /** Phase 30 — per-channel alias→upstream mapping. Takes precedence over global ModelMapping.upstreamModel. */
  modelMapping?: Record<string, string>;
  /** Phase 30 — model used for health check / test endpoints; default lets adapter pick. */
  testModel?: string;

  /** Array of media kinds this provider supports (e.g., embedding, tts, image) */
  serviceKinds?: MediaKind[];
  /** Per-kind media configuration for this provider instance */
  mediaConfig?: Partial<Record<MediaKind, MediaServiceConfig>>;
};

