/**
 * Image Generation Handler
 *
 * Transforms image generation requests to upstream format and normalizes
 * responses to the standard OpenAI images response format
 * (`{ created, data: [{ url|b64_json }] }`).
 *
 * Dispatches on `config.format` to support a wide range of providers ported
 * from 9router's `imageProviders/` adapter registry. Most providers are
 * synchronous (request → image bytes or JSON with b64). A few are async
 * with polling (BFL, Runway, Fal.ai queue) — those are documented inline
 * and currently return a `501 Not Implemented`-style payload from the
 * normalize step when only an `{id}` envelope is returned.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import type {
  MediaKindHandler,
  MediaRequestBuild,
  MediaRequestContext,
} from "../MediaKindHandler.js";
import type {
  MediaServiceConfig,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../types.js";
import { randomUUID } from "node:crypto";

type Credentials = {
  apiKey?: string;
  accessToken?: string;
  token?: string;
  /** Optional provider-specific data (e.g. Cloudflare account_id). */
  providerSpecificData?: Record<string, unknown>;
};

export class ImageGenerationHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown,
    context?: MediaRequestContext
  ): MediaRequestBuild {
    const req = (payload ?? {}) as ImageGenerationRequest;
    const format = (config.format || "openai").toLowerCase();

    switch (format) {
      case "gemini":
        return this.buildGeminiRequest(config, model, req, credentials);
      case "cloudflare":
        return this.buildCloudflareRequest(config, model, req, credentials);
      case "nanobanana":
        return this.buildNanoBananaRequest(config, model, req, credentials);
      case "huggingface":
        return this.buildHuggingFaceRequest(config, model, req, credentials);
      case "sdwebui":
        return this.buildSDWebUIRequest(config, model, req, credentials);
      case "comfyui":
        return this.buildComfyUIRequest(config, model, req, credentials);
      case "falai":
        return this.buildFalAiRequest(config, model, req, credentials);
      case "stability":
        return this.buildStabilityAiRequest(config, model, req, credentials);
      case "bfl":
        return this.buildBlackForestLabsRequest(config, model, req, credentials);
      case "runway":
        return this.buildRunwayMlRequest(config, model, req, credentials);
      case "codex":
        return this.buildCodexRequest(config, model, req, credentials);
      case "openai":
      default:
        return this.buildOpenAIRequest(config, model, req, credentials, context);
    }
  }

  normalizeResponse(responseBody: Buffer, statusCode: number): unknown {
    if (statusCode >= 400) {
      return this.parseErrorResponse(responseBody, statusCode);
    }

    const text = responseBody.toString("utf-8");

    // Codex SSE: look for "response.output_item.done" events containing
    // image_generation_call results. This handles the case where
    // proxyAwareFetch collected the full SSE stream as a buffer.
    if (text.includes("event:") && text.includes("response.output_item.done")) {
      const codexImage = this.extractCodexSseImage(text);
      if (codexImage) {
        return {
          created: nowSec(),
          data: [{ b64_json: codexImage }],
        } as ImageGenerationResponse;
      }
      // If we couldn't extract an image from the SSE, return an error.
      return {
        error: {
          type: "upstream_error",
          message:
            "Codex did not return an image. Account may not be entitled (Plus/Pro required).",
          code: "codex_no_image",
        },
      };
    }

    // Try JSON first; fall back to binary → b64_json.
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Binary image response — encode as b64_json.
      const b64 = responseBody.toString("base64");
      return {
        created: nowSec(),
        data: [{ b64_json: b64 }],
      } as ImageGenerationResponse;
    }

    if (!raw || typeof raw !== "object") {
      return {
        created: nowSec(),
        data: [],
      } as ImageGenerationResponse;
    }

    const obj = raw as Record<string, unknown>;

    // Already in OpenAI images format.
    if (typeof obj.created === "number" && Array.isArray(obj.data)) {
      return obj as unknown as ImageGenerationResponse;
    }

    // Gemini: { candidates: [{ content: { parts: [{ inlineData: { data } }] } }] }
    const geminiImages = this.extractGeminiImages(obj);
    if (geminiImages.length > 0) {
      return {
        created: nowSec(),
        data: geminiImages.map((b64) => ({ b64_json: b64 })),
      } as ImageGenerationResponse;
    }

    // Cloudflare Workers AI: { result: { image: <b64> } } or
    // { success, result: { image, ... } } or { result: { responses: [...] } }.
    const cfNormalized = this.normalizeCloudflareLike(obj);
    if (cfNormalized) return cfNormalized;

    // SD WebUI: { images: [<b64>, ...] }
    if (Array.isArray(obj.images) && obj.images.every((v) => typeof v === "string")) {
      return {
        created: nowSec(),
        data: (obj.images as string[]).map((b64) => ({ b64_json: b64 })),
      } as ImageGenerationResponse;
    }

    // Fal.ai: { images: [{ url, content_type, ... }] }
    if (Array.isArray(obj.images) && obj.images.length > 0 && typeof obj.images[0] === "object") {
      const items = (obj.images as Array<Record<string, unknown>>)
        .map((it) => {
          if (typeof it.url === "string") return { url: it.url };
          if (typeof it.b64_json === "string") return { b64_json: it.b64_json as string };
          return null;
        })
        .filter((v): v is { url: string } | { b64_json: string } => v !== null);
      if (items.length > 0) {
        return { created: nowSec(), data: items } as ImageGenerationResponse;
      }
    }

    // Stability AI v2beta JSON: { image: "<b64>", finish_reason, seed }.
    if (typeof obj.image === "string") {
      return {
        created: nowSec(),
        data: [{ b64_json: obj.image }],
      } as ImageGenerationResponse;
    }

    // BFL polled-result: { result: { sample: "<url>" } }.
    const bflResult = obj.result as Record<string, unknown> | undefined;
    if (bflResult && typeof bflResult.sample === "string") {
      return {
        created: nowSec(),
        data: [{ url: bflResult.sample }],
      } as ImageGenerationResponse;
    }

    // Runway/BFL submission envelope: just `{id}` or `{polling_url}`. The
    // synchronous gateway flow can't poll yet — surface a clear error.
    if (typeof obj.id === "string" || typeof obj.polling_url === "string") {
      return {
        error: {
          type: "not_implemented",
          message:
            "Async polling is not yet implemented for this provider. The upstream returned a job id; please poll the provider directly until support is added.",
          code: "async_polling_unsupported",
          job: {
            id: typeof obj.id === "string" ? obj.id : undefined,
            polling_url:
              typeof obj.polling_url === "string" ? obj.polling_url : undefined,
            status_url:
              typeof obj.status_url === "string" ? obj.status_url : undefined,
          },
        },
      };
    }

    // Generic shapes: { b64_json } | { output: <url|b64> }.
    if (typeof obj.b64_json === "string") {
      return {
        created: nowSec(),
        data: [{ b64_json: obj.b64_json }],
      } as ImageGenerationResponse;
    }
    if (typeof obj.output === "string") {
      const out = obj.output;
      const isUrl = /^https?:\/\//i.test(out);
      return {
        created: nowSec(),
        data: [isUrl ? { url: out } : { b64_json: out }],
      } as ImageGenerationResponse;
    }

    // Fallback: wrap as OpenAI envelope with the raw body so callers can
    // still see what came back.
    return {
      created: nowSec(),
      data: [],
      raw: obj,
    } as unknown as ImageGenerationResponse;
  }

  // --- Format-specific request builders ------------------------------------

  private buildOpenAIRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
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
      prompt: req.prompt,
    };

    if (req.n != null) body.n = req.n;
    if (req.size) body.size = req.size;
    if (req.quality) body.quality = req.quality;
    if (req.response_format) body.response_format = req.response_format;
    // Pass through optional fields if the caller supplied them.
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.style === "string") body.style = extra.style;
    if (typeof extra.background === "string") body.background = extra.background;
    if (typeof extra.output_format === "string") body.output_format = extra.output_format;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildGeminiRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    const modelPath = model.startsWith("models/") ? model : `models/${model}`;
    const apiKey = this.extractApiKey(credentials);
    const url = `${base}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const body = {
      contents: [{ parts: [{ text: req.prompt ?? "" }] }],
      generationConfig: {
        // Models that support image output respond with both TEXT and IMAGE
        // parts. Requesting both is safe for image-only models (the text
        // part is empty) and ensures we get inlineData back.
        responseModalities: ["TEXT", "IMAGE"],
      },
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildCloudflareRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const accountId = this.extractAccountId(credentials);
    const base = config.baseUrl.replace(/\/$/, "");
    // baseUrl is the Cloudflare API root (https://api.cloudflare.com/client/v4).
    // We append the per-account /accounts/{accountId}/ai/run/{model} path
    // unless the configured base already includes "/accounts/".
    const url = base.includes("/accounts/")
      ? `${base}/${model}`
      : accountId
      ? `${base}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`
      : `${base}/${model}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.size) {
      const [w, h] = req.size.split("x").map(Number);
      if (w) body.width = w;
      if (h) body.height = h;
    }
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.num_steps === "number") body.num_steps = extra.num_steps;
    if (typeof extra.guidance === "number") body.guidance = extra.guidance;
    if (typeof extra.negative_prompt === "string") body.negative_prompt = extra.negative_prompt;
    if (typeof extra.seed === "number") body.seed = extra.seed;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildNanoBananaRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    const url = base.endsWith("/v1/images/generations")
      ? base
      : `${base}/v1/images/generations`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = { model, prompt: req.prompt };
    if (req.n != null) body.n = req.n;
    if (req.size) body.size = req.size;
    if (req.quality) body.quality = req.quality;
    if (req.response_format) body.response_format = req.response_format;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildHuggingFaceRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    // baseUrl is the inference root; append the model id.
    const url = `${base}/${model}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "image/png",
      ...this.buildAuthHeaders(config, credentials),
    };

    const parameters: Record<string, unknown> = {};
    if (req.size) {
      const [w, h] = req.size.split("x").map(Number);
      if (w) parameters.width = w;
      if (h) parameters.height = h;
    }
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.negative_prompt === "string") parameters.negative_prompt = extra.negative_prompt;
    if (typeof extra.num_inference_steps === "number") parameters.num_inference_steps = extra.num_inference_steps;
    if (typeof extra.guidance_scale === "number") parameters.guidance_scale = extra.guidance_scale;

    const body: Record<string, unknown> = { inputs: req.prompt };
    if (Object.keys(parameters).length > 0) body.parameters = parameters;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildSDWebUIRequest(
    config: MediaServiceConfig,
    _model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    const url = base.endsWith("/sdapi/v1/txt2img") ? base : `${base}/sdapi/v1/txt2img`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      batch_size: req.n ?? 1,
      steps: 20,
    };
    if (req.size) {
      const [w, h] = req.size.split("x").map(Number);
      body.width = w || 512;
      body.height = h || 512;
    } else {
      body.width = 512;
      body.height = 512;
    }
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.negative_prompt === "string") body.negative_prompt = extra.negative_prompt;
    if (typeof extra.sampler_name === "string") body.sampler_name = extra.sampler_name;
    if (typeof extra.steps === "number") body.steps = extra.steps;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildComfyUIRequest(
    config: MediaServiceConfig,
    _model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // NOTE: ComfyUI uses a graph-based workflow API (POST /prompt with a
    // workflow JSON, then poll /history/{id} for results). This stub posts
    // a minimal payload — full workflow execution is not yet implemented.
    const base = config.baseUrl.replace(/\/$/, "");
    const url = base.endsWith("/prompt") ? base : `${base}/prompt`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body = { prompt: req.prompt };
    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildFalAiRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${model}`;

    // Fal.ai uses "Authorization: Key <token>", NOT Bearer.
    const token = this.extractApiKey(credentials);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Key ${token}`;

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      num_images: req.n ?? 1,
    };
    if (req.size) body.image_size = sizeToAspectRatio(req.size);
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.num_inference_steps === "number") body.num_inference_steps = extra.num_inference_steps;
    if (typeof extra.guidance_scale === "number") body.guidance_scale = extra.guidance_scale;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildStabilityAiRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Stability v2beta endpoint segment is derived from the model id.
    // Defaults to "core" when the id doesn't match a known engine.
    const engine = model.includes("ultra")
      ? "ultra"
      : model.includes("sd3")
      ? "sd3"
      : "core";
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${engine}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json", // Request JSON instead of raw bytes.
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      output_format: ((req as unknown as Record<string, unknown>).output_format as string ?? "png").toLowerCase(),
    };
    if (req.size) body.aspect_ratio = sizeToAspectRatio(req.size);
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.style === "string") body.style_preset = extra.style;
    if (typeof extra.seed === "number") body.seed = extra.seed;
    if (typeof extra.negative_prompt === "string") body.negative_prompt = extra.negative_prompt;
    if (engine === "sd3") body.model = model;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildBlackForestLabsRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // NOTE: BFL is async — this builds the submission. Full polling support
    // is not yet implemented; the gateway will surface a not_implemented
    // error when only the polling envelope is returned.
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${model}`;

    const token = this.extractApiKey(credentials);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["x-key"] = token;

    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.size) {
      const [w, h] = req.size.split("x").map(Number);
      if (w) body.width = w;
      if (h) body.height = h;
    }
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.prompt_upsampling === "boolean") body.prompt_upsampling = extra.prompt_upsampling;
    if (typeof extra.seed === "number") body.seed = extra.seed;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildRunwayMlRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // NOTE: Runway is async — this builds the submission. Full polling
    // support is not yet implemented; the gateway will surface a
    // not_implemented error when only the {id} envelope is returned.
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/text_to_image`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      promptText: req.prompt,
      model,
      ratio: sizeToAspectRatio(req.size ?? "1024x1024"),
    };
    const extra = req as unknown as Record<string, unknown>;
    if (typeof extra.seed === "number") body.seed = extra.seed;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  // --- Helpers --------------------------------------------------------------

  /**
   * Build a Codex (ChatGPT Plus/Pro) image generation request.
   *
   * Codex uses the ChatGPT Responses API with `tools: [{type: "image_generation"}]`.
   * The response is SSE — the gateway's proxyAwareFetch collects the full body
   * and normalizeResponse extracts the final image from the SSE events.
   *
   * Model naming: catalog stores "gpt-5.5-image" but the upstream expects
   * "gpt-5.5" (strip the "-image" suffix).
   */
  private buildCodexRequest(
    config: MediaServiceConfig,
    model: string,
    req: ImageGenerationRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
    const CODEX_USER_AGENT = "codex-imagen/0.2.6";
    const CODEX_VERSION = "0.129.0";
    const CODEX_ORIGINATOR = "codex_cli_rs";

    const url = config.baseUrl?.includes("/responses")
      ? config.baseUrl
      : CODEX_RESPONSES_URL;

    const creds = (credentials as Credentials | null) ?? {};
    const accessToken = creds.accessToken || creds.token || creds.apiKey || "";

    // Try to extract chatgpt_account_id from the JWT id_token if available.
    const accountId = this.decodeCodexAccountId(accessToken);

    const headers: Record<string, string> = {
      "accept": "text/event-stream, application/json",
      "authorization": `Bearer ${accessToken}`,
      "content-type": "application/json",
      "originator": CODEX_ORIGINATOR,
      "user-agent": CODEX_USER_AGENT,
      "version": CODEX_VERSION,
      "x-client-request-id": randomUUID(),
      "session_id": randomUUID(),
    };
    if (accountId) headers["chatgpt-account-id"] = accountId;

    // Strip "-image" suffix from model name for upstream.
    const upstreamModel = model.endsWith("-image")
      ? model.slice(0, -"-image".length)
      : model;

    // Build image_generation tool with optional params.
    const extra = req as unknown as Record<string, unknown>;
    const imgTool: Record<string, unknown> = {
      type: "image_generation",
      output_format: ((extra.output_format as string) || "png").toLowerCase(),
    };
    if (req.size && req.size !== "auto") imgTool.size = req.size;
    if (req.quality && req.quality !== "auto") imgTool.quality = req.quality;
    if (typeof extra.background === "string" && extra.background !== "auto") {
      imgTool.background = extra.background;
    }

    // Build content array (text + optional reference images).
    const content: Array<Record<string, unknown>> = [];
    const refImage = extra.image as string | undefined;
    if (refImage) {
      const imageUrl = this.toCodexDataUrl(refImage);
      if (imageUrl) {
        const detail = (extra.image_detail as string) || "high";
        content.push({ type: "input_text", text: "<image name=image1>" });
        content.push({ type: "input_image", image_url: imageUrl, detail });
        content.push({ type: "input_text", text: "</image>" });
      }
    }
    content.push({ type: "input_text", text: req.prompt ?? "" });

    const body = {
      model: upstreamModel,
      instructions: "",
      input: [{ type: "message", role: "user", content }],
      tools: [imgTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: randomUUID(),
      stream: true,
      store: false,
      reasoning: null,
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  /**
   * Decode chatgpt_account_id from a JWT access token (if it's a JWT).
   */
  private decodeCodexAccountId(token: string): string | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = (4 - (b64.length % 4)) % 4;
      const payload = JSON.parse(
        Buffer.from(b64 + "=".repeat(pad), "base64").toString("utf8")
      );
      return (
        payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null
      );
    } catch {
      return null;
    }
  }

  /**
   * Convert an image reference to a data URL or passthrough URL for Codex.
   */
  private toCodexDataUrl(input: string): string | null {
    if (!input || typeof input !== "string") return null;
    if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
    return `data:image/png;base64,${input}`;
  }

  /**
   * Extract the final base64 image from a Codex SSE stream buffer.
   * Looks for `event: response.output_item.done` with
   * `item.type === "image_generation_call"` and `item.result` as the b64 string.
   */
  private extractCodexSseImage(sseText: string): string | null {
    const blocks = sseText.split("\n\n");
    for (const block of blocks) {
      const lines = block.split("\n");
      let eventName = "";
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (eventName === "response.output_item.done" && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          const item = data?.item;
          if (item?.type === "image_generation_call" && typeof item.result === "string") {
            return item.result;
          }
        } catch {
          // Skip malformed JSON.
        }
      }
    }
    return null;
  }

  /**
   * Returns a fully-qualified images URL. The catalog stores the full URL
   * ending in `/images/generations`; be tolerant of users who paste the
   * `/v1` base or include a trailing slash.
   */
  private resolveOpenAIUrl(rawBaseUrl: string): string {
    const base = rawBaseUrl.replace(/\/$/, "");
    if (base.endsWith("/images/generations")) return base;
    return `${base}/images/generations`;
  }

  private extractApiKey(credentials: unknown): string {
    const creds = (credentials as Credentials | null) ?? {};
    return creds.apiKey || creds.accessToken || creds.token || "";
  }

  private extractAccountId(credentials: unknown): string {
    const creds = (credentials as Credentials | null) ?? {};
    const psd = creds.providerSpecificData;
    if (psd && typeof psd === "object") {
      const id = (psd as Record<string, unknown>).accountId;
      if (typeof id === "string" && id.length > 0) return id;
    }
    return "";
  }

  private buildAuthHeaders(
    config: MediaServiceConfig,
    credentials: unknown
  ): Record<string, string> {
    const token = this.extractApiKey(credentials);
    if (!token) return {};

    const authHeader = (config.authHeader || "").toLowerCase();

    switch (config.authType) {
      case "bearer":
        return { Authorization: `Bearer ${token}` };
      case "apikey": {
        if (authHeader === "bearer") return { Authorization: `Bearer ${token}` };
        if (authHeader === "key") return {}; // Key goes in URL/body (Gemini) — handled by caller.
        return { [config.authHeader || "x-api-key"]: token };
      }
      case "custom":
        return { [config.authHeader || "Authorization"]: token };
      case "none":
      default:
        return {};
    }
  }

  private extractGeminiImages(obj: Record<string, unknown>): string[] {
    const candidates = obj.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    if (!first) return [];
    const content = first.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (!Array.isArray(parts)) return [];
    const out: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = (part as Record<string, unknown>).inlineData as
        | Record<string, unknown>
        | undefined;
      const data = inlineData?.data;
      if (typeof data === "string" && data.length > 0) out.push(data);
    }
    return out;
  }

  private normalizeCloudflareLike(
    obj: Record<string, unknown>
  ): ImageGenerationResponse | null {
    // Direct shape: { result: { image: <b64> | <url> } } or batched
    // { result: { responses: [{ result: { image } }, ...] } }.
    const result = obj.result;
    if (!result || typeof result !== "object") return null;
    const rec = result as Record<string, unknown>;

    // Batched
    if (Array.isArray(rec.responses)) {
      const items: Array<{ url: string } | { b64_json: string }> = [];
      for (const entry of rec.responses) {
        if (!entry || typeof entry !== "object") continue;
        const entryRec = entry as Record<string, unknown>;
        const inner = entryRec.result;
        if (inner && typeof inner === "object") {
          const item = this.cloudflareImageItem(
            (inner as Record<string, unknown>).image
          );
          if (item) items.push(item);
        }
      }
      if (items.length > 0) {
        return { created: nowSec(), data: items };
      }
    }

    // Single image
    if (typeof rec.image === "string") {
      const item = this.cloudflareImageItem(rec.image);
      if (item) return { created: nowSec(), data: [item] };
    }

    // Sometimes "result" is itself the image string.
    if (typeof result === "string") {
      const item = this.cloudflareImageItem(result);
      if (item) return { created: nowSec(), data: [item] };
    }

    return null;
  }

  private cloudflareImageItem(
    value: unknown
  ): { url: string } | { b64_json: string } | null {
    if (typeof value !== "string" || value.length === 0) return null;
    if (/^data:image\/[^;]+;base64,/i.test(value)) {
      return { b64_json: value.replace(/^data:image\/[^;]+;base64,/i, "") };
    }
    if (/^https?:\/\//i.test(value)) return { url: value };
    return { b64_json: value };
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

// --- Module helpers ---------------------------------------------------------

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Map an OpenAI image size (e.g. "1024x1024") to a provider-specific aspect
 * ratio string. Used by Fal.ai, Stability AI, and Runway.
 */
function sizeToAspectRatio(size: string | undefined | null): string {
  if (!size || typeof size !== "string") return "1:1";
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
    "768x1344": "9:16",
    "1344x768": "16:9",
    "832x1216": "2:3",
    "1216x832": "3:2",
  };
  return map[size] || "1:1";
}
