/**
 * HTTP/2 client for the local Windsurf language server binary.
 *
 * Ported from dwgx/WindsurfAPI/src/grpc.js (MIT). See
 * LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Supports legacy gRPC framing only — Connect-RPC variant from upstream
 * is dropped because the production language server returns empty
 * cascade_id with Connect framing as of v2.0.20 (per upstream comment).
 */

import http2 from "node:http2";
import { extractGrpcFrames, stripGrpcFrame } from "./grpcFrame.js";

// ─── HTTP/2 session pool ───────────────────────────────────
//
// One HTTP/2 session per LS port, multiplexed across requests.
// HTTP/2 is multiplexed — one session happily carries many concurrent
// streams. Without pooling, every gRPC call would do its own TCP +
// SETTINGS handshake which under chat bursts wastes round-trips and
// burns ephemeral ports.
//
// The session is torn down (and a fresh one will be opened on demand)
// if it emits 'error' or 'close' — callers still see the error on
// their own `req` object because the stream error is delivered
// independently.

const _sessionPool = new Map<string, http2.ClientHttp2Session>();

function getSession(port: number): http2.ClientHttp2Session {
  const key = `localhost:${port}`;
  const existing = _sessionPool.get(key);
  if (existing && !existing.destroyed && !existing.closed) {
    return existing;
  }

  const session = http2.connect(`http://localhost:${port}`);
  session.on("error", () => {
    if (_sessionPool.get(key) === session) {
      _sessionPool.delete(key);
    }
  });
  session.on("close", () => {
    if (_sessionPool.get(key) === session) {
      _sessionPool.delete(key);
    }
  });
  // The LS can hang up between requests; unref so an idle session
  // doesn't keep the Node event loop alive on its own.
  try {
    session.unref();
  } catch {
    // ignore
  }
  _sessionPool.set(key, session);
  return session;
}

/**
 * Close the pooled session for a port (used when the underlying LS is
 * stopped so the next call opens a fresh session).
 */
export function closeSessionForPort(port: number): void {
  const key = `localhost:${port}`;
  const session = _sessionPool.get(key);
  if (session) {
    try {
      session.close();
    } catch {
      // ignore
    }
    _sessionPool.delete(key);
  }
}

/**
 * Wrap a protobuf payload as an uncompressed gRPC frame.
 * Layout: [1 byte compressed flag = 0] [4 bytes big-endian length] [payload].
 */
export function grpcFrame(payload: Buffer): Buffer {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const frame = Buffer.alloc(5 + buf.length);
  frame[0] = 0;
  frame.writeUInt32BE(buf.length, 1);
  buf.copy(frame, 5);
  return frame;
}

export type GrpcStreamCallbacks = {
  onData?: (payload: Buffer) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
  timeout?: number;
};

/**
 * Make a unary gRPC call to the language server.
 *
 * @param port - Language server port
 * @param csrfToken - Fixed CSRF token configured at LS spawn
 * @param path - gRPC path, e.g.
 *               `/exa.language_server_pb.LanguageServerService/StartCascade`
 * @param body - gRPC-framed request bytes (see {@link grpcFrame})
 * @param timeout - Timeout in ms (default 30s)
 * @returns Concatenated payload of all response frames (gRPC frame headers stripped).
 */
export function grpcUnary(
  port: number,
  csrfToken: string,
  path: string,
  body: Buffer,
  timeout = 30_000
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const done = (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(...args);
    };

    const client = getSession(port);
    const chunks: Buffer[] = [];

    const headers: http2.OutgoingHttpHeaders = {
      ":method": "POST",
      ":path": path,
      "content-type": "application/grpc",
      te: "trailers",
      "user-agent": "grpc-node/1.108.2",
      "x-codeium-csrf-token": csrfToken,
    };

    const req = client.request(headers);

    const timer = setTimeout(() => {
      try {
        req.close(http2.constants.NGHTTP2_CANCEL);
      } catch {
        // ignore
      }
      done(reject as (...args: unknown[]) => void, new Error("gRPC unary timeout"));
    }, timeout);

    req.on("data", (chunk: Buffer) => chunks.push(chunk));

    let grpcStatus = "0";
    let grpcMessage = "";

    req.on("trailers", (trailers) => {
      grpcStatus = String(trailers["grpc-status"] ?? "0");
      grpcMessage = String(trailers["grpc-message"] ?? "");
    });

    req.on("end", () => {
      clearTimeout(timer);
      if (grpcStatus !== "0") {
        const msg = grpcMessage
          ? safeDecodeURIComponent(grpcMessage)
          : `gRPC status ${grpcStatus}`;
        done(reject as (...args: unknown[]) => void, new Error(msg));
        return;
      }
      const full = Buffer.concat(chunks);
      const frames = extractGrpcFrames(full);
      const payload =
        frames.length > 0 ? Buffer.concat(frames) : stripGrpcFrame(full);
      done(resolve as (...args: unknown[]) => void, payload);
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      done(reject as (...args: unknown[]) => void, err);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Make a streaming gRPC call to the language server.
 * Calls `onData(payload)` for each gRPC frame as it arrives.
 *
 * Caller may abort by calling the returned `cancel()` function.
 */
export function grpcStream(
  port: number,
  csrfToken: string,
  path: string,
  body: Buffer,
  opts: GrpcStreamCallbacks = {}
): { cancel: () => void } {
  const { onData, onEnd, onError, timeout = 300_000 } = opts;

  let settled = false;
  const client = getSession(port);
  let pendingBuf = Buffer.alloc(0);

  const streamHeaders: http2.OutgoingHttpHeaders = {
    ":method": "POST",
    ":path": path,
    "content-type": "application/grpc",
    te: "trailers",
    "grpc-accept-encoding": "identity,gzip,deflate",
    "user-agent": "grpc-node/1.108.2",
    "x-codeium-csrf-token": csrfToken,
  };

  const req = client.request(streamHeaders);

  const timer = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    try {
      req.close(http2.constants.NGHTTP2_CANCEL);
    } catch {
      // ignore
    }
    onError?.(new Error("gRPC stream timeout"));
  }, timeout);

  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    try {
      req.close(http2.constants.NGHTTP2_CANCEL);
    } catch {
      // ignore
    }
  };

  req.on("data", (chunk: Buffer) => {
    if (settled) {
      return;
    }

    pendingBuf = Buffer.concat([pendingBuf, chunk]);
    if (pendingBuf.length > 100 * 1024 * 1024) {
      settled = true;
      clearTimeout(timer);
      try {
        req.close(http2.constants.NGHTTP2_CANCEL);
      } catch {
        // ignore
      }
      onError?.(new Error("gRPC frame too large (>100MB)"));
      return;
    }

    while (pendingBuf.length >= 5) {
      const compressed = pendingBuf[0];
      const msgLen = pendingBuf.readUInt32BE(1);
      if (pendingBuf.length < 5 + msgLen) {
        break;
      }

      if (compressed === 0) {
        const payload = pendingBuf.subarray(5, 5 + msgLen);
        onData?.(Buffer.from(payload));
      }
      pendingBuf = pendingBuf.subarray(5 + msgLen);
    }
  });

  let grpcStatus = "0";
  let grpcMessage = "";

  req.on("trailers", (trailers) => {
    grpcStatus = String(trailers["grpc-status"] ?? "0");
    grpcMessage = String(trailers["grpc-message"] ?? "");
  });

  req.on("end", () => {
    clearTimeout(timer);
    if (settled) {
      return;
    }
    settled = true;
    if (grpcStatus !== "0") {
      const msg = grpcMessage
        ? safeDecodeURIComponent(grpcMessage)
        : `gRPC status ${grpcStatus}`;
      onError?.(new Error(msg));
    } else {
      onEnd?.();
    }
  });

  req.on("error", (err: Error) => {
    clearTimeout(timer);
    if (settled) {
      return;
    }
    settled = true;
    onError?.(err);
  });

  req.write(body);
  req.end();

  return { cancel };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
