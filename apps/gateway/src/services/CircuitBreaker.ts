export type CircuitBreakerState = "closed" | "open" | "half_open";

type CircuitState = {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAt?: Date;
  halfOpenActiveRequests: number;
};

export class CircuitBreakerOpenError extends Error {
  readonly code = "circuit_breaker_open";
  readonly statusCode = 503;

  constructor(providerInstanceId: string) {
    super(`Circuit breaker is open for provider instance ${providerInstanceId}`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  /**
   * Pure predicate — reports whether a request may be admitted right now without
   * mutating any state. (The open→half_open transition happens in
   * {@link beforeRequest}, so callers can peek with `canRequest` freely.)
   */
  canRequest(
    providerInstanceId: string,
    config: {
      enabled: boolean;
      failureThreshold: number;
      cooldownMs: number;
      halfOpenMaxRequests: number;
    },
    now = new Date()
  ): boolean {
    if (!config.enabled) {
      return true;
    }

    const state = this.getState(providerInstanceId);

    if (state.state === "closed") {
      return true;
    }

    if (state.state === "open") {
      // Cooldown elapsed → a single probe becomes admissible. Do NOT mutate here;
      // beforeRequest performs the transition to half_open.
      return Boolean(
        state.openedAt && now.getTime() - state.openedAt.getTime() >= config.cooldownMs
      );
    }

    // half_open
    return state.halfOpenActiveRequests < config.halfOpenMaxRequests;
  }

  beforeRequest(
    providerInstanceId: string,
    config: {
      enabled: boolean;
      failureThreshold: number;
      cooldownMs: number;
      halfOpenMaxRequests: number;
    },
    now = new Date()
  ): void {
    if (!config.enabled) {
      return;
    }

    if (!this.canRequest(providerInstanceId, config, now)) {
      throw new CircuitBreakerOpenError(providerInstanceId);
    }

    const state = this.getState(providerInstanceId);

    // Transition open→half_open once the cooldown has elapsed (canRequest already
    // confirmed admissibility). Resetting the probe counter here keeps the
    // predicate side-effect-free.
    if (state.state === "open") {
      state.state = "half_open";
      state.halfOpenActiveRequests = 0;
    }

    if (state.state === "half_open") {
      state.halfOpenActiveRequests += 1;
    }
  }

  /**
   * Terminal accounting for an admitted request. MUST be called exactly once for
   * every request that passed {@link beforeRequest}, regardless of how it ends.
   *
   * - A half-open probe that finishes always releases its in-flight slot.
   * - `ok` → the circuit closes (covers a successful probe and resets the
   *   closed-state failure streak).
   * - a half-open probe that fails for ANY reason reopens the circuit and
   *   restarts the cooldown, so a fresh probe is admitted after `cooldownMs`.
   * - in the closed state only `countsAsFailure` (circuit-classified) failures
   *   advance the failure threshold; other failures (e.g. auth errors, which
   *   disable the account by a separate mechanism) are ignored by the breaker.
   */
  recordResult(
    providerInstanceId: string,
    outcome: { ok: boolean; countsAsFailure: boolean },
    config: {
      enabled: boolean;
      failureThreshold: number;
    },
    now = new Date()
  ): void {
    if (!config.enabled) {
      return;
    }

    const state = this.getState(providerInstanceId);
    const wasHalfOpen = state.state === "half_open";

    if (wasHalfOpen) {
      state.halfOpenActiveRequests = Math.max(0, state.halfOpenActiveRequests - 1);
    }

    if (outcome.ok) {
      state.state = "closed";
      state.consecutiveFailures = 0;
      state.openedAt = undefined;
      state.halfOpenActiveRequests = 0;
      return;
    }

    if (wasHalfOpen) {
      // Any failed probe reopens + restarts cooldown — never strand half-open.
      state.state = "open";
      state.openedAt = now;
      if (outcome.countsAsFailure) {
        state.consecutiveFailures += 1;
      }
      return;
    }

    if (outcome.countsAsFailure) {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= config.failureThreshold) {
        state.state = "open";
        state.openedAt = now;
      }
    }
  }

  /**
   * Release a half-open probe slot WITHOUT concluding the circuit. Used when an
   * admitted request will be immediately retried (e.g. after a credential
   * refresh) rather than counted as a terminal success or failure — so the retry
   * can re-acquire the probe slot instead of stranding it.
   */
  releaseProbe(providerInstanceId: string): void {
    const state = this.getState(providerInstanceId);
    if (state.state === "half_open") {
      state.halfOpenActiveRequests = Math.max(0, state.halfOpenActiveRequests - 1);
    }
  }

  recordSuccess(providerInstanceId: string): void {
    const state = this.getState(providerInstanceId);
    state.state = "closed";
    state.consecutiveFailures = 0;
    state.openedAt = undefined;
    state.halfOpenActiveRequests = 0;
  }

  recordFailure(
    providerInstanceId: string,
    config: {
      enabled: boolean;
      failureThreshold: number;
    },
    now = new Date()
  ): void {
    // A circuit-classified failure. Delegates to the unified terminal accounting.
    this.recordResult(
      providerInstanceId,
      { ok: false, countsAsFailure: true },
      config,
      now
    );
  }

  getCircuitState(providerInstanceId: string): CircuitBreakerState {
    return this.getState(providerInstanceId).state;
  }

  /** Manually reset the circuit breaker to closed state. */
  reset(providerInstanceId: string): void {
    const state = this.getState(providerInstanceId);
    state.state = "closed";
    state.consecutiveFailures = 0;
    state.halfOpenActiveRequests = 0;
    state.openedAt = undefined;
  }

  private getState(providerInstanceId: string): CircuitState {
    let state = this.states.get(providerInstanceId);

    if (!state) {
      state = {
        state: "closed",
        consecutiveFailures: 0,
        halfOpenActiveRequests: 0
      };
      this.states.set(providerInstanceId, state);
    }

    return state;
  }
}
