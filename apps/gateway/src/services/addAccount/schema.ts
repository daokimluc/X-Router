/**
 * Zod schema for AddAccountRequest and credential validation
 * @module services/addAccount/schema
 */

import { z } from "zod";
import type { CredentialMode } from "./normalize.js";

/**
 * ASCII printable characters regex (0x20-0x7E)
 */
const ASCII_PRINTABLE_REGEX = /^[\x20-\x7E]+$/;

/**
 * Credentials schema for refresh_token mode
 */
const refreshTokenCredentialsSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "Refresh token is required")
    .max(4096, "Refresh token must be at most 4096 characters"),
});

/**
 * Credentials schema for api_key mode
 */
const apiKeyCredentialsSchema = z.object({
  apiKey: z
    .string()
    .min(16, "API key must be at least 16 characters")
    .max(512, "API key must be at most 512 characters")
    .regex(ASCII_PRINTABLE_REGEX, "API key must contain only ASCII printable characters"),
});

/**
 * Credentials schema for mock_static mode
 */
const mockTokenCredentialsSchema = z.object({
  mockToken: z
    .string()
    .min(1, "Mock token is required")
    .max(256, "Mock token must be at most 256 characters"),
});

/**
 * Base AddAccountRequest schema (without mode-specific credential validation)
 */
export const addAccountRequestBaseSchema = z.object({
  label: z.string().min(1, "Label is required").max(200, "Label must be at most 200 characters"),
  credentialMode: z.enum(["oauth_pkce", "refresh_token", "api_key", "mock_static"]),
  weight: z.number().optional(),
  enabled: z.boolean().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  allowedModels: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  owner: z.string().min(1).optional(),
  credentials: z
    .object({
      refreshToken: z.string().optional(),
      apiKey: z.string().optional(),
      mockToken: z.string().optional(),
    })
    .optional(),
});

export type AddAccountRequestRaw = z.infer<typeof addAccountRequestBaseSchema>;

/**
 * Error codes for credential validation
 */
export type CredentialValidationErrorCode =
  | "invalid_refresh_token"
  | "invalid_api_key"
  | "invalid_mock_token"
  | "missing_credentials";

export class CredentialValidationError extends Error {
  readonly code: CredentialValidationErrorCode;
  readonly statusCode = 400;
  readonly field?: string;

  constructor(code: CredentialValidationErrorCode, message: string, field?: string) {
    super(message);
    this.name = "CredentialValidationError";
    this.code = code;
    this.field = field;
  }
}

/**
 * Validate credentials based on credential mode.
 * Throws CredentialValidationError if validation fails.
 */
export function validateCredentials(
  mode: CredentialMode,
  credentials?: AddAccountRequestRaw["credentials"]
): void {
  switch (mode) {
    case "oauth_pkce":
      // No credentials required for OAuth PKCE
      return;

    case "refresh_token": {
      if (!credentials?.refreshToken) {
        throw new CredentialValidationError(
          "invalid_refresh_token",
          "Refresh token is required for refresh_token mode",
          "credentials.refreshToken"
        );
      }
      const result = refreshTokenCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new CredentialValidationError(
          "invalid_refresh_token",
          issue?.message ?? "Invalid refresh token",
          "credentials.refreshToken"
        );
      }
      return;
    }

    case "api_key": {
      if (!credentials?.apiKey) {
        throw new CredentialValidationError(
          "invalid_api_key",
          "API key is required for api_key mode",
          "credentials.apiKey"
        );
      }
      const result = apiKeyCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new CredentialValidationError(
          "invalid_api_key",
          issue?.message ?? "Invalid API key",
          "credentials.apiKey"
        );
      }
      return;
    }

    case "mock_static": {
      if (!credentials?.mockToken) {
        throw new CredentialValidationError(
          "invalid_mock_token",
          "Mock token is required for mock_static mode",
          "credentials.mockToken"
        );
      }
      const result = mockTokenCredentialsSchema.safeParse(credentials);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new CredentialValidationError(
          "invalid_mock_token",
          issue?.message ?? "Invalid mock token",
          "credentials.mockToken"
        );
      }
      return;
    }

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown credential mode: ${_exhaustive}`);
    }
  }
}

/**
 * Parse and validate AddAccountRequest.
 * Returns parsed request or throws ZodError/CredentialValidationError.
 */
export function parseAddAccountRequest(raw: unknown): AddAccountRequestRaw {
  const parsed = addAccountRequestBaseSchema.parse(raw);
  validateCredentials(parsed.credentialMode, parsed.credentials);
  return parsed;
}
