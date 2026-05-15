/**
 * Connect-RPC envelope framing and compression.
 *
 * Ported from dwgx/WindsurfAPI/src/connect.js (MIT). See
 * LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Connect-RPC frame format:
 *   [1 byte flags] [4 bytes big-endian length] [N bytes payload]
 *
 * Flags:
 *   0x01 = gzip compressed
 *   0x02 = end-of-stream (trailer frame, JSON payload)
 *   0x03 = compressed + end-of-stream
 *
 * IMPORTANT: Connect-RPC uses HTTP/1.1 POST, NOT HTTP/2 gRPC.
 * Content-Type: application/connect+proto
 */

import { gunzipSync, gzipSync } from "node:zlib";

// ─── Compression helpers ───────────────────────────────────

export function gzip(buf: Buffer): Buffer {
  return gzipSync(buf);
}

export function gunzip(buf: Buffer): Buffer {
  return gunzipSync(buf);
}

export function tryGunzip(buf: Buffer): Buffer | null {
  try {
    return gunzipSync(buf);
  } catch {
    return null;
  }
}

// ─── Envelope wrapping ─────────────────────────────────────

/** Wrap protobuf bytes in a Connect-RPC envelope frame. */
export function wrapEnvelope(
  protoBuf: Buffer,
  options: { compress?: boolean } = {}
): Buffer {
  const compress = options.compress ?? true;
  let payload = protoBuf;
  let flags = 0;
  if (compress && payload.length > 0) {
    payload = gzipSync(payload);
    flags |= 0x01;
  }
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flags;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

/** Wrap a request for sending (single envelope, gzipped). */
export function wrapRequest(protoBuf: Buffer): Buffer {
  return wrapEnvelope(protoBuf, { compress: true });
}

/** Build the end-of-stream trailer frame (JSON {}). */
export function endOfStreamEnvelope(): Buffer {
  const trailer = Buffer.from("{}");
  const frame = Buffer.alloc(5 + trailer.length);
  frame[0] = 0x02; // end-of-stream, not compressed
  frame.writeUInt32BE(trailer.length, 1);
  trailer.copy(frame, 5);
  return frame;
}

// ─── Streaming frame parser ───────────────────────────────

export type ConnectFrame = {
  flags: number;
  isEndStream: boolean;
  payload: Buffer;
};

/** Stateful parser that buffers incoming data and yields complete frames. */
export class StreamingFrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  /** Drain all complete frames. */
  drain(): ConnectFrame[] {
    // Guard against malformed upstream frames that advertise absurd lengths —
    // without this, Buffer.concat would try to allocate gigabytes.
    const MAX_FRAME_SIZE = 16 * 1024 * 1024;
    const frames: ConnectFrame[] = [];
    while (this.buffer.length >= 5) {
      const len = this.buffer.readUInt32BE(1);
      if (len > MAX_FRAME_SIZE) {
        throw new Error(`HTTP/2 frame size ${len} exceeds ${MAX_FRAME_SIZE}`);
      }
      if (this.buffer.length < 5 + len) {
        break;
      }

      const flags = this.buffer[0];
      let payload = this.buffer.subarray(5, 5 + len);
      if (flags & 0x01) {
        try {
          payload = gunzipSync(payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Connect frame decompression failed: ${message}`);
        }
      }

      frames.push({
        flags,
        isEndStream: !!(flags & 0x02),
        payload: Buffer.from(payload),
      });
      this.buffer = this.buffer.subarray(5 + len);
    }
    return frames;
  }
}

// ─── Connect-RPC headers ──────────────────────────────────

export function connectHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/connect+proto",
    "Connect-Protocol-Version": "1",
    "Connect-Accept-Encoding": "gzip",
    "User-Agent": "connect-es/2.0.0",
    ...extra,
  };
}
