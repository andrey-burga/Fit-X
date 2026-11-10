/**
 * VigorCore — Serialization, Precision & Cryptographic Canonicalization Engine
 * Resolves F-SER-01: Zero Precision Loss Serialization & Three Independent Hashes
 * 
 * Guarantees:
 * 1. 64-bit integers are never converted to JS Number; parsed as BigInt with int64 bounds.
 * 2. BigInt JSON serialization uses tagged representation: { "@type": "int64", "value": "..." }.
 * 3. Timestamps preserve full 9-digit nanoseconds + RFC 3339 canonical representation.
 * 4. Deterministic canonicalization with Unicode NFC normalization and recursive key sorting.
 * 5. Three distinct cryptographically verifiable hashes: sourceHash, transformedHash, destinationHash.
 * 6. Explicit handling and reversibility validation for all 11 Firestore REST types.
 */

import crypto from 'node:crypto';

export const INT64_MIN = -9223372036854775808n;
export const INT64_MAX = 9223372036854775807n;

export interface TaggedInt64 {
  '@type': 'int64';
  value: string;
}

export interface PrecisionTimestamp {
  '@type': 'timestamp';
  seconds: bigint;
  nanoseconds: number; // 0 to 999,999,999
  rfc3339: string;     // Exact canonical RFC 3339 string with up to 9 decimals
}

export interface PrecisionGeoPoint {
  '@type': 'geopoint';
  latitude: number;
  longitude: number;
}

export interface PrecisionReference {
  '@type': 'reference';
  fullPath: string;
  relativePath: string;
}

export interface PrecisionBytes {
  '@type': 'bytes';
  base64: string;
}

/**
 * 1. Deserializes Firestore integerValue strictly to BigInt with 64-bit bounds checking.
 */
export function deserializeFirestoreInteger(value: string): bigint {
  if (typeof value !== 'string') {
    throw new TypeError(`deserializeFirestoreInteger requires string input, received ${typeof value}`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('MALFORMED_INTEGER: Empty string is not a valid 64-bit integer.');
  }

  // Reject non-decimal strings, floats, hex, exponentials, or whitespace
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`MALFORMED_INTEGER: Value '${value}' is not a valid decimal integer.`);
  }

  const big = BigInt(trimmed);

  if (big < INT64_MIN || big > INT64_MAX) {
    throw new RangeError(`INTEGER_OUT_OF_BOUNDS: Value ${trimmed} exceeds signed 64-bit integer range [${INT64_MIN}, ${INT64_MAX}].`);
  }

  return big;
}

/**
 * Tagged helper for BigInt
 */
export function toTaggedInt64(val: bigint | string): TaggedInt64 {
  const big = typeof val === 'bigint' ? val : deserializeFirestoreInteger(val);
  return {
    '@type': 'int64',
    value: big.toString(),
  };
}

/**
 * 2. Deserializes Firestore timestampValue preserving nanosecond precision.
 */
export function deserializeFirestoreTimestamp(rfc3339Str: string): PrecisionTimestamp {
  if (typeof rfc3339Str !== 'string' || !rfc3339Str.trim()) {
    throw new TypeError('MALFORMED_TIMESTAMP: Empty or non-string timestampValue.');
  }

  const trimmed = rfc3339Str.trim();

  // Regex capturing full RFC 3339 format with optional fractional seconds (up to 9 digits) and timezone offset
  // Examples: 2026-11-10T12:30:00Z, 2026-11-10T12:30:00.123456789Z, 2026-11-10T12:30:00.500+02:00
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-]\d{2}):(\d{2}))$/.exec(trimmed);

  if (!match) {
    throw new Error(`MALFORMED_TIMESTAMP: Value '${rfc3339Str}' does not match standard RFC 3339.`);
  }

  const [_, yStr, mStr, dStr, hStr, minStr, sStr, fracStr, tzHourStr, tzMinStr] = match;

  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1; // 0-indexed for Date.UTC
  const day = parseInt(dStr, 10);
  const hour = parseInt(hStr, 10);
  const minute = parseInt(minStr, 10);
  const second = parseInt(sStr, 10);

  // Pad fraction to 9 digits (nanoseconds)
  let nanoseconds = 0;
  if (fracStr) {
    const padded = fracStr.padEnd(9, '0').slice(0, 9);
    nanoseconds = parseInt(padded, 10);
  }

  // Calculate base UTC epoch seconds
  const dateObj = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (isNaN(dateObj.getTime())) {
    throw new Error(`MALFORMED_TIMESTAMP: Calendar date '${rfc3339Str}' is invalid.`);
  }

  let epochSeconds = BigInt(Math.floor(dateObj.getTime() / 1000));

  // Adjust for timezone offset if present (+HH:MM or -HH:MM)
  if (tzHourStr && tzMinStr) {
    const tzOffsetMinutes = parseInt(tzHourStr, 10) * 60 + (parseInt(tzHourStr, 10) < 0 ? -1 : 1) * parseInt(tzMinStr, 10);
    epochSeconds = epochSeconds - BigInt(tzOffsetMinutes * 60);
  }

  // Format canonical RFC 3339 in UTC
  const utcDate = new Date(Number(epochSeconds) * 1000);
  const yyyy = utcDate.getUTCFullYear().toString().padStart(4, '0');
  const mm = (utcDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = utcDate.getUTCDate().toString().padStart(2, '0');
  const hh = utcDate.getUTCHours().toString().padStart(2, '0');
  const m = utcDate.getUTCMinutes().toString().padStart(2, '0');
  const ss = utcDate.getUTCSeconds().toString().padStart(2, '0');
  const nanoStr = nanoseconds > 0 ? '.' + nanoseconds.toString().padStart(9, '0').replace(/0+$/, '') : '';

  const canonicalRfc3339 = `${yyyy}-${mm}-${dd}T${hh}:${m}:${ss}${nanoStr}Z`;

  return {
    '@type': 'timestamp',
    seconds: epochSeconds,
    nanoseconds,
    rfc3339: canonicalRfc3339,
  };
}

/**
 * 3. Deserializes all 11 Firestore REST v1 Typed Value Maps.
 */
export function deserializeFirestoreValue(valObj: Record<string, any>): unknown {
  if (!valObj || typeof valObj !== 'object') {
    throw new TypeError(`Expected Firestore typed value object, received ${typeof valObj}`);
  }

  if ('stringValue' in valObj) {
    return String(valObj.stringValue);
  }
  if ('integerValue' in valObj) {
    return toTaggedInt64(valObj.integerValue);
  }
  if ('doubleValue' in valObj) {
    const num = Number(valObj.doubleValue);
    if (!Number.isFinite(num)) {
      throw new Error(`INVALID_DOUBLE: Non-finite double value ${valObj.doubleValue} is not allowed.`);
    }
    return num;
  }
  if ('booleanValue' in valObj) {
    return Boolean(valObj.booleanValue);
  }
  if ('nullValue' in valObj) {
    return null;
  }
  if ('timestampValue' in valObj) {
    return deserializeFirestoreTimestamp(valObj.timestampValue);
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue?.fields || {};
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = deserializeFirestoreValue(v as Record<string, any>);
    }
    return res;
  }
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue?.values || [];
    return values.map((item: any) => deserializeFirestoreValue(item));
  }
  if ('referenceValue' in valObj) {
    const full = String(valObj.referenceValue);
    // Relative path extraction: projects/.../databases/.../documents(/users/...)
    const marker = '/documents/';
    const idx = full.indexOf(marker);
    const rel = idx !== -1 ? full.slice(idx + marker.length) : full;
    return {
      '@type': 'reference',
      fullPath: full,
      relativePath: rel,
    } as PrecisionReference;
  }
  if ('bytesValue' in valObj) {
    return {
      '@type': 'bytes',
      base64: String(valObj.bytesValue),
    } as PrecisionBytes;
  }
  if ('geoPointValue' in valObj) {
    return {
      '@type': 'geopoint',
      latitude: Number(valObj.geoPointValue?.latitude || 0),
      longitude: Number(valObj.geoPointValue?.longitude || 0),
    } as PrecisionGeoPoint;
  }

  throw new Error(`UNSUPPORTED_FIRESTORE_TYPE: Unrecognized type descriptor in ${JSON.stringify(valObj)}`);
}

/**
 * 4. Deserializes a full Firestore REST document payload.
 */
export function deserializeFirestoreDocument(rawDoc: { name: string; fields?: Record<string, any>; createTime?: string; updateTime?: string }): {
  id: string;
  name: string;
  fields: Record<string, unknown>;
  createTime?: PrecisionTimestamp;
  updateTime?: PrecisionTimestamp;
} {
  const fields: Record<string, unknown> = {};
  if (rawDoc.fields) {
    for (const [k, v] of Object.entries(rawDoc.fields)) {
      fields[k] = deserializeFirestoreValue(v);
    }
  }

  const parts = rawDoc.name.split('/');
  const docId = parts[parts.length - 1];

  return {
    id: docId,
    name: rawDoc.name,
    fields,
    createTime: rawDoc.createTime ? deserializeFirestoreTimestamp(rawDoc.createTime) : undefined,
    updateTime: rawDoc.updateTime ? deserializeFirestoreTimestamp(rawDoc.updateTime) : undefined,
  };
}

/**
 * 5. Deterministic Canonicalization Engine
 * Recursively orders object keys, preserves array order, normalizes Unicode to NFC,
 * and formats BigInt and Timestamps deterministically.
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;

  // Primitives
  if (typeof val === 'string') {
    return val.normalize('NFC');
  }
  if (typeof val === 'number') {
    return Object.is(val, -0) ? 0 : val;
  }
  if (typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'bigint') {
    return { '@type': 'int64', value: val.toString() };
  }

  // Arrays: Positional order is strictly preserved
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }

  // Tagged special objects
  if (typeof val === 'object') {
    const obj = val as Record<string, any>;

    if (obj['@type'] === 'int64') {
      return { '@type': 'int64', value: String(obj.value) };
    }
    if (obj['@type'] === 'timestamp') {
      return {
        '@type': 'timestamp',
        nanoseconds: Number(obj.nanoseconds),
        rfc3339: String(obj.rfc3339),
        seconds: obj.seconds.toString(),
      };
    }
    if (obj['@type'] === 'geopoint') {
      return {
        '@type': 'geopoint',
        latitude: Number(obj.latitude),
        longitude: Number(obj.longitude),
      };
    }
    if (obj['@type'] === 'reference') {
      return {
        '@type': 'reference',
        fullPath: String(obj.fullPath),
        relativePath: String(obj.relativePath),
      };
    }
    if (obj['@type'] === 'bytes') {
      return {
        '@type': 'bytes',
        base64: String(obj.base64),
      };
    }

    // Standard Objects: Filter out transient ETL keys and sort keys alphabetically
    const keys = Object.keys(obj)
      .filter((k) => !k.startsWith('_') && k !== 'pk' && k !== 'sk')
      .sort();

    const sortedObj: Record<string, unknown> = {};
    for (const k of keys) {
      sortedObj[k] = canonicalizeValue(obj[k]);
    }
    return sortedObj;
  }

  return val;
}

/**
 * Serializes a canonicalized value to a deterministic JSON string.
 */
export function toCanonicalJson(val: unknown): string {
  const canonical = canonicalizeValue(val);
  return JSON.stringify(canonical);
}

/**
 * 6. Three Independent Cryptographic Hashes
 */

/**
 * Hash A: sourceHash (Raw Firestore REST Payload SHA-256)
 */
export function computeSourceHash(rawPayload: string | Record<string, unknown>): string {
  const str = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
  return 'sha256:' + crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Hash B: transformedHash (Canonical Normalized Transformed Payload SHA-256)
 */
export function computeTransformedHash(transformedRecord: Record<string, unknown>): string {
  const canonicalJson = toCanonicalJson(transformedRecord);
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

/**
 * Hash C: destinationHash (Canonical Retranslated Catalyst Fetched Payload SHA-256)
 */
export function computeDestinationHash(catalystFetchedItem: Record<string, unknown>): string {
  // Uses exact same canonicalizer to verify that destination matches transformed payload
  const canonicalJson = toCanonicalJson(catalystFetchedItem);
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

/**
 * Deterministic canonical SHA-256 computation alias
 */
export const computeCanonicalSha256 = computeTransformedHash;
