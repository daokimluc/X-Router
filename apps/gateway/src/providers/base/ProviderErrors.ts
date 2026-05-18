export type ProviderErrorCode =
  | "provider_auth_error"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_network_error"
  | "provider_bad_response"
  | "provider_unavailable"
  | "provider_config_error"
  | "unsupported_capability";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(options: {
    code: ProviderErrorCode;
    message: string;
    retryable?: boolean;
    statusCode?: number;
  }) {
    super(options.message);
    this.name = "ProviderError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

export class ProviderConfigError extends ProviderError {
  constructor(message: string) {
    super({
      code: "provider_config_error",
      message,
      retryable: false,
      statusCode: 500
    });
    this.name = "ProviderConfigError";
  }
}

export class UnsupportedCapabilityError extends ProviderError {
  constructor(message: string) {
    super({
      code: "unsupported_capability",
      message,
      retryable: false,
      statusCode: 400
    });
    this.name = "UnsupportedCapabilityError";
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(providerType: string, message: string) {
    super({
      code: "provider_auth_error",
      message: `[${providerType}] Authentication failed: ${message}`,
      retryable: false,
      statusCode: 401
    });
    this.name = "ProviderAuthError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  readonly retryAfterSeconds?: number;

  constructor(providerType: string, retryAfterSeconds?: number) {
    super({
      code: "provider_rate_limited",
      message: `[${providerType}] Rate limited${retryAfterSeconds ? `, retry after ${retryAfterSeconds}s` : ""}`,
      retryable: true,
      statusCode: 429
    });
    this.name = "ProviderRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(providerType: string, baseUrl: string, timeoutMs: number) {
    super({
      code: "provider_timeout",
      message: `[${providerType}] Request timeout after ${timeoutMs}ms to ${baseUrl}`,
      retryable: true,
      statusCode: 504
    });
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(providerType: string, statusCode: number) {
    super({
      code: "provider_unavailable",
      message: `[${providerType}] Provider unavailable (HTTP ${statusCode})`,
      retryable: true,
      statusCode
    });
    this.name = "ProviderUnavailableError";
  }
}
