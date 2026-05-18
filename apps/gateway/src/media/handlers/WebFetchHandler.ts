/**
 * Web Fetch Handler
 *
 * Supports four providers, dispatched on `config.format`:
 *
 *   firecrawl — POST {baseUrl} { url, formats: [...] }
 *   jina      — GET  {baseUrl}/{encodedUrl}    (target URL goes in path)
 *   tavily    — POST {baseUrl} { urls: [url], extract_depth }
 *   exa       — POST {baseUrl} { ids: [url], text: true }
 *
 * Returns a normalized envelope:
 *   { provider, url, title, content: { format, text, length }, usage, metrics }
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */

import type { MediaKindHandler, MediaRequestBuild } from "../MediaKindHandler.js";
import type {
  MediaServiceConfig,
  WebFetchRequest,
  WebFetchResponse,
} from "../types.js";

export class WebFetchHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    _model: string,
    payload: unknown,
    credentials: unknown
  ): MediaRequestBuild {
    const req = payload as WebFetchRequest;
    if (!req.url) {
      throw new Error("WebFetchHandler: 'url' is required");
    }
    const format = config.format || "firecrawl";

    switch (format) {
      case "jina":
        return this.buildJinaRequest(config, req, credentials);
      case "tavily":
        return this.buildTavilyExtractRequest(config, req, credentials);
      case "exa":
        return this.buildExaRequest(config, req, credentials);
      case "firecrawl":
      default:
        return this.buildFirecrawlRequest(config, req, credentials);
    }
  }

  normalizeResponse(responseBody: Buffer, statusCode: number): unknown {
    if (statusCode >= 400) {
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

    // Jina Reader returns plain markdown/text rather than JSON when used
    // without `Accept: application/json`. Detect that first.
    const ct = responseBody[0];
    if (ct !== 0x7b /* '{' */ && ct !== 0x5b /* '[' */) {
      const text = responseBody.toString("utf-8");
      return {
        provider: "jina",
        url: "",
        title: parseJinaTitle(text),
        content: {
          format: "markdown",
          text,
          length: text.length,
        },
        usage: {},
        metrics: { response_time_ms: 0 },
      } as WebFetchResponse;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(responseBody.toString("utf-8")) as Record<string, unknown>;
    } catch {
      return this.fallback(responseBody.toString("utf-8"));
    }

    // Already normalized.
    if (
      typeof raw.provider === "string" &&
      (raw.content as Record<string, unknown> | undefined)?.text != null
    ) {
      return raw as WebFetchResponse;
    }

    // Firecrawl — { success, data: { markdown|html|content, metadata } }
    const fcData = raw.data as Record<string, unknown> | undefined;
    if (fcData && (fcData.markdown || fcData.html || fcData.content || fcData.rawHtml)) {
      return this.normalizeFirecrawlResponse(raw);
    }

    // Tavily Extract — { results: [{ url, raw_content, content }] }
    const tavilyResults = raw.results as Array<Record<string, unknown>> | undefined;
    if (tavilyResults && (tavilyResults[0]?.raw_content || tavilyResults[0]?.content)) {
      return this.normalizeTavilyResponse(raw);
    }

    // Exa — { results: [{ url, text, title }] }
    if (tavilyResults && tavilyResults[0]?.text) {
      return this.normalizeExaResponse(raw);
    }

    return this.fallback(JSON.stringify(raw));
  }

  // ── builders ─────────────────────────────────────────────────────────

  private buildFirecrawlRequest(
    config: MediaServiceConfig,
    req: WebFetchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = { url: req.url };
    // Firecrawl expects formats as an array; "text" maps to rawHtml in 9router.
    const fmt = req.format || "markdown";
    body.formats = [fmt === "text" ? "rawHtml" : fmt];
    if (req.maxCharacters) body.maxCharacters = req.maxCharacters;
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildJinaRequest(
    config: MediaServiceConfig,
    req: WebFetchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Jina Reader puts the target URL in the path: https://r.jina.ai/{url}
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${encodeURIComponent(req.url)}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    if (req.format === "text") headers["X-Return-Format"] = "text";
    else if (req.format === "html") headers["X-Return-Format"] = "html";
    else headers["X-Return-Format"] = "markdown";
    if (req.maxCharacters) headers["X-Max-Characters"] = String(req.maxCharacters);
    return { url, method: "GET", headers, body: null };
  }

  private buildTavilyExtractRequest(
    config: MediaServiceConfig,
    req: WebFetchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      urls: [req.url],
      extract_depth: "basic",
    };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildExaRequest(
    config: MediaServiceConfig,
    req: WebFetchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      ids: [req.url],
      text: true,
    };
    if (req.maxCharacters) body.maxCharacters = req.maxCharacters;
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  // ── normalizers ──────────────────────────────────────────────────────

  private normalizeFirecrawlResponse(raw: Record<string, unknown>): WebFetchResponse {
    const data = (raw.data as Record<string, unknown>) ?? {};
    const text =
      (data.markdown as string) ||
      (data.content as string) ||
      (data.rawHtml as string) ||
      (data.html as string) ||
      "";
    const fmt = data.markdown ? "markdown" : data.html ? "html" : "text";
    const metadata = data.metadata as Record<string, unknown> | undefined;
    const title = (metadata?.title as string) || undefined;
    return {
      provider: "firecrawl",
      url: (data.url as string) || (metadata?.sourceURL as string) || "",
      title,
      content: { format: fmt, text, length: text.length },
      metadata,
      usage: {},
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeTavilyResponse(raw: Record<string, unknown>): WebFetchResponse {
    const results = (raw.results as Array<Record<string, unknown>>) ?? [];
    const first = results[0] || {};
    const text =
      (first.raw_content as string) ||
      (first.content as string) ||
      "";
    return {
      provider: "tavily",
      url: (first.url as string) || "",
      title: (first.title as string) || undefined,
      content: { format: "text", text, length: text.length },
      usage: {},
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeExaResponse(raw: Record<string, unknown>): WebFetchResponse {
    const results = (raw.results as Array<Record<string, unknown>>) ?? [];
    const first = results[0] || {};
    const text = (first.text as string) || "";
    return {
      provider: "exa",
      url: (first.url as string) || "",
      title: (first.title as string) || undefined,
      content: { format: "text", text, length: text.length },
      usage: {},
      metrics: { response_time_ms: 0 },
    };
  }

  private fallback(text: string): WebFetchResponse {
    return {
      provider: "unknown",
      url: "",
      content: { format: "text", text, length: text.length },
      usage: {},
      metrics: { response_time_ms: 0 },
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
      case "apikey": {
        const h = (config.authHeader || "x-api-key").toLowerCase();
        if (h === "bearer") return { Authorization: `Bearer ${token}` };
        if (h === "token") return { Authorization: `Token ${token}` };
        if (h === "key") return { Authorization: `Key ${token}` };
        if (h === "x-api-key") return { "x-api-key": token };
        return { [h]: token };
      }
      case "custom":
        return { [config.authHeader || "Authorization"]: token };
      case "none":
      default:
        return {};
    }
  }
}

function parseJinaTitle(markdown: string): string | undefined {
  const m = markdown.match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : undefined;
}
