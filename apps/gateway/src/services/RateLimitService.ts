export type RateLimitConfig = {
  requestsPerMinute: number;
  dailyRequestQuota: number;
  dailyTokenQuota: number;
};

export type RateLimitDecision =
  | { allowed: true; snapshot: ApiKeyLimitSnapshot }
  | {
      allowed: false;
      code:
        | "internal_rate_limit_exceeded"
        | "internal_quota_exceeded"
        | "internal_token_quota_exceeded";
      message: string;
      snapshot: ApiKeyLimitSnapshot;
    };

export type ApiKeyLimitSnapshot = {
  apiKeyHash: string;
  minuteWindowStart: string;
  minuteRequests: number;
  requestsPerMinuteLimit: number;
  dailyWindowStart: string;
  dailyRequests: number;
  dailyRequestQuota: number;
  dailyTokens: number;
  dailyTokenQuota: number;
};

type CounterState = {
  minuteWindowStart: number;
  minuteRequests: number;
  dailyWindowStart: string;
  dailyRequests: number;
  dailyTokens: number;
};

export type PerKeyLimits = {
  requestsPerMinute?: number;
  dailyRequestQuota?: number;
  dailyTokenQuota?: number;
};

export type RateLimitSnapshotPersisted = {
  apiKeyHash: string;
  minuteWindowStart: number;
  minuteRequests: number;
  dailyWindowStart: string;
  dailyRequests: number;
  dailyTokens: number;
};

export class RateLimitService {
  private readonly counters = new Map<string, CounterState>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  checkAndConsume(
    apiKeyHash: string,
    perKeyLimits?: PerKeyLimits
  ): RateLimitDecision {
    const current = this.getCurrentState(apiKeyHash);
    const rpm = perKeyLimits?.requestsPerMinute ?? this.config.requestsPerMinute;
    const daily = perKeyLimits?.dailyRequestQuota ?? this.config.dailyRequestQuota;
    const tokenDaily =
      perKeyLimits?.dailyTokenQuota ?? this.config.dailyTokenQuota;
    const snapshotBefore = this.toSnapshotWithLimits(
      apiKeyHash,
      current,
      rpm,
      daily,
      tokenDaily
    );

    if (rpm > 0 && current.minuteRequests >= rpm) {
      return {
        allowed: false,
        code: "internal_rate_limit_exceeded",
        message: "Internal rate limit exceeded",
        snapshot: snapshotBefore
      };
    }

    if (daily > 0 && current.dailyRequests >= daily) {
      return {
        allowed: false,
        code: "internal_quota_exceeded",
        message: "Internal daily request quota exceeded",
        snapshot: snapshotBefore
      };
    }

    if (tokenDaily > 0 && current.dailyTokens >= tokenDaily) {
      return {
        allowed: false,
        code: "internal_token_quota_exceeded",
        message: "Internal daily token quota exceeded",
        snapshot: snapshotBefore
      };
    }

    current.minuteRequests += 1;
    current.dailyRequests += 1;
    this.counters.set(apiKeyHash, current);

    return {
      allowed: true,
      snapshot: this.toSnapshotWithLimits(
        apiKeyHash,
        current,
        rpm,
        daily,
        tokenDaily
      )
    };
  }

  /** Record actual token usage after a request completes. */
  consumeTokens(apiKeyHash: string, tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    const current = this.getCurrentState(apiKeyHash);
    current.dailyTokens += Math.floor(tokens);
    this.counters.set(apiKeyHash, current);
  }

  getSnapshot(apiKeyHash: string): ApiKeyLimitSnapshot {
    return this.toSnapshot(apiKeyHash, this.getCurrentState(apiKeyHash));
  }

  /** Snapshot all currently tracked keys (for dashboard/admin views). */
  listSnapshots(): ApiKeyLimitSnapshot[] {
    return Array.from(this.counters.keys()).map((hash) => this.getSnapshot(hash));
  }

  /** Persist counter state. */
  exportState(): RateLimitSnapshotPersisted[] {
    return Array.from(this.counters.entries()).map(([apiKeyHash, state]) => ({
      apiKeyHash,
      minuteWindowStart: state.minuteWindowStart,
      minuteRequests: state.minuteRequests,
      dailyWindowStart: state.dailyWindowStart,
      dailyRequests: state.dailyRequests,
      dailyTokens: state.dailyTokens
    }));
  }

  /** Restore previously persisted counters; stale windows are auto-reset. */
  loadState(snapshots: RateLimitSnapshotPersisted[]): void {
    this.counters.clear();
    for (const snap of snapshots) {
      this.counters.set(snap.apiKeyHash, {
        minuteWindowStart: snap.minuteWindowStart,
        minuteRequests: snap.minuteRequests,
        dailyWindowStart: snap.dailyWindowStart,
        dailyRequests: snap.dailyRequests,
        dailyTokens: snap.dailyTokens ?? 0
      });
    }
  }

  reset(apiKeyHash?: string): void {
    if (apiKeyHash) {
      this.counters.delete(apiKeyHash);
      return;
    }
    this.counters.clear();
  }

  private getCurrentState(apiKeyHash: string): CounterState {
    const now = this.now();
    const minuteWindowStart = Math.floor(now.getTime() / 60000) * 60000;
    const dailyWindowStart = now.toISOString().slice(0, 10);
    const current = this.counters.get(apiKeyHash);

    if (!current) {
      return {
        minuteWindowStart,
        minuteRequests: 0,
        dailyWindowStart,
        dailyRequests: 0,
        dailyTokens: 0
      };
    }

    return {
      minuteWindowStart,
      minuteRequests:
        current.minuteWindowStart === minuteWindowStart
          ? current.minuteRequests
          : 0,
      dailyWindowStart,
      dailyRequests:
        current.dailyWindowStart === dailyWindowStart
          ? current.dailyRequests
          : 0,
      dailyTokens:
        current.dailyWindowStart === dailyWindowStart
          ? current.dailyTokens
          : 0
    };
  }

  private toSnapshot(
    apiKeyHash: string,
    state: CounterState
  ): ApiKeyLimitSnapshot {
    return this.toSnapshotWithLimits(
      apiKeyHash,
      state,
      this.config.requestsPerMinute,
      this.config.dailyRequestQuota,
      this.config.dailyTokenQuota
    );
  }

  private toSnapshotWithLimits(
    apiKeyHash: string,
    state: CounterState,
    rpm: number,
    daily: number,
    tokenDaily: number
  ): ApiKeyLimitSnapshot {
    return {
      apiKeyHash,
      minuteWindowStart: new Date(state.minuteWindowStart).toISOString(),
      minuteRequests: state.minuteRequests,
      requestsPerMinuteLimit: rpm,
      dailyWindowStart: state.dailyWindowStart,
      dailyRequests: state.dailyRequests,
      dailyRequestQuota: daily,
      dailyTokens: state.dailyTokens,
      dailyTokenQuota: tokenDaily
    };
  }
}
