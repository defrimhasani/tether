import { contentType } from "./markup";
import type { HistoryEntry, HttpResponse } from "./model";

/** What the Rust command (or the browser fallback) returns. */
export type RawResponse = Omit<HttpResponse, "body" | "bodyBase64" | "charset"> & { bodyBase64: string };

const BINARY_TYPE = /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|x-7z-compressed|vnd\.|msword|wasm)/;
const TEXT_TYPE = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv|svg/;

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function charsetOf(headers: [string, string][]) {
  const ct = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  return ct.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1].toLowerCase();
}

export function isBinary(type: string, bytes: Uint8Array) {
  if (BINARY_TYPE.test(type) && !type.includes("svg")) return true;
  if (TEXT_TYPE.test(type)) return false;
  // No useful type: NUL bytes in the first KB are a reliable sign of binary data.
  return bytes.subarray(0, 1024).includes(0);
}

export function decodeText(bytes: Uint8Array, charset?: string) {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeResponse(raw: RawResponse): HttpResponse {
  const bytes = fromBase64(raw.bodyBase64);
  const charset = charsetOf(raw.headers);
  const binary = bytes.length > 0 && isBinary(contentType(raw.headers), bytes);
  const { bodyBase64, ...rest } = raw;
  return {
    ...rest,
    body: binary ? "" : decodeText(bytes, charset),
    ...(binary ? { bodyBase64 } : {}),
    ...(charset ? { charset } : {}),
  };
}

export function isBinaryResponse(res: HttpResponse) {
  return res.bodyBase64 !== undefined && res.body === "" && res.size > 0;
}

const KEEP_TEXT = 1024 * 1024;
const KEEP_BINARY_B64 = Math.ceil((2 * 1024 * 1024 * 4) / 3);

/** Trims large bodies before history is written to disk; the in-memory entry keeps everything. */
export function compactEntry(entry: HistoryEntry): HistoryEntry {
  const r = entry.response;
  if (!r) return entry;
  if (r.body.length > KEEP_TEXT) return { ...entry, response: { ...r, body: r.body.slice(0, KEEP_TEXT), truncated: true } };
  if (r.bodyBase64 && r.bodyBase64.length > KEEP_BINARY_B64) {
    return { ...entry, response: { ...r, bodyBase64: "", truncated: true } };
  }
  return entry;
}
