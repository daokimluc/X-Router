/**
 * Image-to-Text Handler
 *
 * Accepts base64-encoded image or URL with text prompt and returns
 * normalized text response.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import type { MediaKindHandler, MediaRequestBuild } from "../MediaKindHandler.js";
import type { MediaServiceConfig } from "../types.js";

export type ImageToTextRequest = {
  model?: string;
  image: string; // base64 data URI or URL
  prompt?: string;
};

export type ImageToTextResponse = {
  text: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
};

export class ImageToTextHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown
  ): MediaRequestBuild {
    const req = payload as ImageToTextRequest;
    const format = config.format || "openai";

    switch (format) {
      case "openai":
      default:
        return this.buildOpenAIVisionRequest(config, model, req, credentials);
    }
  }

  normalizeResponse(responseBody: Buffer, statusCode: number): unknown {
    if (statusCode >= 400) {
      return this.parseErrorResponse(responseBody, statusCode);
    }

    const raw = JSON.parse(responseBody.toString("utf-8"));

    // Already in our format
    if (typeof raw.text === "string" && raw.model) {
      return raw as ImageToTextResponse;
    }

    // OpenAI chat completion format (vision response)
    if (raw.choices && Array.isArray(raw.choices)) {
      const text = raw.choices[0]?.message?.content || "";
      return {
        text,
        model: raw.model || "unknown",
        usage: raw.usage
          ? {
              prompt_tokens: raw.usage.prompt_tokens ?? 0,
              completion_tokens: raw.usage.completion_tokens ?? 0,
            }
          : undefined,
      } as ImageToTextResponse;
    }

    // Generic text response
    if (typeof raw.text === "string") {
      return {
        text: raw.text,
        model: raw.model || "unknown",
      } as ImageToTextResponse;
    }

    // Fallback
    return {
      text: JSON.stringify(raw),
      model: "unknown",
    } as ImageToTextResponse;
  }

  private buildOpenAIVisionRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageToTextRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    // Determine image content type
    const imageContent = this.buildImageContent(req.image);

    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            ...(req.prompt ? [{ type: "text", text: req.prompt }] : []),
            imageContent,
          ],
        },
      ],
      max_tokens: 1024,
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildImageContent(image: string): Record<string, unknown> {
    // Check if it's a data URI (base64)
    if (image.startsWith("data:")) {
      return {
        type: "image_url",
        image_url: { url: image },
      };
    }

    // Check if it's a URL
    if (image.startsWith("http://") || image.startsWith("https://")) {
      return {
        type: "image_url",
        image_url: { url: image },
      };
    }

    // Assume raw base64 — wrap in data URI
    return {
      type: "image_url",
      image_url: { url: `data:image/png;base64,${image}` },
    };
  }

  private buildAuthHeaders(
    config: MediaServiceConfig,
    credentials: unknown
  ): Record<string, string> {
    const creds = credentials as Record<string, string> | null;
    if (!creds) return {};

    const token = creds.apiKey || creds.accessToken || creds.token || "";

    switch (config.authType) {
      case "bearer":
        return { Authorization: `Bearer ${token}` };
      case "apikey":
        return { [config.authHeader || "x-api-key"]: token };
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
