/**
 * Protobuf wire-format codec — zero-dependency, schema-less.
 *
 * Ported from dwgx/WindsurfAPI/src/proto.js (MIT). See
 * LICENSE-WindsurfAPI.md in this directory for attribution.
 *
 * Wire types:
 *   0 = Varint    (int32, uint64, bool, enum)
 *   1 = Fixed64   (double, fixed64)
 *   2 = LenDelim  (string, bytes, embedded messages)
 *   5 = Fixed32   (float, fixed32)
 */

const EMPTY = Buffer.alloc(0);

// ─── Varint ────────────────────────────────────────────────

export function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  // BigInt path for negatives (two's-complement uint64) and any int > 2^31
  // since JS `>>>` truncates to uint32 and silently corrupts larger varints.
  if (typeof value === "bigint" || value < 0 || value > 0x7fffffff) {
    let b =
      (typeof value === "bigint" ? value : BigInt(value)) &
      0xffffffffffffffffn;
    while (true) {
      const byte = Number(b & 0x7fn);
      b >>= 7n;
      if (b === 0n) {
        bytes.push(byte);
        break;
      }
      bytes.push(byte | 0x80);
    }
    return Buffer.from(bytes);
  }
  let v = Number(value);
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

export type DecodedVarint = {
  value: number | bigint;
  length: number;
};

export function decodeVarint(buf: Buffer, offset = 0): DecodedVarint {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length && shift < 28) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return { value: result >>> 0, length: pos - offset };
    }
    shift += 7;
  }
  if (pos >= buf.length) {
    throw new Error("Truncated varint");
  }
  // Continuation byte needed beyond 28 bits — switch to BigInt.
  let big = BigInt(result >>> 0);
  let bigShift = BigInt(shift);
  while (pos < buf.length) {
    const byte = buf[pos++];
    big |= BigInt(byte & 0x7f) << bigShift;
    if (!(byte & 0x80)) {
      const asNum = Number(big);
      return {
        value: Number.isSafeInteger(asNum) ? asNum : big,
        length: pos - offset,
      };
    }
    bigShift += 7n;
    if (bigShift >= 64n) {
      throw new Error("Varint overflow");
    }
  }
  throw new Error("Truncated varint");
}

// ─── Field-level writers ───────────────────────────────────

function makeTag(field: number, wireType: number): Buffer {
  return encodeVarint((field << 3) | wireType);
}

/** Write a varint field (wire type 0). */
export function writeVarintField(field: number, value: number | bigint): Buffer {
  return Buffer.concat([makeTag(field, 0), encodeVarint(value)]);
}

/** Write a length-delimited string field (wire type 2). */
export function writeStringField(field: number, str: string): Buffer {
  if (!str && str !== "") {
    return EMPTY;
  }
  const data = Buffer.from(str, "utf-8");
  return Buffer.concat([makeTag(field, 2), encodeVarint(data.length), data]);
}

/** Write a length-delimited bytes field (wire type 2). */
export function writeBytesField(field: number, data: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([makeTag(field, 2), encodeVarint(buf.length), buf]);
}

/** Write an embedded message field (wire type 2). */
export function writeMessageField(field: number, msgBuf: Buffer): Buffer {
  if (!msgBuf || msgBuf.length === 0) {
    return EMPTY;
  }
  return Buffer.concat([makeTag(field, 2), encodeVarint(msgBuf.length), msgBuf]);
}

/** Write a fixed64 field (wire type 1). buf8 must be exactly 8 bytes. */
export function writeFixed64Field(field: number, buf8: Buffer): Buffer {
  return Buffer.concat([makeTag(field, 1), buf8]);
}

/** Write a bool field (wire type 0), only if true. */
export function writeBoolField(field: number, value: boolean): Buffer {
  if (!value) {
    return EMPTY;
  }
  return writeVarintField(field, 1);
}

// ─── Parser ────────────────────────────────────────────────

export type ProtoField = {
  field: number;
  wireType: number;
  /** Buffer for wireType 1/2/5; Number/BigInt for wireType 0. */
  value: Buffer | number | bigint;
};

/**
 * Parse a protobuf buffer into an array of { field, wireType, value }.
 *
 * For varint (0): value is a Number or BigInt.
 * For lendelim (2): value is a Buffer (caller decides string vs message).
 * For fixed64 (1): value is an 8-byte Buffer.
 * For fixed32 (5): value is a 4-byte Buffer.
 */
export function parseFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = decodeVarint(buf, pos);
    pos += tag.length;
    const tagNum = Number(tag.value);
    const fieldNum = tagNum >>> 3;
    const wireType = tagNum & 0x07;

    let value: Buffer | number | bigint;
    switch (wireType) {
      case 0: {
        const v = decodeVarint(buf, pos);
        pos += v.length;
        value = v.value;
        break;
      }
      case 1: {
        if (pos + 8 > buf.length) {
          throw new Error(`truncated fixed64 at offset ${pos}`);
        }
        value = Buffer.from(buf.subarray(pos, pos + 8));
        pos += 8;
        break;
      }
      case 2: {
        const len = decodeVarint(buf, pos);
        pos += len.length;
        const sz = Number(len.value);
        if (sz < 0 || pos + sz > buf.length) {
          throw new Error(
            `truncated len-delim field ${fieldNum} at offset ${pos} (need ${sz}, have ${
              buf.length - pos
            })`
          );
        }
        value = Buffer.from(buf.subarray(pos, pos + sz));
        pos += sz;
        break;
      }
      case 5: {
        if (pos + 4 > buf.length) {
          throw new Error(`truncated fixed32 at offset ${pos}`);
        }
        value = Buffer.from(buf.subarray(pos, pos + 4));
        pos += 4;
        break;
      }
      default:
        throw new Error(`Unknown wire type ${wireType} at offset ${pos}`);
    }
    fields.push({ field: fieldNum, wireType, value });
  }
  return fields;
}

/** Get first field matching number and optional wire type. */
export function getField(
  fields: ProtoField[],
  num: number,
  wireType?: number
): ProtoField | null {
  return (
    fields.find(
      (f) => f.field === num && (wireType === undefined || f.wireType === wireType)
    ) ?? null
  );
}

/** Get all fields matching number. */
export function getAllFields(fields: ProtoField[], num: number): ProtoField[] {
  return fields.filter((f) => f.field === num);
}

/** Convenience: read a string from a length-delimited field. */
export function readString(field: ProtoField | null): string | undefined {
  if (!field || field.wireType !== 2 || !Buffer.isBuffer(field.value)) {
    return undefined;
  }
  return field.value.toString("utf8");
}

/** Convenience: read a bool from a varint field. */
export function readBool(field: ProtoField | null): boolean {
  if (!field || field.wireType !== 0) {
    return false;
  }
  return field.value !== 0 && field.value !== 0n;
}
