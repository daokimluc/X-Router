/**
 * Media Kind Registry
 *
 * Maintains a registry of available media kind handlers.
 * Registers handlers for each MediaKind (embedding, image, imageToText,
 * tts, stt, webSearch, webFetch).
 *
 * Requirements: 5.1
 */

import type { MediaKind } from "./types.js";
import type { MediaKindHandler } from "./MediaKindHandler.js";
import { EmbeddingHandler } from "./handlers/EmbeddingHandler.js";
import { ImageGenerationHandler } from "./handlers/ImageGenerationHandler.js";
import { ImageToTextHandler } from "./handlers/ImageToTextHandler.js";
import { TTSHandler } from "./handlers/TTSHandler.js";
import { STTHandler } from "./handlers/STTHandler.js";
import { WebSearchHandler } from "./handlers/WebSearchHandler.js";
import { WebFetchHandler } from "./handlers/WebFetchHandler.js";

export class MediaKindRegistry {
  private readonly handlers = new Map<MediaKind, MediaKindHandler>();

  constructor() {
    // Register all built-in handlers
    this.handlers.set("embedding", new EmbeddingHandler());
    this.handlers.set("image", new ImageGenerationHandler());
    this.handlers.set("imageToText", new ImageToTextHandler());
    this.handlers.set("tts", new TTSHandler());
    this.handlers.set("stt", new STTHandler());
    this.handlers.set("webSearch", new WebSearchHandler());
    this.handlers.set("webFetch", new WebFetchHandler());
  }

  /**
   * Get the handler for a specific media kind.
   */
  getHandler(kind: MediaKind): MediaKindHandler | undefined {
    return this.handlers.get(kind);
  }

  /**
   * Register or replace a handler for a media kind.
   */
  registerHandler(kind: MediaKind, handler: MediaKindHandler): void {
    this.handlers.set(kind, handler);
  }

  /**
   * Check if a handler is registered for the given kind.
   */
  hasHandler(kind: MediaKind): boolean {
    return this.handlers.has(kind);
  }

  /**
   * List all registered media kinds.
   */
  listKinds(): MediaKind[] {
    return Array.from(this.handlers.keys());
  }
}
