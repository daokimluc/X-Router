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
      if (state.openedAt && now.getTime() - state.openedAt.getTime() >= config.cooldownMs) {
        state.state = "half_open";
        state.halfOpenActiveRequests = 0;
      } else {
        return false;
      }
    }

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
    if (!this.canRequest(providerInstanceId, config, now)) {
      throw new CircuitBreakerOpenError(providerInstanceId);
    }

    const state = this.getState(providerInstanceId);

    if (state.state === "half_open") {
      state.halfOpenActiveRequests += 1;
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
    if (!config.enabled) {
      return;
    }

    const state = this.getState(providerInstanceId);
    state.halfOpenActiveRequests = Math.max(0, state.halfOpenActiveRequests - 1);
    state.consecutiveFailures += 1;

    if (
      state.state === "half_open" ||
      state.consecutiveFailures >= config.failureThreshold
    ) {
      state.state = "open";
      state.openedAt = now;
    }
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

