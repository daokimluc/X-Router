export class ConcurrencyLimitError extends Error {
  readonly code: string;
  readonly statusCode = 503;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConcurrencyLimitError";
    this.code = code;
  }
}

export class ConcurrencyLimiter {
  private globalActive = 0;
  private readonly providerActive = new Map<string, number>();

  constructor(private readonly maxGlobalConcurrentRequests: number) {}

  acquireGlobal(): () => void {
    if (this.globalActive >= this.maxGlobalConcurrentRequests) {
      throw new ConcurrencyLimitError(
        "gateway_overloaded",
        "Gateway is overloaded"
      );
    }

    this.globalActive += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.globalActive = Math.max(0, this.globalActive - 1);
    };
  }

  acquireProvider(providerInstanceId: string, maxConcurrentRequests: number): () => void {
    const active = this.providerActive.get(providerInstanceId) ?? 0;

    if (active >= maxConcurrentRequests) {
      throw new ConcurrencyLimitError(
        "provider_overloaded",
        `Provider instance ${providerInstanceId} is overloaded`
      );
    }

    this.providerActive.set(providerInstanceId, active + 1);
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      const current = this.providerActive.get(providerInstanceId) ?? 0;
      this.providerActive.set(providerInstanceId, Math.max(0, current - 1));
    };
  }

  getGlobalActive(): number {
    return this.globalActive;
  }
}

