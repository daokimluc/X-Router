/**
 * TTS (Text-to-Speech) Handler
 *
 * Supports multiple TTS formats by dispatching on `config.format`:
 *
 *   openai          — POST {baseUrl} { model, input, voice }            → mp3
 *   elevenlabs      — POST {baseUrl}/{voiceId} { text, model_id, ... }  → mp3
 *   deepgram        — POST {baseUrl}?model=… { text } (Token auth)      → mp3
 *   minimax-tts     — POST {baseUrl} { model, text, voice_setting, … }  → hex JSON
 *   gemini-tts      — POST {baseUrl}/{model}:generateContent { … }      → PCM
 *   nvidia-tts      — POST {baseUrl} { input:{text}, voice, model }     → wav
 *   hyperbolic      — POST {baseUrl} { text }                           → JSON {audio}
 *   huggingface-tts — POST {baseUrl}/{model} { inputs }                 → wav
 *   inworld         — POST {baseUrl} { text, voiceId, … } (Basic auth)  → JSON
 *   cartesia        — POST {baseUrl} { transcript, voice, … }           → mp3
 *   playht          — POST {baseUrl} { text, voice, voice_engine }      → mp3
 *   coqui           — POST {baseUrl} { text, speaker_id }    (no auth)  → wav
 *   tortoise        — POST {baseUrl} { text, voice }         (no auth)  → wav
 *
 * Client-only formats (return 501):
 *   edge-tts, google-tts, local-device — these run in the browser only,
 *   not server-side. The handler returns a 501 with a helpful message.
 *
 * Not yet implemented (return 501):
 *   aws-polly  — needs SigV4 request signing
 *   openrouter — needs SSE chunked audio assembly
 *
 * Returns binary audio data on success.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import type { MediaKindHandler, MediaRequestBuild } from "../MediaKindHandler.js";
import type { MediaServiceConfig, TTSRequest } from "../types.js";

export class TTSHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown
  ): MediaRequestBuild {
    const req = payload as TTSRequest;
    const format = config.format || "openai";

    switch (format) {
      case "elevenlabs":
        return this.buildElevenLabsRequest(config, model, req, credentials);
      case "deepgram":
        return this.buildDeepgramRequest(config, model, req, credentials);
      case "minimax":
      case "minimax-tts":
        return this.buildMinimaxRequest(config, model, req, credentials);
      case "gemini":
      case "gemini-tts":
        return this.buildGeminiRequest(config, model, req, credentials);
      case "nvidia-tts":
        return this.buildNvidiaRequest(config, model, req, credentials);
      case "hyperbolic":
        return this.buildHyperbolicRequest(config, req, credentials);
      case "huggingface-tts":
        return this.buildHuggingFaceRequest(config, model, req, credentials);
      case "inworld":
        return this.buildInworldRequest(config, model, req, credentials);
      case "cartesia":
        return this.buildCartesiaRequest(config, model, req, credentials);
      case "playht":
        return this.buildPlayHtRequest(config, model, req, credentials);
      case "coqui":
        return this.buildCoquiRequest(config, req);
      case "tortoise":
        return this.buildTortoiseRequest(config, req);
      // Server-side free TTS (no auth needed) — handled via special
      // synthesize functions that bypass the normal buildRequest flow.
      // These return a sentinel MediaRequestBuild that MediaRouter will
      // detect and handle specially. We encode the format + model in the
      // URL so the caller can dispatch.
      case "edge-tts":
      case "google-tts":
        return {
          url: `__special_tts__/${format}`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: req.input, model }),
        };
      case "local-device":
        throw new Error(
          `TTS format 'local-device' runs in the browser only — it cannot be served via the gateway.`
        );
      // Server-side but not yet implemented.
      case "aws-polly":
        throw new Error(
          "TTS format 'aws-polly' requires AWS SigV4 request signing which is not yet implemented."
        );
      case "openrouter":
        throw new Error(
          "TTS format 'openrouter' requires SSE chunked audio assembly which is not yet implemented."
        );
      case "openai":
      default:
        return this.buildOpenAIRequest(config, model, req, credentials);
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

    // Try to detect JSON envelopes that wrap base64/hex audio (minimax,
    // hyperbolic, inworld). Otherwise treat as raw audio buffer.
    const ct = responseBody.length;
    if (ct === 0) {
      return responseBody;
    }
    // Only attempt JSON parse if body looks like JSON (starts with `{`).
    if (responseBody[0] === 0x7b /* '{' */) {
      try {
        const parsed = JSON.parse(responseBody.toString("utf-8")) as Record<string, unknown>;
        // MiniMax: { data: { audio: hex }, base_resp: { status_code } }
        const data = parsed.data as Record<string, unknown> | undefined;
        if (data && typeof data.audio === "string") {
          return Buffer.from(data.audio, "hex");
        }
        // Hyperbolic: { audio: base64 }
        if (typeof parsed.audio === "string") {
          return Buffer.from(parsed.audio, "base64");
        }
        // Inworld: { audioContent: base64 }
        if (typeof parsed.audioContent === "string") {
          return Buffer.from(parsed.audioContent, "base64");
        }
        // Gemini: { candidates: [ { content: { parts: [ { inlineData: { data: base64 } } ] } } ] }
        const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
        const part = (
          (candidates?.[0]?.content as Record<string, unknown> | undefined)?.parts as
            | Array<Record<string, unknown>>
            | undefined
        )?.find((p) => (p.inlineData as Record<string, unknown> | undefined)?.data);
        const inline = part?.inlineData as Record<string, unknown> | undefined;
        if (inline && typeof inline.data === "string") {
          return Buffer.from(inline.data, "base64");
        }
        // Unknown JSON shape — return parsed object so callers can inspect.
        return parsed;
      } catch {
        // Not actually JSON — fall through.
      }
    }

    // Default: raw binary audio buffer.
    return responseBody;
  }

  // ── builders ─────────────────────────────────────────────────────────

  private buildOpenAIRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // OpenAI catalog baseUrl is the full speech endpoint
    // (https://api.openai.com/v1/audio/speech). When users override the
    // baseUrl to just the API root, append /audio/speech.
    const url = config.baseUrl.endsWith("/audio/speech")
      ? config.baseUrl
      : `${config.baseUrl.replace(/\/$/, "")}/audio/speech`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      model,
      input: req.input,
      voice: req.voice || "alloy",
    };

    if (req.response_format) body.response_format = req.response_format;
    if (req.speed != null) body.speed = req.speed;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildElevenLabsRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // ElevenLabs uses the voice id as the path suffix and `model_id` in body.
    const voiceId = req.voice || "21m00Tcm4TlvDq8ikWAM";
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${voiceId}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      text: req.input,
      model_id: model || "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    };
    if (req.response_format) body.output_format = req.response_format;

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildDeepgramRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Deepgram puts the model in the query string and uses Token auth.
    const target = new URL(config.baseUrl);
    target.searchParams.set("model", model || "aura-asteria-en");
    if (req.voice && !target.searchParams.has("voice")) {
      target.searchParams.set("voice", req.voice);
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    return {
      url: target.toString(),
      method: "POST",
      headers,
      body: JSON.stringify({ text: req.input }),
    };
  }

  private buildMinimaxRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Minimax baseUrl already targets t2a_v2 — no path append needed.
    const url = config.baseUrl;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };

    const body: Record<string, unknown> = {
      model: model || "speech-2.8-hd",
      text: req.input,
      stream: false,
      language_boost: "auto",
      output_format: "hex",
      voice_setting: {
        voice_id: req.voice || "English_expressive_narrator",
        speed: req.speed ?? 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: req.response_format || "mp3",
        channel: 1,
      },
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildGeminiRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Gemini puts the API key as a query parameter, not a header.
    const creds = credentials as Record<string, string> | null;
    const apiKey = creds?.apiKey || creds?.token || "";
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const body = {
      contents: [{ parts: [{ text: `Say: ${req.input}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: req.voice || "Kore" },
          },
        },
      },
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildNvidiaRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      input: { text: req.input },
      voice: req.voice || "default",
      model,
    };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildHyperbolicRequest(
    config: MediaServiceConfig,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify({ text: req.input }),
    };
  }

  private buildHuggingFaceRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    if (!model || model.includes("..") || model.includes("//")) {
      throw new Error(`Invalid HuggingFace model id: '${model}'`);
    }
    const base = config.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    return {
      url: `${base}/${model}`,
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: req.input }),
    };
  }

  private buildInworldRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      text: req.input,
      voiceId: req.voice || "Alex",
      modelId: model || "inworld-tts-1.5-mini",
      audioConfig: { audioEncoding: "MP3" },
    };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildCartesiaRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cartesia-Version": "2024-06-10",
      ...this.buildAuthHeaders(config, credentials),
    };
    const body: Record<string, unknown> = {
      model_id: model || "sonic-2",
      transcript: req.input,
      output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
    };
    if (req.voice) body.voice = { mode: "id", id: req.voice };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildPlayHtRequest(
    config: MediaServiceConfig,
    model: string,
    req: TTSRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // PlayHT auth = "userId:apiKey" stored in the credential field.
    const creds = credentials as Record<string, string> | null;
    const token = creds?.apiKey || creds?.token || "";
    const [userId, apiKey] = token.includes(":") ? token.split(":") : ["", token];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
      "X-USER-ID": userId,
      Authorization: `Bearer ${apiKey}`,
    };
    const body: Record<string, unknown> = {
      text: req.input,
      voice:
        req.voice ||
        "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
      voice_engine: model || "PlayDialog",
      output_format: req.response_format || "mp3",
      speed: req.speed ?? 1,
    };
    return {
      url: config.baseUrl,
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
  }

  private buildCoquiRequest(
    config: MediaServiceConfig,
    req: TTSRequest
  ): MediaRequestBuild {
    const body: Record<string, unknown> = { text: req.input };
    if (req.voice) body.speaker_id = req.voice;
    return {
      url: config.baseUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  private buildTortoiseRequest(
    config: MediaServiceConfig,
    req: TTSRequest
  ): MediaRequestBuild {
    return {
      url: config.baseUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: req.input, voice: req.voice || "random" }),
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
        // authHeader determines the header name and prefix style.
        const h = (config.authHeader || "x-api-key").toLowerCase();
        if (h === "bearer") return { Authorization: `Bearer ${token}` };
        if (h === "token") return { Authorization: `Token ${token}` };
        if (h === "key") return { Authorization: `Key ${token}` };
        if (h === "basic") return { Authorization: `Basic ${token}` };
        if (h === "xi-api-key") return { "xi-api-key": token };
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
