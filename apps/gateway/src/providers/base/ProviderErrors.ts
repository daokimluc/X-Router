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

