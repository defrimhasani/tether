import { describe, expect, it } from "vitest";
import { compactEntry, decodeResponse, fromBase64, isBinaryResponse, toBase64, type RawResponse } from "./body";

const raw = (bytes: number[] | Uint8Array, contentType?: string): RawResponse => ({
  status: 200, statusText: "OK", headers: contentType ? [["Content-Type", contentType]] : [],
  bodyBase64: toBase64(Uint8Array.from(bytes)), truncated: false, size: bytes.length, durationMs: 1,
});
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

describe("decodeResponse", () => {
  it("keeps binary bodies byte-for-byte", () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff, 0xfe];
    const res = decodeResponse(raw(png, "image/png"));
    expect(res.body).toBe("");
    expect(isBinaryResponse(res)).toBe(true);
    expect([...fromBase64(res.bodyBase64!)]).toEqual(png);
  });

  it("decodes text with the declared charset", () => {
    const latin1 = [0x63, 0x61, 0x66, 0xe9]; // "café" in ISO-8859-1
    expect(decodeResponse(raw(latin1, "text/html; charset=ISO-8859-1")).body).toBe("café");
    expect(decodeResponse(raw(utf8("café"), "text/plain")).body).toBe("café");
    expect(decodeResponse(raw(utf8("{}"), 'application/json; charset="utf-8"')).charset).toBe("utf-8");
  });

  it("falls back to UTF-8 for unknown charsets and sniffs untyped binary", () => {
    expect(decodeResponse(raw(utf8("ok"), "text/plain; charset=nope")).body).toBe("ok");
    expect(isBinaryResponse(decodeResponse(raw([1, 0, 2, 3])))).toBe(true);
    expect(isBinaryResponse(decodeResponse(raw(utf8("plain"))))).toBe(false);
    expect(decodeResponse(raw(utf8("<svg/>"), "image/svg+xml")).body).toBe("<svg/>");
  });
});

describe("compactEntry", () => {
  const entry = (response: ReturnType<typeof decodeResponse>) => ({ id: "h", requestId: "r", requestName: "R", method: "GET" as const, url: "", at: 0, response });

  it("trims large text and drops large binary before persisting", () => {
    const big = decodeResponse(raw(utf8("x".repeat(1024 * 1024 + 5)), "text/plain"));
    const t = compactEntry(entry(big)).response!;
    expect(t.body.length).toBe(1024 * 1024);
    expect(t.truncated).toBe(true);

    const bin = decodeResponse(raw(new Uint8Array(3 * 1024 * 1024), "application/octet-stream"));
    const b = compactEntry(entry(bin)).response!;
    expect(b.bodyBase64).toBe("");
    expect(b.truncated).toBe(true);
  });

  it("leaves small entries untouched", () => {
    const e = entry(decodeResponse(raw(utf8("{}"), "application/json")));
    expect(compactEntry(e)).toBe(e);
  });
});
