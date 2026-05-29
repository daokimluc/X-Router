/**
 * ProviderExampleCard — interactive playground that lets users craft a sample
 * request for the gateway's media endpoints. Shows a model dropdown populated
 * from the provider instance's mediaConfig (or model mappings filtered by
 * providerType), an endpoint/API key/input form, an auto-generated curl
 * command, and a response box that updates after running the request.
 *
 * The kind-specific extra fields mirror 9router's KIND_EXAMPLE_CONFIG so
 * each kind exposes the same set of controls users are familiar with
 * (size/quality/background/image_detail/codec for images, search_type/
 * max_results for webSearch, etc).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Play } from "lucide-react";
import { copyText } from "../clipboard";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type MediaModelConfig = {
  id: string;
  displayName?: string;
  name?: string;
};

type MediaProvider = {
  id: string;
  type: string;
  name: string;
  mediaConfig?: Partial<
    Record<ServiceKind, { models?: MediaModelConfig[] } | undefined>
  >;
};

type ModelMapping = {
  id: string;
  publicModel: string;
  providerType: string;
  upstreamModel: string;
  enabled?: boolean;
};

type ApiKey = {
  id: string;
  keyHash: string;
  enabled: boolean;
  owner?: string;
};

type ModelOption = {
  id: string;
  label: string;
};

type Props = {
  api: ApiClient;
  provider: CatalogProvider;
  kind: ServiceKind;
  kindLabel: string;
};

// Kind-specific extra field descriptors. Mirrors 9router's
// KIND_EXAMPLE_CONFIG.extraFields shape so the form layouts match.
type ExtraField =
  | { key: string; label: string; type: "text"; default: string; placeholder?: string }
  | { key: string; label: string; type: "number"; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "select"; default: string; options: string[] };

type KindExampleConfig = {
  inputLabel: string;
  inputPlaceholder: string;
  defaultInput: string;
  /** Body field name for the user's primary input (e.g. "prompt", "input"). */
  bodyKey: string;
  /** Default response body shown before the user has run the request. */
  defaultResponse: string;
  /** Per-kind extra fields rendered as separate form rows. */
  extraFields?: ExtraField[];
  /** Whether this kind expects a model id in the body. */
  needsModel?: boolean;
  /** Extra body fields injected verbatim (only when their value is truthy). */
  extraBody?: Record<string, unknown>;
  /** Whether the request needs a "Ref Image (URL)" field (image-to-image). */
  supportsRefImage?: boolean;
};

const KIND_CONFIG: Record<ServiceKind, KindExampleConfig> = {
  llm: {
    inputLabel: "Input",
    inputPlaceholder: "Hello!",
    defaultInput: "Hello!",
    bodyKey: "messages",
    needsModel: true,
    defaultResponse: "{}",
  },
  embedding: {
    inputLabel: "Input",
    inputPlaceholder: "The quick brown fox jumps over the lazy dog",
    defaultInput: "The quick brown fox jumps over the lazy dog",
    bodyKey: "input",
    needsModel: true,
    defaultResponse: `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.002301, -0.019212, 0.004815, -0.031249, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`,
    extraFields: [
      { key: "dimensions", label: "Dimensions", type: "number", default: 0, min: 0 },
    ],
  },
  image: {
    inputLabel: "Prompt",
    inputPlaceholder: "A cute cat wearing a hat",
    defaultInput: "A cute cat wearing a hat",
    bodyKey: "prompt",
    needsModel: true,
    supportsRefImage: true,
    defaultResponse: `{
  "data": [
    { "url": "...", "b64_json": "..." }
  ]
}`,
    extraFields: [
      { key: "n", label: "n", type: "number", default: 1, min: 1, max: 4 },
      {
        key: "size",
        label: "Size",
        type: "select",
        default: "auto",
        options: ["auto", "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"],
      },
      {
        key: "quality",
        label: "Quality",
        type: "select",
        default: "auto",
        options: ["auto", "low", "medium", "high", "standard", "hd"],
      },
      {
        key: "background",
        label: "Background",
        type: "select",
        default: "auto",
        options: ["auto", "transparent", "opaque"],
      },
      {
        key: "style",
        label: "Style",
        type: "select",
        default: "",
        options: ["", "vivid", "natural"],
      },
      {
        key: "response_format",
        label: "Format",
        type: "select",
        default: "",
        options: ["", "url", "b64_json"],
      },
      {
        key: "image_detail",
        label: "Image Detail",
        type: "select",
        default: "high",
        options: ["auto", "low", "high", "original"],
      },
      {
        key: "output_format",
        label: "Codec",
        type: "select",
        default: "png",
        options: ["png", "jpeg", "webp"],
      },
    ],
  },
  imageToText: {
    inputLabel: "Image URL",
    inputPlaceholder: "https://example.com/image.png",
    defaultInput:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg",
    bodyKey: "url",
    needsModel: true,
    extraBody: { prompt: "Describe this image in detail" },
    defaultResponse: `{
  "text": "A cat sitting on a windowsill...",
  "model": "..."
}`,
  },
  tts: {
    inputLabel: "Input",
    inputPlaceholder: "Hello, this is a test of text to speech.",
    defaultInput: "Hello, this is a test of text to speech.",
    bodyKey: "input",
    needsModel: true,
    extraBody: { voice: "alloy" },
    defaultResponse: "// Audio binary data — base64-encoded MP3",
  },
  stt: {
    inputLabel: "Audio file",
    inputPlaceholder: "",
    defaultInput: "",
    bodyKey: "input",
    needsModel: true,
    defaultResponse: `{
  "text": "Transcribed text..."
}`,
  },
  webSearch: {
    inputLabel: "Query",
    inputPlaceholder: "What is the latest news about AI?",
    defaultInput: "What is the latest news about AI?",
    bodyKey: "query",
    defaultResponse: `{
  "results": [
    { "title": "...", "url": "...", "snippet": "..." }
  ]
}`,
    extraFields: [
      {
        key: "search_type",
        label: "Type",
        type: "select",
        default: "web",
        options: ["web", "news"],
      },
      { key: "max_results", label: "Max results", type: "number", default: 5, min: 1, max: 100 },
      { key: "country", label: "Country", type: "text", default: "" },
      { key: "language", label: "Language", type: "text", default: "" },
    ],
  },
  webFetch: {
    inputLabel: "URL",
    inputPlaceholder: "https://example.com",
    defaultInput: "https://example.com",
    bodyKey: "url",
    defaultResponse: `{
  "content": "...",
  "title": "...",
  "url": "..."
}`,
    extraFields: [
      {
        key: "format",
        label: "Format",
        type: "select",
        default: "markdown",
        options: ["markdown", "text", "html"],
      },
      { key: "max_characters", label: "Max chars", type: "number", default: 0, min: 0 },
    ],
  },
};

const API_PATH_MAP: Record<ServiceKind, string> = {
  llm: "/v1/chat/completions",
  embedding: "/v1/embeddings",
  image: "/v1/images/generations",
  imageToText: "/v1/images/understanding",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
};

function buildExtraValuesDefault(kind: ServiceKind): Record<string, string | number> {
  const config = KIND_CONFIG[kind];
  const defaults: Record<string, string | number> = {};
  for (const f of config.extraFields ?? []) {
    defaults[f.key] = f.default;
  }
  return defaults;
}

function buildBody(
  kind: ServiceKind,
  modelFull: string,
  input: string,
  extras: Record<string, string | number>,
  refImage: string
): Record<string, unknown> {
  const config = KIND_CONFIG[kind];
  const body: Record<string, unknown> = {};
  if (config.needsModel && modelFull) body.model = modelFull;
  body[config.bodyKey] = input;

  // Inject extra body fields verbatim (e.g. webFetch's voice, imageToText's
  // prompt). Only apply when value is truthy.
  if (config.extraBody) {
    for (const [k, v] of Object.entries(config.extraBody)) {
      if (v !== undefined && v !== null && v !== "") body[k] = v;
    }
  }

  // Apply user-tweaked extra fields. Skip empty/zero values to keep the
  // request body minimal — matches 9router behavior.
  for (const f of config.extraFields ?? []) {
    const v = extras[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      body[f.key] = n;
    } else {
      const s = typeof v === "string" ? v.trim() : String(v);
      if (!s) continue;
      body[f.key] = s;
    }
  }

  // Optional ref image (only image kind supports it).
  if (config.supportsRefImage && refImage.trim()) {
    body.image = refImage.trim();
  }

  return body;
}

function formatBody(body: unknown): string {
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function buildCurl(
  endpoint: string,
  apiPath: string,
  apiKey: string,
  body: unknown,
  wantBinary: boolean
): string {
  const url = `${endpoint}${apiPath}`;
  const json = formatBody(body);
  const keyDisplay = apiKey || "sk-...";
  const lines = [
    `curl -X POST ${url} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Authorization: Bearer ${keyDisplay}" \\`,
  ];
  if (wantBinary) lines.push(`  -H "Accept: text/event-stream" \\`);
  lines.push(`  -d '${json}'${wantBinary ? " \\\n  --output image.png" : ""}`);
  return lines.join("\n");
}

export function ProviderExampleCard({ api, provider, kind, kindLabel }: Props) {
  const config = KIND_CONFIG[kind];

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );
  const [apiKey, setApiKey] = useState<string>("");
  const [input, setInput] = useState<string>(config.defaultInput);
  const [refImage, setRefImage] = useState<string>("");
  const [extras, setExtras] = useState<Record<string, string | number>>(() =>
    buildExtraValuesDefault(kind)
  );
  const [response, setResponse] = useState<string>(config.defaultResponse);
  const [running, setRunning] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Image-specific state
  const [imageOutputFormat, setImageOutputFormat] = useState<"json" | "binary">("json");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  // TTS-specific state
  const [ttsOutputFormat, setTtsOutputFormat] = useState<"mp3" | "json">("mp3");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Edge TTS: 2-step selection (language → voice)
  const [edgeLanguages, setEdgeLanguages] = useState<Array<{ code: string; name: string }>>([]);
  const [edgeSelectedLang, setEdgeSelectedLang] = useState("");
  const [edgeVoicesForLang, setEdgeVoicesForLang] = useState<ModelOption[]>([]);
  const [edgeAllVoices, setEdgeAllVoices] = useState<Array<{ ShortName: string; FriendlyName: string; Locale: string }>>([]);

  // Reset everything when the kind changes (defensive).
  useEffect(() => {
    setInput(config.defaultInput);
    setRefImage("");
    setExtras(buildExtraValuesDefault(kind));
    setResponse(config.defaultResponse);
    setLatencyMs(null);
    setRunError(null);
    setImageDataUrl(null);
    setAudioUrl(null);
  }, [kind, config.defaultInput, config.defaultResponse]);

  const fetchModels = useCallback(async () => {
    try {
      const [mediaProviders, mappings] = await Promise.all([
        api.getList<MediaProvider>("/admin/v1/media-providers").catch(() => []),
        api.getList<ModelMapping>("/admin/v1/model-mappings").catch(() => []),
      ]);

      const collected = new Map<string, ModelOption>();

      // Source 1: built-in catalog models for this kind.
      const catalogMap: Partial<Record<ServiceKind, Array<{ id: string; name: string }>>> = {
        embedding: provider.embeddingConfig?.models ?? [],
        image: provider.imageConfig?.models ?? [],
        tts: provider.ttsConfig?.models ?? [],
        stt: provider.sttConfig?.models ?? [],
      };
      const builtin = catalogMap[kind] ?? [];
      for (const m of builtin) {
        if (!m?.id) continue;
        collected.set(m.id, { id: m.id, label: m.name ?? m.id });
      }

      const matchingProvider = mediaProviders.find((p) => p.type === provider.id);
      const mediaModels = matchingProvider?.mediaConfig?.[kind]?.models ?? [];
      for (const m of mediaModels) {
        if (!m?.id || collected.has(m.id)) continue;
        const label = m.displayName ?? m.name ?? m.id;
        collected.set(m.id, { id: m.id, label });
      }

      for (const mapping of mappings) {
        if (mapping.providerType !== provider.id) continue;
        const id = mapping.upstreamModel || mapping.publicModel;
        if (!id || collected.has(id)) continue;
        const label = mapping.publicModel !== id ? mapping.publicModel : id;
        collected.set(id, { id, label });
      }

      const list = Array.from(collected.values());
      setModels(list);
      setSelectedModel((cur) => cur || list[0]?.id || "");
    } catch {
      // Non-fatal: leave dropdown empty.
    }
  }, [api, kind, provider]);

  const fetchApiKey = useCallback(async () => {
    try {
      const keys = await api.getList<ApiKey>("/admin/v1/api-keys");
      const enabled = keys.find((k) => k.enabled) ?? keys[0];
      if (!enabled) return;
      try {
        const result = await api.get<{ key: string }>(
          `/admin/v1/api-keys/${enabled.id}/reveal`
        );
        if (result?.key) {
          setApiKey(result.key);
          return;
        }
      } catch {
        // Fall through to keyHash fallback.
      }
      // Fallback: show the masked hash so the user knows a key exists.
      setApiKey(enabled.keyHash);
    } catch {
      // Non-fatal: user can paste their own key.
    }
  }, [api]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  // Edge TTS: fetch full voice list from Bing, group by language
  useEffect(() => {
    if (provider.id !== "edge-tts" || kind !== "tts") return;
    const EDGE_VOICES_URL =
      "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    fetch(EDGE_VOICES_URL)
      .then((r) => r.json())
      .then((voices: Array<{ ShortName: string; FriendlyName: string; Locale: string; LocaleName: string }>) => {
        if (!Array.isArray(voices) || voices.length === 0) return;
        setEdgeAllVoices(voices);
        // Build unique language list
        const langMap = new Map<string, string>();
        for (const v of voices) {
          if (!langMap.has(v.Locale)) {
            langMap.set(v.Locale, v.LocaleName || v.Locale);
          }
        }
        const langs = Array.from(langMap.entries())
          .map(([code, name]) => ({ code, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setEdgeLanguages(langs);
        // Default to vi-VN
        const defaultLang = langs.find((l) => l.code === "vi-VN") || langs.find((l) => l.code === "en-US") || langs[0];
        if (defaultLang) {
          setEdgeSelectedLang(defaultLang.code);
          const voicesForLang = voices
            .filter((v) => v.Locale === defaultLang.code)
            .map((v) => ({ id: v.ShortName, label: v.FriendlyName || v.ShortName }));
          setEdgeVoicesForLang(voicesForLang);
          setModels(voicesForLang);
          setSelectedModel(voicesForLang[0]?.id || "");
        }
      })
      .catch(() => {
        // Non-fatal: keep catalog defaults
      });
  }, [provider.id, kind]);

  useEffect(() => {
    void fetchApiKey();
  }, [fetchApiKey]);

  const apiPath = API_PATH_MAP[kind] ?? "/v1";
  const modelFull = selectedModel ? `${provider.alias}/${selectedModel}` : "";

  const body = useMemo(
    () => buildBody(kind, modelFull, input, extras, refImage),
    [kind, modelFull, input, extras, refImage]
  );

  // Codex image streams over SSE for Plus/Pro accounts.
  const wantBinary = kind === "image" && imageOutputFormat === "binary";
  const useStreaming = kind === "image" && provider.id === "codex" && !wantBinary;

  const curl = useMemo(
    () => buildCurl(endpoint || "http://localhost:3000", apiPath, apiKey, body, useStreaming || wantBinary),
    [endpoint, apiPath, apiKey, body, useStreaming, wantBinary]
  );

  async function handleCopy() {
    try {
      await copyText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  async function handleRun() {
    if (!endpoint) return;
    setRunning(true);
    setRunError(null);
    setLatencyMs(null);
    setImageDataUrl(null);
    setAudioUrl(null);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      if (useStreaming) headers.accept = "text/event-stream";
      const res = await fetch(`${endpoint}${apiPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const elapsed = performance.now() - started;
      setLatencyMs(Math.round(elapsed));

      const ctype = res.headers.get("content-type") || "";

      // Binary image response
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setImageDataUrl(objUrl);
        setResponse(`// Binary image (${ctype}, ${(blob.size / 1024).toFixed(1)} KB)`);
        if (!res.ok) setRunError(`HTTP ${res.status}`);
        return;
      }

      // Binary audio response (TTS)
      if (ctype.startsWith("audio/") || (kind === "tts" && res.ok && !ctype.includes("json"))) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setAudioUrl(objUrl);
        setResponse(`// Audio (${ctype || "audio/mpeg"}, ${(blob.size / 1024).toFixed(1)} KB)`);
        if (!res.ok) setRunError(`HTTP ${res.status}`);
        return;
      }

      // SSE streaming (Codex image)
      if (ctype.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData: unknown = null;
        let streamErr: string | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let evt = "";
            let dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!evt) continue;
            try {
              const payload = dataStr ? JSON.parse(dataStr) : {};
              if (evt === "done") finalData = payload;
              else if (evt === "error") streamErr = payload?.message || "Stream error";
            } catch {
              // skip
            }
          }
        }
        const sseElapsed = performance.now() - started;
        setLatencyMs(Math.round(sseElapsed));
        if (streamErr) {
          setRunError(streamErr);
          setResponse(`// Error: ${streamErr}`);
          return;
        }
        if (finalData) {
          // Extract b64_json for image preview
          const fd = finalData as Record<string, unknown>;
          const dataArr = fd.data as Array<Record<string, unknown>> | undefined;
          const b64 = dataArr?.[0]?.b64_json;
          if (typeof b64 === "string" && b64.length > 0) {
            setImageDataUrl(`data:image/png;base64,${b64}`);
            // Show truncated JSON in response box
            const masked = { ...fd, data: dataArr?.map((d) => ({
              ...d,
              b64_json: typeof d.b64_json === "string" ? `<${d.b64_json.length} chars base64>` : d.b64_json,
            })) };
            setResponse(JSON.stringify(masked, null, 2));
          } else {
            setResponse(JSON.stringify(finalData, null, 2));
          }
          if (!res.ok) setRunError(`HTTP ${res.status}`);
          return;
        }
        setResponse("// No data received from stream");
        return;
      }

      // Standard JSON response
      const text = await res.text();
      let pretty = text;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {
        // Leave as-is when not JSON.
      }
      if (!res.ok) {
        setRunError(`HTTP ${res.status}`);
      }

      // Extract image from JSON response for preview
      if (kind === "image" && parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const dataArr = obj.data as Array<Record<string, unknown>> | undefined;
        const first = dataArr?.[0];
        if (first) {
          if (typeof first.b64_json === "string" && first.b64_json.length > 0) {
            setImageDataUrl(`data:image/png;base64,${first.b64_json}`);
            // Mask b64 in display
            const masked = { ...obj, data: dataArr?.map((d) => ({
              ...d,
              b64_json: typeof d.b64_json === "string" ? `<${d.b64_json.length} chars base64>` : d.b64_json,
            })) };
            pretty = JSON.stringify(masked, null, 2);
          } else if (typeof first.url === "string") {
            setImageDataUrl(first.url);
          }
        }
      }

      setResponse(pretty || `// HTTP ${res.status} — empty response`);
    } catch (err) {
      const elapsed = performance.now() - started;
      setLatencyMs(Math.round(elapsed));
      setRunError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
    }
  }

  function updateExtra(key: string, value: string | number) {
    setExtras((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <article className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>Example</h3>

      {/* Client-side only providers (no gateway routing) */}
      {provider.noAuth && provider.id === "local-device" ? (
        <div style={{
          padding: 16,
          borderRadius: 8,
          background: "var(--color-surface-2, #f3f4f6)",
          border: "1px solid var(--color-border, #e5e7eb)",
          textAlign: "center",
        }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted, #6b7280)" }}>
            <strong>{provider.name}</strong> runs locally in the browser — no API key or gateway routing needed.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-muted, #6b7280)" }}>
            This provider is available automatically when enabled. No configuration required.
          </p>
        </div>
      ) : (<>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {config.needsModel && provider.id === "edge-tts" && kind === "tts" ? (
          <>
            <FormRow label="Language">
              <SearchableSelect
                value={edgeSelectedLang}
                onChange={(lang) => {
                  setEdgeSelectedLang(lang);
                  const voicesForLang = edgeAllVoices
                    .filter((v) => v.Locale === lang)
                    .map((v) => ({ id: v.ShortName, label: v.FriendlyName || v.ShortName }));
                  setEdgeVoicesForLang(voicesForLang);
                  setModels(voicesForLang);
                  setSelectedModel(voicesForLang[0]?.id || "");
                }}
                options={edgeLanguages.map((l) => ({ id: l.code, label: l.name }))}
                placeholder="Search language..."
              />
            </FormRow>
            <FormRow label="Voice">
              <SearchableSelect
                value={selectedModel}
                onChange={setSelectedModel}
                options={edgeVoicesForLang}
                placeholder={edgeVoicesForLang.length === 0 ? "Select language first" : "Search voice..."}
              />
            </FormRow>
          </>
        ) : config.needsModel ? (
          <FormRow label={kind === "tts" && provider.noAuth ? "Language" : "Model"}>
            <SearchableSelect
              value={selectedModel}
              onChange={setSelectedModel}
              options={models}
              placeholder={models.length === 0 ? "No models configured" : "Search..."}
            />
          </FormRow>
        ) : null}

        <FormRow label="Endpoint">
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:3000"
            style={inputStyle}
          />
        </FormRow>

        {!provider.noAuth && (
        <FormRow label="API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={inputStyle}
            autoComplete="off"
          />
        </FormRow>
        )}

        <FormRow label={config.inputLabel}>
          <div style={{ position: "relative", width: "100%" }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={config.inputPlaceholder}
              style={{ ...inputStyle, paddingRight: 28 }}
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                title="Clear"
                style={clearButtonStyle}
                aria-label="Clear input"
              >
                ×
              </button>
            )}
          </div>
        </FormRow>

        {config.supportsRefImage && (
          <FormRow label="Ref Image (URL)">
            <input
              type="text"
              value={refImage}
              onChange={(e) => setRefImage(e.target.value)}
              placeholder="https://example.com/source.png"
              style={inputStyle}
            />
          </FormRow>
        )}

        {(config.extraFields ?? []).map((f) => (
          <FormRow key={f.key} label={f.label}>
            {f.type === "select" ? (
              <select
                value={String(extras[f.key] ?? f.default)}
                onChange={(e) => updateExtra(f.key, e.target.value)}
                style={inputStyle}
              >
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "" ? "(default)" : opt}
                  </option>
                ))}
              </select>
            ) : f.type === "number" ? (
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={String(extras[f.key] ?? f.default)}
                onChange={(e) => updateExtra(f.key, Number(e.target.value) || 0)}
                style={inputStyle}
              />
            ) : (
              <input
                type="text"
                value={String(extras[f.key] ?? f.default)}
                onChange={(e) => updateExtra(f.key, e.target.value)}
                placeholder={f.placeholder}
                style={inputStyle}
              />
            )}
          </FormRow>
        ))}

        {kind === "image" && (
          <FormRow label="Output Format">
            <select
              value={imageOutputFormat}
              onChange={(e) => setImageOutputFormat(e.target.value as "json" | "binary")}
              style={inputStyle}
            >
              <option value="json">JSON (Base64)</option>
              <option value="binary">Binary File</option>
            </select>
          </FormRow>
        )}

        {kind === "tts" && (
          <FormRow label="Output Format">
            <select
              value={ttsOutputFormat}
              onChange={(e) => setTtsOutputFormat(e.target.value as "mp3" | "json")}
              style={inputStyle}
            >
              <option value="mp3">MP3 (Binary)</option>
              <option value="json">JSON (Base64)</option>
            </select>
          </FormRow>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionHeader title="REQUEST">
          <button
            type="button"
            className="iconButton"
            onClick={() => void handleCopy()}
            title={copied ? "Copied" : "Copy curl"}
            style={{ padding: 6 }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => void handleRun()}
            disabled={running}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title={`Send POST to ${endpoint}${apiPath}`}
          >
            <Play size={14} />
            {running ? "Running..." : "Run"}
          </button>
        </SectionHeader>
        <CodeBlock>{curl}</CodeBlock>
      </div>

      <div style={{ marginTop: 14 }}>
        <SectionHeader title="RESPONSE">
          {latencyMs != null && (
            <span
              style={{
                fontSize: 11,
                color: runError ? "var(--color-danger, #ef4444)" : "var(--color-text-muted, #6b7280)",
              }}
            >
              {runError ? `${runError} · ` : ""}
              {latencyMs} ms
            </span>
          )}
        </SectionHeader>
        <CodeBlock>{response}</CodeBlock>

        {kind === "image" && imageDataUrl && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <a
                href={imageDataUrl}
                download="image.png"
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted, #6b7280)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                ⬇ Download
              </a>
            </div>
            <img
              src={imageDataUrl}
              alt="Generated"
              style={{
                maxWidth: "100%",
                borderRadius: 8,
                border: "1px solid var(--color-border, #e5e7eb)",
              }}
            />
          </div>
        )}

        {kind === "tts" && audioUrl && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <a
                href={audioUrl}
                download="speech.mp3"
                style={{
                  fontSize: 11,
                  color: "var(--color-text-muted, #6b7280)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                ⬇ Download
              </a>
            </div>
            <audio
              controls
              src={audioUrl}
              style={{ width: "100%", borderRadius: 8 }}
            />
          </div>
        )}
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--color-text-muted, #6b7280)" }}>
        Sends to <code>{endpoint || "http://localhost:3000"}{apiPath}</code> using <strong>{kindLabel}</strong> via {provider.name}.
      </p>
      </>)}
    </article>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 12,
          color: "var(--color-text-muted, #6b7280)",
          minWidth: 90,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 200 }}>{children}</div>
    </div>
  );
}

function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "var(--color-text-muted, #6b7280)",
          textTransform: "uppercase",
        }}
      >
        {title}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        borderRadius: 8,
        background: "var(--color-surface-2, #f3f4f6)",
        color: "var(--color-text-main)",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        overflowX: "auto",
        border: "1px solid var(--color-border-subtle, rgba(0,0,0,0.06))",
      }}
    >
      {children}
    </pre>
  );
}

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ModelOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedLabel = options.find((o) => o.id === value)?.label ?? value;

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.id.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          ...inputStyle,
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || placeholder || "Select..."}
        </span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            marginTop: 4,
            background: "var(--color-surface, #ffffff)",
            border: "1px solid var(--color-border, #e5e7eb)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 240,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            autoFocus
            style={{
              ...inputStyle,
              border: "none",
              borderBottom: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: "8px 8px 0 0",
            }}
          />
          <div style={{ overflowY: "auto", maxHeight: 200 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>
                No results
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setSearch(""); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 12px",
                    fontSize: 12,
                    border: "none",
                    background: o.id === value ? "var(--color-surface-2, #f3f4f6)" : "transparent",
                    cursor: "pointer",
                    color: "var(--color-text-main)",
                    fontFamily: "inherit",
                  }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
          onClick={() => { setOpen(false); setSearch(""); }}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 6,
  background: "var(--color-surface, #ffffff)",
  color: "var(--color-text-main)",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
};

const clearButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 6,
  top: "50%",
  transform: "translateY(-50%)",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  color: "var(--color-text-muted, #6b7280)",
  padding: 2,
};
