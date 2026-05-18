/**
 * STT (Speech-to-Text) Handler
 *
 * Supports multipart file upload and multiple STT formats by dispatching on
 * `config.format`:
 *
 *   openai          — multipart POST {baseUrl}              {file, model}
 *   deepgram        — POST {baseUrl}?model=… raw audio bytes (Token auth)
 *   gemini-stt      — POST {baseUrl}/{model}:generateContent {inline_data}
 *   huggingface-asr — POST {baseUrl}/{model} raw audio bytes
 *   nvidia-asr      — multipart POST {baseUrl}              {file, model}
 *
 * Async (not yet implemented — returns 501):
 *   assemblyai      — needs upload → submit → poll cycle
 *
 * Returns transcription in standard OpenAI shape `{ text: string }`.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type { MediaKindHandler, MediaRequestBuild } from "../MediaKindHandler.js";
import type { MediaServiceConfig, STTRequest, STTResponse } from "../types.js";

export class STTHandler implements MediaKindHandler {
  buildRequest(
    config: MediaServiceConfig,
    model: string,
    payload: unknown,
    credentials: unknown
  ): MediaRequestBuild {
    const req = payload as STTRequest;
    const format = config.format || "openai";

    switch (format) {
      case "deepgram":
        return this.buildDeepgramRequest(config, model, req, credentials);
      case "gemini":
      case "gemini-stt":
        return this.buildGeminiRequest(config, model, req, credentials);
      case "huggingface":
      case "huggingface-asr":
        return this.buildHuggingFaceRequest(config, model, req, credentials);
      case "nvidia-asr":
        return this.buildNvidiaRequest(config, model, req, credentials);
      case "assemblyai":
        // AssemblyAI requires an async upload+submit+poll cycle that
        // doesn't fit the buildRequest/normalizeResponse shape. Surface
        // a clear error rather than silently issuing a broken request.
        throw new Error(
          "STT format 'assemblyai' uses async upload + polling which is not yet implemented."
        );
      case "groq":
      case "openai":
      default:
        // Groq is OpenAI-compatible — same multipart shape.
        return this.buildOpenAICompatibleRequest(config, model, req, credentials);
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
      // Some providers respond with text/plain when response_format=text.
      return { text: responseBody.toString("utf-8") } as STTResponse;
    }

    // Already in OpenAI shape (covers OpenAI, Groq, AssemblyAI, HF text endpoints).
    if (typeof raw.text === "string") {
      return { text: raw.text } as STTResponse;
    }

    // Deepgram: results.channels[0].alternatives[0].transcript
    const dgChannels = (raw.results as Record<string, unknown> | undefined)?.channels as
      | Array<Record<string, unknown>>
      | undefined;
    const dgTranscript = (
      dgChannels?.[0]?.alternatives as Array<Record<string, unknown>> | undefined
    )?.[0]?.transcript;
    if (typeof dgTranscript === "string") {
      return { text: dgTranscript } as STTResponse;
    }

    // Gemini: candidates[0].content.parts[*].text
    const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
    const parts = (candidates?.[0]?.content as Record<string, unknown> | undefined)
      ?.parts as Array<Record<string, unknown>> | undefined;
    const geminiText = parts
      ?.map((p) => (typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
    if (geminiText) {
      return { text: geminiText } as STTResponse;
    }

    // Nvidia/other: { transcript: "…" }
    if (typeof raw.transcript === "string") {
      return { text: raw.transcript } as STTResponse;
    }

    // Fallback — surface raw body so callers can inspect.
    return { text: "" } as STTResponse;
  }

  // ── builders ─────────────────────────────────────────────────────────

  private buildOpenAICompatibleRequest(
    config: MediaServiceConfig,
    model: string,
    req: STTRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // OpenAI catalog baseUrl is the full transcriptions endpoint. When
    // users override to just the API root, append /audio/transcriptions.
    const url = config.baseUrl.endsWith("/audio/transcriptions")
      ? config.baseUrl
      : `${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
    const boundary = `----FormBoundary${Date.now().toString(36)}`;
    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...this.buildAuthHeaders(config, credentials),
    };
    const body = this.buildMultipartBody(boundary, model, req);
    return { url, method: "POST", headers, body };
  }

  private buildNvidiaRequest(
    config: MediaServiceConfig,
    model: string,
    req: STTRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const boundary = `----FormBoundary${Date.now().toString(36)}`;
    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...this.buildAuthHeaders(config, credentials),
    };
    const body = this.buildMultipartBody(boundary, model, req);
    return { url: config.baseUrl, method: "POST", headers, body };
  }

  private buildDeepgramRequest(
    config: MediaServiceConfig,
    model: string,
    req: STTRequest,
    credentials: unknown
  ): MediaRequestBuild {
    const target = new URL(config.baseUrl);
    target.searchParams.set("model", model);
    target.searchParams.set("smart_format", "true");
    target.searchParams.set("punctuate", "true");
    if (req.language) {
      target.searchParams.set("language", req.language);
    } else {
      target.searchParams.set("detect_language", "true");
    }

    const headers: Record<string, string> = {
      "Content-Type": "audio/wav",
      ...this.buildAuthHeaders(config, credentials),
    };

    return {
      url: target.toString(),
      method: "POST",
      headers,
      body: req.file,
    };
  }

  private buildGeminiRequest(
    config: MediaServiceConfig,
    model: string,
    req: STTRequest,
    credentials: unknown
  ): MediaRequestBuild {
    // Gemini uses ?key=… auth, not a header.
    const creds = credentials as Record<string, string> | null;
    const apiKey = creds?.apiKey || creds?.token || "";
    const base = config.baseUrl.replace(/\/$/, "");
    const url = `${base}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    let prompt =
      "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
    if (req.language) prompt += ` Language: ${req.language}.`;

    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "audio/wav",
                data: req.file.toString("base64"),
              },
            },
          ],
        },
      ],
    };

    return { url, method: "POST", headers, body: JSON.stringify(body) };
  }

  private buildHuggingFaceRequest(
    config: MediaServiceConfig,
    model: string,
    req: STTRequest,
    credentials: unknown
  ): MediaRequestBuild {
    if (!model || model.includes("..") || model.includes("//")) {
      throw new Error(`Invalid HuggingFace model id: '${model}'`);
    }
    const base = config.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "audio/wav",
      ...this.buildAuthHeaders(config, credentials),
    };
    return {
      url: `${base}/${model}`,
      method: "POST",
      headers,
      body: req.file,
    };
  }

  private buildMultipartBody(boundary: string, model: string, req: STTRequest): Buffer {
    const parts: Buffer[] = [];

    // File part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
          `Content-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(req.file);
    parts.push(Buffer.from("\r\n"));

    // Model part
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model"\r\n\r\n` +
          `${model}\r\n`
      )
    );

    if (req.language) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language"\r\n\r\n` +
            `${req.language}\r\n`
        )
      );
    }

    if (req.response_format) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
            `${req.response_format}\r\n`
        )
      );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return Buffer.concat(parts);
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
        if (h === "basic") return { Authorization: `Basic ${token}` };
        if (h === "x-api-key") return { "x-api-key": token };
        if (h === "xi-api-key") return { "xi-api-key": token };
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
