import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { NoAvailableAccountError, type AccountPool } from "../../account-pool/AccountPool.js";
import { CircuitBreakerOpenError } from "../../services/CircuitBreaker.js";
import { ProviderError } from "../../providers/base/ProviderErrors.js";
import { ConcurrencyLimitError } from "../../services/ConcurrencyLimiter.js";
import { isProviderStream } from "../../utils/sse.js";
import { resolveAccountProxyOptions } from "../../proxy/resolveAccountProxy.js";
import type { ResolvedModelCandidate, ReasoningEffort } from "../../router/ModelResolver.js";
import type { ProviderInstance } from "../../providers/base/ProviderInstance.js";
import type { AIProviderAdapter } from "../../providers/base/AIProviderAdapter.js";
import type { ProtocolHandler, PipelineUsage } from "./ProtocolHandler.js";

/**
 * Classification of a per-attempt error, driving the failover loop.
 * - `terminal`    → stop, run failure settlement, throw to the client.
 * - `retryable`   → a transient provider error (retryable=true) → try next.
 * - `capacity`    → admission/capacity (no account, overloaded, circuit open)
 *                   → try the next candidate rather than aborting (R3 fix).
 */
type ErrorClass = "terminal" | "retryable" | "capacity";

/**
 * Classify a per-attempt error for the failover loop. Exported for testing the
 * R3 fix (capacity/admission errors fail over instead of aborting).
 */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof NoAvailableAccountError) return "capacity";
  if (error instanceof CircuitBreakerOpenError) return "capacity";
  // A provider-level concurrency rejection (provider_overloaded) is capacity:
  // try the next candidate. (The global limiter rejection is handled before the
  // loop and never reaches here.)
  if (error instanceof ConcurrencyLimitError) return "capacity";
  if (error instanceof ProviderError) {
    // Transient provider errors (retryable=true: rate-limited/timeout/unavailable)
    // → retry/failover; everything else (auth, config, bad-response) is terminal.
    if (error.retryable) return "retryable";
    return "terminal";
  }
  return "terminal";
}

function isProviderFailureForCircuit(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    ["provider_rate_limited", "provider_timeout", "provider_unavailable"].includes(error.code)
  );
}

function readAccessToken(payload: Record<string, unknown>): string | undefined {
  const v = payload.accessToken ?? payload.access_token;
  return typeof v === "string" ? v : undefined;
}

/**
 * The single shared request lifecycle for both `/v1/chat/completions` and
 * `/v1/messages`. It owns: global concurrency + queue acquire/release, candidate
 * ranking + iteration, circuit-breaker admit/resolve, per-account lease, the
 * failover loop with explicit error classification, usage recording, spend +
 * marketplace settlement, latency recording, and uniform cleanup on every exit.
 *
 * Protocol differences (request encode, stream write, response decode, cache
 * write) live behind {@link ProtocolHandler}. There is exactly ONE copy of the
 * lifecycle, so the OpenAI/Anthropic failure-path divergences (F1-F6b, R3) can
 * no longer drift apart.
 */
export class RequestPipeline {
  constructor(private readonly app: FastifyInstance) {}

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    handler: ProtocolHandler,
    candidates: ResolvedModelCandidate[],
    reasoningEffort: ReasoningEffort | undefined
  ): Promise<unknown> {
    const app = this.app;

    // F1 — global concurrency + queue acquire, wired ONCE for both protocols.
    // When the limiter rejects and the queue is enabled, wait for a slot;
    // release() in `finally` wakes the next waiter regardless of protocol.
    let releaseGlobal: (() => void) | undefined;
    try {
      releaseGlobal = app.concurrencyLimiter.acquireGlobal();
    } catch (concurrencyErr) {
      if (app.requestQueueService.isEnabled()) {
        await app.requestQueueService.waitForSlot();
        releaseGlobal = app.concurrencyLimiter.acquireGlobal();
      } else {
        throw concurrencyErr;
      }
    }

    try {
      let lastError: unknown;

      for (const candidate of candidates) {
        const providerInstance = app.providerRuntimeRegistry.getProviderInstance(
          candidate.providerInstanceId
        );
        if (!providerInstance || !providerInstance.enabled) {
          continue;
        }

        // Cheap pre-check: skip an open circuit without consuming an attempt.
        if (!app.circuitBreaker.canRequest(providerInstance.id, providerInstance.circuitBreaker)) {
          lastError = new CircuitBreakerOpenError(providerInstance.id);
          request.log.warn(
            {
              requestId: request.id,
              providerInstanceId: providerInstance.id,
              model: handler.model
            },
            "provider skipped because circuit breaker is open"
          );
          continue;
        }

        const adapter = app.providerRegistry.getAdapter(candidate.providerType);
        const accountPool = app.providerRuntimeRegistry.getAccountPool(candidate.providerInstanceId);
        if (!accountPool) {
          continue;
        }

        const attempts = providerInstance.maxRetries + 1;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const result = await this.attempt({
            request,
            reply,
            handler,
            candidate,
            providerInstance,
            accountPool,
            adapter,
            reasoningEffort,
            attempt
          });

          if (result.kind === "success") {
            return result.value;
          }
          if (result.kind === "retry_same_candidate") {
            // Auth-refresh succeeded → retry the same candidate (same loop).
            continue;
          }
          // failure: record lastError + decide whether to keep failing over.
          // Don't let a NoAvailableAccountError clobber a more meaningful
          // earlier error (preserves the original routes' reporting).
          if (!(result.error instanceof NoAvailableAccountError && lastError)) {
            lastError = result.error;
          }
          if (result.errorClass === "terminal") {
            this.failSettle(request, handler);
            throw result.error;
          }
          // retryable → next attempt on this candidate (loop); but if attempts
          // are exhausted the inner loop ends and we move to the next candidate.
          // capacity → break to the next candidate immediately.
          if (result.errorClass === "capacity") {
            break;
          }
        }
      }

      // Every candidate exhausted (all retryable/capacity) or none available.
      // F3 — release reservations + run failure settlement here too.
      this.failSettle(request, handler);
      if (lastError) {
        throw lastError;
      }
      throw new NoAvailableAccountError();
    } finally {
      releaseGlobal?.();
      // F1 — wake the next queued waiter (any protocol) now a slot is free.
      app.requestQueueService.release();
    }
  }

  /**
   * Run a single admitted attempt against one candidate. Owns the lease,
   * provider-concurrency slot, circuit admit/resolve, stream-vs-non-stream
   * dispatch, usage/settlement on success, and the auth-refresh retry. Every
   * exit path resolves the breaker once and releases the lease + slot.
   */
  private async attempt(args: {
    request: FastifyRequest;
    reply: FastifyReply;
    handler: ProtocolHandler;
    candidate: ResolvedModelCandidate;
    providerInstance: ProviderInstance;
    accountPool: AccountPool;
    adapter: AIProviderAdapter;
    reasoningEffort: ReasoningEffort | undefined;
    attempt: number;
  }): Promise<
    | { kind: "success"; value: unknown }
    | { kind: "retry_same_candidate" }
    | { kind: "failure"; error: unknown; errorClass: ErrorClass }
  > {
    const { request, reply, handler, candidate, providerInstance, accountPool, adapter, reasoningEffort, attempt } = args;
    const app = this.app;

    let lease: ReturnType<typeof accountPool.acquire> | undefined;
    let releaseProvider: (() => void) | undefined;
    let admitted = false;
    let usedAccessToken: string | undefined;
    const requestStart = performance.now();

    try {
      app.circuitBreaker.beforeRequest(providerInstance.id, providerInstance.circuitBreaker);
      admitted = true;
      releaseProvider = app.concurrencyLimiter.acquireProvider(
        providerInstance.id,
        providerInstance.maxConcurrentRequests
      );
      lease = accountPool.acquire({
        model: candidate.publicModel,
        costFor: app.marketplaceSeam.costForModel(candidate.publicModel)
      });
      app.marketplaceSeam.captureRouted(request, candidate.publicModel, lease.account.id);

      const secret = app.secretService.getSecretForAccount(lease.account.id);
      const credentialPayload = secret ? app.secretService.decryptSecretPayload(secret) : {};
      usedAccessToken = readAccessToken(credentialPayload);

      const response = await handler.invoke(adapter, candidate.upstreamModel, {
        providerInstance,
        account: lease.account,
        requestId: request.id,
        credentialPayload,
        reasoningEffort,
        proxyOptions: resolveAccountProxyOptions(lease.account, app.proxyPoolService)
      });

      if (isProviderStream(response)) {
        try {
          const usage = await handler.writeStream(reply, response, request.id);
          lease.releaseSuccess();
          app.circuitBreaker.recordResult(
            providerInstance.id,
            { ok: true, countsAsFailure: false },
            providerInstance.circuitBreaker
          );
          this.recordLatency(candidate, lease.account.id, requestStart, true);
          this.recordSuccessUsage(request, handler, candidate, lease.account.id, usage);
          return { kind: "success", value: reply };
        } catch (streamError) {
          lease.releaseFailure(
            streamError instanceof Error ? streamError.message : "stream failed"
          );
          app.circuitBreaker.recordResult(
            providerInstance.id,
            { ok: false, countsAsFailure: isProviderFailureForCircuit(streamError) },
            providerInstance.circuitBreaker
          );
          this.recordLatency(candidate, lease.account.id, requestStart, false);
          // Mid-stream failure: release held reservations + run failure settlement
          // (the response already started, so we can't fail over — end it).
          this.failSettle(request, handler);
          request.log.warn(
            { requestId: request.id, providerInstanceId: providerInstance.id },
            "provider stream failed after response started"
          );
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
          return { kind: "success", value: reply };
        } finally {
          releaseProvider();
        }
      }

      // Non-streaming response.
      lease.releaseSuccess();
      releaseProvider();
      app.circuitBreaker.recordResult(
        providerInstance.id,
        { ok: true, countsAsFailure: false },
        providerInstance.circuitBreaker
      );
      this.recordLatency(candidate, lease.account.id, requestStart, true);

      const decoded = handler.decode(response);
      // F4 — always record + settle against the (possibly estimated) usage.
      this.recordSuccessUsage(request, handler, candidate, lease.account.id, decoded.usage);
      if (decoded.cacheable) {
        handler.writeCache(response);
      }
      return { kind: "success", value: decoded.body };
    } catch (error) {
      releaseProvider?.();

      // Auth-refresh on auth error: funnel through refreshLockService (serialized
      // per account, de-duplicated). On success/skip, release the probe slot and
      // retry the SAME candidate with the refreshed credential.
      if (
        lease &&
        error instanceof ProviderError &&
        error.code === "provider_auth_error" &&
        adapter.refreshSession &&
        attempt === 0
      ) {
        try {
          const outcome = await app.refreshLockService.refreshIfNeeded({
            account: lease.account,
            adapter,
            providerInstance,
            secretService: app.secretService,
            trigger: "on_auth_error",
            staleAccessToken: usedAccessToken
          });
          if (outcome.refreshed || outcome.skipped) {
            if (admitted) {
              app.circuitBreaker.releaseProbe(providerInstance.id);
            }
            request.log.info(
              {
                accountId: lease.account.id,
                refresh: outcome.refreshed ? "refreshed" : outcome.reason
              },
              "session refreshed, will retry"
            );
            lease.releaseFailure("auth_error_refreshed");
            return { kind: "retry_same_candidate" };
          }
        } catch (refreshErr) {
          request.log.warn({ accountId: lease.account.id, err: refreshErr }, "session refresh failed");
        }
      }

      if (lease) {
        lease.releaseFailure(error instanceof Error ? error.message : "unknown error");
        this.handleProviderAccountState(error, accountPool, lease.account.id, providerInstance.cooldownMs);
        this.recordLatency(candidate, lease.account.id, requestStart, false);
      }

      if (admitted) {
        app.circuitBreaker.recordResult(
          providerInstance.id,
          { ok: false, countsAsFailure: isProviderFailureForCircuit(error) },
          providerInstance.circuitBreaker
        );
      }

      return { kind: "failure", error, errorClass: classifyError(error) };
    }
  }

  private recordLatency(
    candidate: ResolvedModelCandidate,
    accountId: string,
    requestStart: number,
    ok: boolean
  ): void {
    this.app.latencyTracker.record({
      providerInstanceId: candidate.providerInstanceId,
      publicModel: candidate.publicModel,
      accountId,
      durationMs: Math.round(performance.now() - requestStart),
      ok
    });
  }

  /**
   * Record usage + consume rate-limit tokens + account quota + settle spend +
   * run marketplace success settlement. Identical for both protocols, stream
   * and non-stream — this is the single source for F2 (stream token accounting)
   * and the success branch of F4.
   */
  private recordSuccessUsage(
    request: FastifyRequest,
    handler: ProtocolHandler,
    candidate: ResolvedModelCandidate,
    accountId: string,
    usage: PipelineUsage
  ): void {
    const app = this.app;
    const promptTokens = usage.promptTokens;
    const completionTokens = usage.completionTokens;
    const cachedTokens = usage.cachedTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const cost = app.modelPricingService.calculateCost(
      handler.model,
      promptTokens,
      completionTokens,
      cachedTokens
    ).totalCost;

    app.usageService.record({
      requestId: request.id,
      protocol: handler.protocol,
      model: handler.model,
      providerType: candidate.providerType,
      providerInstanceId: candidate.providerInstanceId,
      accountId,
      apiKeyHash: request.auth?.apiKeyHash,
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cachedTokens || undefined,
      estimatedCost: cost || undefined
    });

    // F2 — token-based rate-limit accounting for BOTH protocols + stream/non-stream.
    if (request.auth?.apiKeyHash) {
      app.rateLimitService.consumeTokens(request.auth.apiKeyHash, totalTokens);
    }
    app.accountQuotaService.recordUsage(accountId, totalTokens);

    // Phase 32 — settle the held spend reservation against actual cost.
    if (request.spendReservation) {
      for (const id of request.spendReservation.id.split("|")) {
        app.spendLedgerService.settle(id, cost);
      }
    }

    // two-sided-settlement (#6) — marketplace settlement + seller credit.
    app.marketplaceSeam.runSettlement({
      request,
      outcome: "success",
      model: handler.model,
      promptTokens,
      completionTokens,
      cachedTokens
    });
  }

  /**
   * Release held reservations + run marketplace FAILURE settlement. Idempotent
   * (clears request.spendReservation). Used on terminal failure, all-candidates
   * exhausted, and mid-stream failure. The global onResponse hook is the final
   * backstop for any path that still slips through.
   */
  private failSettle(request: FastifyRequest, handler: ProtocolHandler): void {
    const app = this.app;
    if (request.spendReservation) {
      for (const id of request.spendReservation.id.split("|")) {
        app.spendLedgerService.release(id);
      }
      request.spendReservation = undefined;
    }
    app.marketplaceSeam.runSettlement({
      request,
      outcome: "failure",
      model: handler.model,
      promptTokens: 0,
      completionTokens: 0
    });
  }

  private handleProviderAccountState(
    error: unknown,
    accountPool: { setCooldown(accountId: string, cooldownUntil: Date, error?: string): void; disable(accountId: string, error?: string): void },
    accountId: string,
    cooldownMs: number
  ): void {
    if (!(error instanceof ProviderError)) return;
    if (error.code === "provider_rate_limited") {
      accountPool.setCooldown(accountId, new Date(Date.now() + cooldownMs), error.message);
    }
    if (error.code === "provider_auth_error") {
      accountPool.disable(accountId, error.message);
    }
    if (error.code === "provider_account_suspended") {
      accountPool.disable(accountId, error.message);
    }
  }
}
