/**
 * Common interface for media kind handlers.
 *
 * Each handler knows how to build an upstream request for its media kind
 * and how to normalize the upstream response into the gateway's standard format.
 */

import type { MediaServiceConfig } from "./types.js";

export type MediaRequestBuild = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Buffer | null;
};

/**
 * Optional contextual information passed alongside the build call. Used by
 * handlers that need to apply provider-specific behaviour (e.g. injecting
 * `HTTP-Referer` for OpenRouter) without relying on hard-coded URL matching.
 */
export type MediaRequestContext = {
  providerType: string;
};

export interface MediaKindHandler {
  /**
   * Build the upstream HTTP request from the gateway payload.
   *
   * @param config - The media service configuration for this provider/kind
   * @param model - The resolved model identifier
   * @param payload - The incoming request payload (kind-specific)
   * @param credentials - The decrypted credential payload for the account
   * @param context - Optional context (e.g. providerType) for provider-specific tweaks
   */
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown,
    context?: MediaRequestContext
  ): MediaRequestBuild;

  /**
   * Normalize the upstream response body into the gateway's standard format.
   *
   * @param responseBody - Raw response body buffer from upstream
   * @param statusCode - HTTP status code from upstream
   */
  normalizeResponse(responseBody: Buffer, statusCode: number): unknown;
}
