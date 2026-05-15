/**
 * gRPC frame helpers shared between unary and streaming codepaths.
 *
 * Ported from dwgx/WindsurfAPI/src/grpc.js (MIT). See
 * LICENSE-WindsurfAPI.md in this directory for attribution.
 */

/** Strip gRPC frame header (5 bytes) from a single response buffer. */
export function stripGrpcFrame(buf: Buffer): Buffer {
  if (buf.length >= 5 && buf[0] === 0) {
    const msgLen = buf.readUInt32BE(1);
    if (buf.length >= 5 + msgLen) {
      return Buffer.from(buf.subarray(5, 5 + msgLen));
    }
  }
  return buf;
}

/**
 * Extract all gRPC frames from a buffer (may contain multiple
 * concatenated frames). Stops at the first incomplete or compressed frame.
 */
export function extractGrpcFrames(buf: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const compressed = buf[offset];
    const msgLen = buf.readUInt32BE(offset + 1);
    if (compressed !== 0 || offset + 5 + msgLen > buf.length) {
      break;
    }
    frames.push(Buffer.from(buf.subarray(offset + 5, offset + 5 + msgLen)));
    offset += 5 + msgLen;
  }
  return frames;
}
