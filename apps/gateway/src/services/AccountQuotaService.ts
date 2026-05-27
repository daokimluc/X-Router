export type AccountQuotaConfig = {
  dailyRequestLimit: number;
  dailyTokenLimit: number;
};

type QuotaState = {
  dayKey: string;
  requests: number;
  tokens: number;
  exhausted: boolean;
};

const DEFAULT_CONFIG: AccountQuotaConfig = {
  dailyRequestLimit: 500,
  dailyTokenLimit: 1_000_000
};

export class AccountQuotaService {
  private readonly quotas = new Map<string, QuotaState>();
  private readonly config: AccountQuotaConfig;

  constructor(config: Partial<AccountQuotaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  recordUsage(accountId: string, tokens: number): void {
    const state = this.getOrCreate(accountId);
    state.requests += 1;
    state.tokens += tokens;
    state.exhausted =
      state.requests >= this.config.dailyRequestLimit ||
      state.tokens >= this.config.dailyTokenLimit;
  }

  isExhausted(accountId: string): boolean {
    const state = this.quotas.get(accountId);
    if (!state) return false;
    if (state.dayKey !== todayKey()) {
      this.quotas.delete(accountId);
      return false;
    }
    return state.exhausted;
  }

  getSnapshot(accountId: string): {
    requests: number;
    tokens: number;
    exhausted: boolean;
    dailyRequestLimit: number;
    dailyTokenLimit: number;
  } {
    const state = this.getOrCreate(accountId);
    return {
      requests: state.requests,
      tokens: state.tokens,
      exhausted: state.exhausted,
      dailyRequestLimit: this.config.dailyRequestLimit,
      dailyTokenLimit: this.config.dailyTokenLimit
    };
  }

  resetAccount(accountId: string): void {
    this.quotas.delete(accountId);
  }

  resetAll(): void {
    this.quotas.clear();
  }

  listExhausted(): string[] {
    const today = todayKey();
    const result: string[] = [];
    for (const [id, state] of this.quotas) {
      if (state.dayKey === today && state.exhausted) {
        result.push(id);
      }
    }
    return result;
  }

  private getOrCreate(accountId: string): QuotaState {
    const today = todayKey();
    const existing = this.quotas.get(accountId);
    if (existing && existing.dayKey === today) {
      return existing;
    }
    const fresh: QuotaState = { dayKey: today, requests: 0, tokens: 0, exhausted: false };
    this.quotas.set(accountId, fresh);
    return fresh;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
