/**
 * Embedding Handler
 *
 * Transforms embedding requests to upstream format and normalizes responses
 * to the standard OpenAI embeddings response format.
 *
 * Dispatches on `config.format` to support OpenAI-compatible providers
 * (the majority) and Google Gemini's `embedContent` / `batchEmbedContents`
 * shape. Ported from 9router's embeddings adapter registry.
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5
 */

import type {
  MediaKindHandler,
  MediaRequestBuild,
  MediaRequestContext,
} from "../MediaKindHandler.js";
import type { MediaServiceConfig, EmbeddingRequest, EmbeddingResponse } from "../types.js";

type Credentials = {
  apiKey?: string;
  accessToken?: string;
  token?: string;
};

export class EmbeddingHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown,
    context?: MediaRequestContext
  ): MediaRequestBuild {
    const req = payload as EmbeddingRequest;
    const format = (config.format || "openai").toLowerCase();

    switch (format) {
      case "gemini":
        return this.buildGeminiRequest(config, model, req, credentials);
      case "openai":
      default:
        return this.buildOpenAIRequest(config, model, req, credentials, context);
    }
  }

  normalizeResponse(responseBody: Buffer, statusCode: number): unknown {
    if (statusCode >= 400) {
      return this.parseErrorResponse(responseBody, statusCode);
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(responseBody.toString("utf-8"));
    } catch {
      return {
        error: {
          type: "upstream_error",
          message: "Failed to parse upstream response",
          code: "invalid_response",
        },
      };
    }

    // If already in OpenAI format, return as-is
    if (raw.object === "list" && Array.isArray(raw.data)) {
      return raw as unknown as EmbeddingResponse;
    }

    // Normalize from other formats (e.g. Gemini)
    const embeddings = this.extractEmbeddings(raw);
    const modelName = (raw.model as string) || "unknown";
    const usage = (raw.usage as Record<string, number> | undefined) ?? {};

    const response: EmbeddingResponse = {
      object: "list",
      data: embeddings.map((embedding, index) => ({
        object: "embedding" as const,
        index,
        embedding,
      })),
      model: modelName,
      usage: {
        prompt_tokens: usage.prompt_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      },
    };

    return response;
  }

  // --- Format-specific request builders ------------------------------------

  private buildOpenAIRequest(
    config: MediaServiceConfig,
    model: string,
    req: EmbeddingRequest,
    credentials: unknown,
    context?: MediaRequestContext
  ): MediaRequestBuild {
    const url = this.resolveOpenAIUrl(config.baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    // OpenRouter requires a referer + title for routing/attribution.
    if (context?.providerType === "openrouter") {
      headers["HTTP-Referer"] = "https://accountrouter.local";
      headers["X-Title"] = "Accountrouter";
    }

    const body: Record<string, unknown> = {
      model,
      input: req.input,
    };
    if (req.encoding_format) body.encoding_format = req.encoding_format;
    if (req.dimensions != null) {
      const dim = Number(req.dimensions);
      if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
    }

    return {
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildGeminiRequest(
    config: MediaServiceConfig,
    model: string,
    req: EmbeddingRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    const path = this.geminiModelPath(model);
    const op = Array.isArray(req.input) ? "batchEmbedContents" : "embedContent";
    const apiKey = this.extractApiKey(credentials);
    const url = `${base}/${path}:${op}?key=${encodeURIComponent(apiKey)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let body: Record<string, unknown>;
    if (Array.isArray(req.input)) {
      body = {
        requests: req.input.map((text) => ({
          model: path,
          content: { parts: [{ text: String(text) }] },
        })),
      };
    } else {
      body = {
        model: path,
        content: { parts: [{ text: String(req.input ?? "") }] },
      };
    }

    return {
      url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  // --- Helpers --------------------------------------------------------------

  /**
   * Returns a fully-qualified embeddings URL. The catalog stores the full
   * URL ending in `/embeddings`, but be tolerant of users who paste a base
   * like `https://api.openai.com/v1`.
   */
  private resolveOpenAIUrl(rawBaseUrl: string): string {
    const base = rawBaseUrl.replace(/\/$/, "");
    return base.endsWith("/embeddings") ? base : `${base}/embeddings`;
  }

  private geminiModelPath(model: string): string {
    return model.startsWith("models/") ? model : `models/${model}`;
  }

  private extractApiKey(credentials: unknown): string {
    const creds = (credentials as Credentials | null) ?? {};
    return creds.apiKey || creds.accessToken || creds.token || "";
  }

  private extractEmbeddings(raw: Record<string, unknown>): number[][] {
    // OpenAI-style data array
    if (Array.isArray(raw.data)) {
      return raw.data.map((item) => {
        const entry = item as Record<string, unknown>;
        if (Array.isArray(entry.embedding)) return entry.embedding as number[];
        if (Array.isArray(entry.values)) return entry.values as number[];
        return [];
      });
    }

    // Single Gemini embedContent: { embedding: { values: number[] } }
    const single = raw.embedding as { values?: unknown } | undefined;
    if (single && Array.isArray(single.values)) {
      return [single.values as number[]];
    }

    // Batch Gemini batchEmbedContents: { embeddings: [{ values: [...] }, ...] }
    if (Array.isArray(raw.embeddings)) {
      return raw.embeddings.map((entry) => {
        if (Array.isArray(entry)) return entry as number[];
        const obj = entry as { values?: unknown } | null;
        if (obj && Array.isArray(obj.values)) return obj.values as number[];
        return [];
      });
    }

    return [];
  }

  private buildAuthHeaders(
    config: MediaServiceConfig,
    credentials: unknown
  ): Record<string, string> {
    const creds = credentials as Credentials | null;
    if (!creds) return {};

    const token = creds.apiKey || creds.accessToken || creds.token || "";

    switch (config.authType) {
      case "bearer":
        return { Authorization: `Bearer ${token}` };
      case "apikey": {
        // 9router uses authHeader to disambiguate placement: "bearer" -> Authorization,
        // "key" -> URL query (handled by gemini path), otherwise use it as the header name.
        const header = (config.authHeader || "x-api-key").toLowerCase();
        if (header === "bearer") return { Authorization: `Bearer ${token}` };
        if (header === "key") return {}; // key goes in the URL (gemini); openai-compat shouldn't hit this
        return { [config.authHeader || "x-api-key"]: token };
      }
      case "custom":
        return { [config.authHeader || "Authorization"]: token };
      case "none":
      default:
        return {};
    }
  }

  private parseErrorResponse(responseBody: Buffer, statusCode: number): unknown {
    try {
      return JSON.parse(responseBody.toString("utf-8"));
    } catch {
      return {
        error: {
          type: "upstream_error",
          message: `Upstream returned status ${statusCode}`,
          code: "upstream_error",
        },
      };
    }
  }
}
