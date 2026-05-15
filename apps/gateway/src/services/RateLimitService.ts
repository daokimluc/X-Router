export type RateLimitConfig = {
  requestsPerMinute: number;
  dailyRequestQuota: number;
};

export type RateLimitDecision =
  | { allowed: true; snapshot: ApiKeyLimitSnapshot }
  | {
      allowed: false;
      code: "internal_rate_limit_exceeded" | "internal_quota_exceeded";
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
};

type CounterState = {
  minuteWindowStart: number;
  minuteRequests: number;
  dailyWindowStart: string;
  dailyRequests: number;
};

export class RateLimitService {
  private readonly counters = new Map<string, CounterState>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  checkAndConsume(apiKeyHash: string, perKeyLimits?: { requestsPerMinute?: number; dailyRequestQuota?: number }): RateLimitDecision {
    const current = this.getCurrentState(apiKeyHash);
    const rpm = perKeyLimits?.requestsPerMinute ?? this.config.requestsPerMinute;
    const daily = perKeyLimits?.dailyRequestQuota ?? this.config.dailyRequestQuota;
    const snapshotBefore = this.toSnapshotWithLimits(apiKeyHash, current, rpm, daily);

    if (
      rpm > 0 &&
      current.minuteRequests >= rpm
    ) {
      return {
        allowed: false,
        code: "internal_rate_limit_exceeded",
        message: "Internal rate limit exceeded",
        snapshot: snapshotBefore
      };
    }

    if (
      daily > 0 &&
      current.dailyRequests >= daily
    ) {
      return {
        allowed: false,
        code: "internal_quota_exceeded",
        message: "Internal daily request quota exceeded",
        snapshot: snapshotBefore
      };
    }

    current.minuteRequests += 1;
    current.dailyRequests += 1;
    this.counters.set(apiKeyHash, current);

    return {
      allowed: true,
      snapshot: this.toSnapshotWithLimits(apiKeyHash, current, rpm, daily)
    };
  }

  getSnapshot(apiKeyHash: string): ApiKeyLimitSnapshot {
    return this.toSnapshot(apiKeyHash, this.getCurrentState(apiKeyHash));
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
        dailyRequests: 0
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
        current.dailyWindowStart === dailyWindowStart ? current.dailyRequests : 0
    };
  }

  private toSnapshot(
    apiKeyHash: string,
    state: CounterState
  ): ApiKeyLimitSnapshot {
    return this.toSnapshotWithLimits(apiKeyHash, state, this.config.requestsPerMinute, this.config.dailyRequestQuota);
  }

  private toSnapshotWithLimits(
    apiKeyHash: string,
    state: CounterState,
    rpm: number,
    daily: number
  ): ApiKeyLimitSnapshot {
    return {
      apiKeyHash,
      minuteWindowStart: new Date(state.minuteWindowStart).toISOString(),
      minuteRequests: state.minuteRequests,
      requestsPerMinuteLimit: rpm,
      dailyWindowStart: state.dailyWindowStart,
      dailyRequests: state.dailyRequests,
      dailyRequestQuota: daily
    };
  }
}
