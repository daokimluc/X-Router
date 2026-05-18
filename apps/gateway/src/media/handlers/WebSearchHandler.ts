/**
 * Web Search Handler
 *
 * Supports a wide set of dedicated search providers, dispatched on
 * `config.format`:
 *
 *   tavily       — POST {baseUrl}                 { query, max_results, … }
 *   brave        — GET  {baseUrl}/web/search      ?q=&count=…
 *   serper       — POST {baseUrl}/search          { q, num, gl, hl }
 *   exa          — POST {baseUrl}                 { query, numResults, … }
 *   perplexity   — POST {baseUrl}                 { query, max_results, … }
 *   searxng      — GET  {baseUrl}                 ?q=&format=json&…
 *   google-pse   — GET  {baseUrl}                 ?key=&cx=&q=&…
 *   linkup       — POST {baseUrl}                 { q, depth, maxResults }
 *   searchapi    — GET  {baseUrl}                 ?q=&engine=google&…
 *   youcom       — GET  {baseUrl}                 ?query=&num_web_results=…
 *   chat         — POST {baseUrl}/chat/completions { tools:[web_search] }
 *
 * Returns a normalized envelope with `results: [{ title, url, snippet }]`,
 * `query`, `provider`, `usage`, and `metrics`.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */

import type { MediaKindHandler, MediaRequestBuild } from "../MediaKindHandler.js";
import type {
  MediaServiceConfig,
  WebSearchRequest,
  WebSearchResponse,
} from "../types.js";

export class WebSearchHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown
  ): MediaRequestBuild {
    const req = payload as WebSearchRequest;
    const format = config.format || "perplexity";

    switch (format) {
      case "tavily":
        return this.buildTavilyRequest(config, req, credentials);
      case "brave":
        return this.buildBraveRequest(config, req, credentials);
      case "serper":
        return this.buildSerperRequest(config, req, credentials);
      case "exa":
        return this.buildExaRequest(config, req, credentials);
      case "perplexity":
        return this.buildPerplexityRequest(config, req, credentials);
      case "searxng":
        return this.buildSearXNGRequest(config, req, credentials);
      case "google-pse":
        return this.buildGooglePseRequest(config, req, credentials);
      case "linkup":
        return this.buildLinkupRequest(config, req, credentials);
      case "searchapi":
        return this.buildSearchApiRequest(config, req, credentials);
      case "youcom":
        return this.buildYouComRequest(config, req, credentials);
      case "chat":
        return this.buildChatSearchRequest(config, model, req, credentials);
      default:
        throw new Error(`Unsupported web search format: '${format}'`);
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

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(responseBody.toString("utf-8")) as Record<string, unknown>;
    } catch {
      return this.emptyResponse("unknown");
    }

    // Already in our normalized format.
    if (Array.isArray(raw.results) && typeof raw.provider === "string") {
      return raw as WebSearchResponse;
    }

    // Tavily — { query, results: [{title, url, content, score}] }
    if (Array.isArray(raw.results) && typeof raw.query === "string") {
      return this.normalizeTavilyLike(raw, "tavily");
    }

    // Perplexity — search endpoint returns { results: [{ title, url, snippet }] }.
    if (Array.isArray((raw as { results?: unknown }).results)) {
      return this.normalizeTavilyLike(raw, "perplexity");
    }

    // Chat-completions style (perplexity LLM, openai, etc.)
    if (Array.isArray((raw as { choices?: unknown }).choices)) {
      return this.normalizeChatResponse(raw);
    }

    // Brave — { web: { results: [...] } }
    if ((raw.web as Record<string, unknown> | undefined)?.results) {
      return this.normalizeBraveResponse(raw);
    }

    // Serper — { organic: [...] } / { news: [...] }
    if (Array.isArray(raw.organic) || Array.isArray(raw.news)) {
      return this.normalizeSerperResponse(raw);
    }

    // Exa — { results: [{ title, url, text }] } (already partially handled above)

    // Google PSE — { items: [...] }
    if (Array.isArray(raw.items)) {
      return this.normalizeGooglePseResponse(raw);
    }

    // SearchAPI — { organic_results: [...] } or { top_stories: [...] }
    if (Array.isArray(raw.organic_results) || Array.isArray(raw.top_stories)) {
      return this.normalizeSearchApiResponse(raw);
    }

    // You.com — { results: { web: [...], news: [...] } }
    const youResults = raw.results as Record<string, unknown> | undefined;
    if (Array.isArray(youResults?.web) || Array.isArray(youResults?.news)) {
      return this.normalizeYouComResponse(raw);
    }

    return this.emptyResponse("unknown");
  }

  // ── builders ─────────────────────────────────────────────────────────

  private buildTavilyRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const { includes, excludes } = parseDomainFilter(req.domain_filter);
    const body: Record<string, unknown> = {
      query: req.query,
      max_results: req.max_results ?? 5,
      topic: req.search_type === "news" ? "news" : "general",
    };
    if (includes.length) body.include_domains = includes;
    if (excludes.length) body.exclude_domains = excludes;
    if (req.country) body.country = req.country;
    if (req.search_type === "detailed") body.search_depth = "advanced";
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildBraveRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Brave catalog baseUrl is the v1 root; append /web/search or /news/search.
    const endpoint = req.search_type === "news" ? "/news/search" : "/web/search";
    const params = new URLSearchParams({
      q: req.query,
      count: String(req.max_results ?? 5),
    });
    if (req.country) params.set("country", req.country);
    if (req.language) params.set("search_lang", req.language);
    return {
      url: `${config.baseUrl.replace(/\/$/, "")}${endpoint}?${params.toString()}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: null,
    };
  }

  private buildSerperRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const endpoint = req.search_type === "news" ? "/news" : "/search";
    const body: Record<string, unknown> = { q: req.query, num: req.max_results ?? 10 };
    if (req.country) body.gl = req.country.toLowerCase();
    if (req.language) body.hl = req.language;
    return {
      url: `${config.baseUrl.replace(/\/$/, "")}${endpoint}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: JSON.stringify(body),
    };
  }

  private buildExaRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const { includes, excludes } = parseDomainFilter(req.domain_filter);
    const body: Record<string, unknown> = {
      query: req.query,
      numResults: req.max_results ?? 5,
      type: "auto",
      text: true,
      highlights: true,
    };
    if (includes.length) body.includeDomains = includes;
    if (excludes.length) body.excludeDomains = excludes;
    if (req.search_type === "news") body.category = "news";
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: JSON.stringify(body),
    };
  }

  private buildPerplexityRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const body: Record<string, unknown> = {
      query: req.query,
      max_results: req.max_results ?? 5,
    };
    if (req.country) body.country = req.country;
    if (req.language) body.search_language_filter = [req.language];
    if (req.domain_filter?.length) body.search_domain_filter = req.domain_filter;
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: JSON.stringify(body),
    };
  }

  private buildSearXNGRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const params = new URLSearchParams({
      q: req.query,
      format: "json",
      categories: req.search_type === "news" ? "news" : "general",
    });
    if (req.language) params.set("language", req.language);
    if (req.time_range && req.time_range !== "any") {
      params.set("time_range", req.time_range);
    }
    return {
      url: `${config.baseUrl}?${params.toString()}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: null,
    };
  }

  private buildGooglePseRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Google PSE needs both `key` (apiKey) and `cx` (search engine id).
    // The cx must be supplied via credentials.cx or providerSpecificData.
    const creds = credentials as Record<string, string> | null;
    const apiKey = creds?.apiKey || creds?.token || "";
    const cx = creds?.cx || "";
    if (!apiKey || !cx) {
      throw new Error(
        "Google Programmable Search requires both apiKey and `cx` (custom search engine id) credentials."
      );
    }
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: req.query,
      num: String(Math.min(req.max_results ?? 5, 10)),
    });
    if (req.country) params.set("gl", req.country.toLowerCase());
    if (req.language) params.set("hl", req.language);
    if (req.time_range && req.time_range !== "any") {
      const map: Record<string, string> = {
        day: "d1",
        week: "w1",
        month: "m1",
        year: "y1",
      };
      const dr = map[req.time_range];
      if (dr) params.set("dateRestrict", dr);
    }
    return {
      url: `${config.baseUrl}?${params.toString()}`,
      method: "GET",
      headers: { Accept: "application/json" },
      body: null,
    };
  }

  private buildLinkupRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const { includes, excludes } = parseDomainFilter(req.domain_filter);
    const body: Record<string, unknown> = {
      q: req.query,
      depth: req.search_type === "detailed" ? "deep" : "standard",
      outputType: "searchResults",
      maxResults: req.max_results ?? 5,
    };
    if (includes.length) body.includeDomains = includes;
    if (excludes.length) body.excludeDomains = excludes;
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: JSON.stringify(body),
    };
  }

  private buildSearchApiRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const creds = credentials as Record<string, string> | null;
    const apiKey = creds?.apiKey || creds?.token || "";
    const params = new URLSearchParams({
      engine: req.search_type === "news" ? "google_news" : "google",
      q: req.query,
      api_key: apiKey,
    });
    if (req.country) params.set("gl", req.country.toLowerCase());
    if (req.language) params.set("hl", req.language);
    return {
      url: `${config.baseUrl}?${params.toString()}`,
      method: "GET",
      headers: { Accept: "application/json" },
      body: null,
    };
  }

  private buildYouComRequest(
    config: MediaServiceConfig,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const params = new URLSearchParams({
      query: req.query,
      count: String(Math.min(req.max_results ?? 5, 100)),
    });
    if (req.time_range && req.time_range !== "any") {
      params.set("freshness", req.time_range);
    }
    if (req.country) params.set("country", req.country);
    if (req.language) params.set("language", req.language);
    return {
      url: `${config.baseUrl}?${params.toString()}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...this.buildAuthHeaders(config, credentials),
      },
      body: null,
    };
  }

  private buildChatSearchRequest(
    config: MediaServiceConfig,
    model: string,
    req: WebSearchRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Search-via-chat — sends to a chat completions endpoint with a
    // built-in web_search tool. This is a generic shape; callers that
    // need provider-specific chat-search bodies should use the dedicated
    // chatSearch flow on the gateway side.
    const url = config.baseUrl.endsWith("/chat/completions")
      ? config.baseUrl
      : `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      model: model || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a search assistant. Provide factual answers and cite your sources.",
        },
        { role: "user", content: req.query },
      ],
      tools: [{ type: "web_search" }],
    };
    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  // ── normalizers ──────────────────────────────────────────────────────

  private normalizeTavilyLike(
    raw: Record<string, unknown>,
    provider: string
  ): WebSearchResponse {
    const rawResults = (raw.results as Array<Record<string, unknown>>) ?? [];
    const results = rawResults.map((r) => ({
      title: (r.title as string) || "",
      url: (r.url as string) || "",
      snippet:
        (r.snippet as string) ||
        (r.content as string) ||
        (r.description as string) ||
        "",
    }));
    return {
      results,
      query: (raw.query as string) || "",
      provider,
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeBraveResponse(raw: Record<string, unknown>): WebSearchResponse {
    const web = raw.web as Record<string, unknown> | undefined;
    const news = raw.news as Record<string, unknown> | undefined;
    const items =
      (web?.results as Array<Record<string, unknown>>) ||
      (news?.results as Array<Record<string, unknown>>) ||
      [];
    const results = items.map((r) => ({
      title: (r.title as string) || "",
      url: (r.url as string) || "",
      snippet: (r.description as string) || "",
    }));
    return {
      results,
      query: "",
      provider: "brave-search",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeSerperResponse(raw: Record<string, unknown>): WebSearchResponse {
    const items =
      (raw.organic as Array<Record<string, unknown>>) ||
      (raw.news as Array<Record<string, unknown>>) ||
      [];
    const results = items.map((r) => ({
      title: (r.title as string) || "",
      url: (r.link as string) || (r.url as string) || "",
      snippet: ((r.snippet as string) || (r.description as string) || "") as string,
    }));
    return {
      results,
      query:
        ((raw.searchParameters as Record<string, unknown> | undefined)?.q as string) ||
        "",
      provider: "serper",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeGooglePseResponse(raw: Record<string, unknown>): WebSearchResponse {
    const items = (raw.items as Array<Record<string, unknown>>) ?? [];
    const results = items.map((r) => ({
      title: (r.title as string) || "",
      url: (r.link as string) || "",
      snippet: (r.snippet as string) || "",
    }));
    return {
      results,
      query: "",
      provider: "google-pse",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeSearchApiResponse(raw: Record<string, unknown>): WebSearchResponse {
    const items =
      (raw.organic_results as Array<Record<string, unknown>>) ||
      (raw.top_stories as Array<Record<string, unknown>>) ||
      [];
    const results = items.map((r) => ({
      title: (r.title as string) || "",
      url: (r.link as string) || "",
      snippet: ((r.snippet as string) || (r.description as string) || "") as string,
    }));
    return {
      results,
      query: "",
      provider: "searchapi",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeYouComResponse(raw: Record<string, unknown>): WebSearchResponse {
    const container = raw.results as Record<string, unknown> | undefined;
    const items =
      (container?.web as Array<Record<string, unknown>>) ||
      (container?.news as Array<Record<string, unknown>>) ||
      [];
    const results = items.map((r) => {
      const snippets = r.snippets as string[] | undefined;
      return {
        title: (r.title as string) || "",
        url: (r.url as string) || "",
        snippet:
          (snippets?.[0] as string) ||
          (r.description as string) ||
          "",
      };
    });
    return {
      results,
      query: "",
      provider: "youcom",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private normalizeChatResponse(raw: Record<string, unknown>): WebSearchResponse {
    const choices = raw.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) || "";
    const citations = (raw.citations as string[]) || [];

    const results = citations.map((url, i) => ({
      title: `Source ${i + 1}`,
      url,
      snippet: "",
    }));

    if (results.length === 0 && content) {
      results.push({
        title: "Search Result",
        url: "",
        snippet: content.slice(0, 500),
      });
    }

    return {
      results,
      query: "",
      provider: "chat",
      usage: { queries_used: 1 },
      metrics: { response_time_ms: 0 },
    };
  }

  private emptyResponse(provider: string): WebSearchResponse {
    return {
      results: [],
      query: "",
      provider,
      usage: { queries_used: 1 },
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
        if (h === "x-subscription-token") return { "x-subscription-token": token };
        if (h === "api_key") {
          // SearchAPI's api_key goes in the query string; surface it via
          // a dedicated header so the caller can read it back if needed.
          return {};
        }
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

function parseDomainFilter(filter: string[] | undefined): {
  includes: string[];
  excludes: string[];
} {
  if (!filter?.length) return { includes: [], excludes: [] };
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const d of filter) {
    if (d.startsWith("-")) excludes.push(d.slice(1));
    else includes.push(d);
  }
  return { includes, excludes };
}
