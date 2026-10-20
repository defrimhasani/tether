import { describe, expect, it } from "vitest";
import { decodeValue, relativeTime } from "./decode";

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJlLW5vdC12ZXJpZmllZA`;

describe("decodeValue — detects", () => {
  it("JWTs with claims and expiry", () => {
    const d = decodeValue(jwt({ sub: "demo-user", exp: 1700003600, iat: 1700000000 }));
    expect(d).toMatchObject({ kind: "jwt", header: { alg: "HS256" }, payload: { sub: "demo-user" } });
    expect(d?.kind === "jwt" && d.expiresAt?.toISOString()).toBe("2023-11-14T23:13:20.000Z");
  });

  it("timestamps only under time-like keys", () => {
    expect(decodeValue(1700000000, "created_at")).toMatchObject({ kind: "time", source: "seconds" });
    expect(decodeValue(1700000000000, "updatedAt")).toMatchObject({ kind: "time", source: "milliseconds" });
    expect(decodeValue(1700000000, "exp")).toMatchObject({ kind: "time" });
    expect(decodeValue("1700000000", "timestamp")).toMatchObject({ kind: "time" });
  });

  it("ISO dates", () => {
    expect(decodeValue("2024-05-01T12:30:00Z")).toMatchObject({ kind: "time", source: "iso" });
    expect(decodeValue("2024-05-01")).toMatchObject({ kind: "time" });
    expect(decodeValue("2024-05-01T12:30:00.123+02:00")).toMatchObject({ kind: "time" });
  });

  it("base64 text and JSON, colors and URLs", () => {
    expect(decodeValue(btoa('{"user":"demo"}'))).toMatchObject({ kind: "base64", json: { user: "demo" } });
    expect(decodeValue(btoa("hello there, world"))).toMatchObject({ kind: "base64", text: "hello there, world" });
    expect(decodeValue("#ff9f0a")).toEqual({ kind: "color", css: "#ff9f0a" });
    expect(decodeValue("#fa0", "color")).toEqual({ kind: "color", css: "#fa0" });
    expect(decodeValue("rgb(255, 0, 128)")).toMatchObject({ kind: "color" });
    expect(decodeValue("https://httpbin.org/get?x=1")).toMatchObject({ kind: "url" });
  });
});

describe("decodeValue — stays quiet on", () => {
  it.each([
    [1700000000, "id"],
    [1700000000, "user_id"],
    [42, "created_at"],
    ["1700000000", "id"],
    ["#123", "issue"],
    ["abc", ""],
    ["demo-user", ""],
    ["example-token-0000", "token"],
    ["deadbeefdeadbeefdeadbeef", "hash"],
    ["0123456789abcdef0123", "id"],
    ["550e8400-e29b-41d4-a716-446655440000", "uuid"],
    ["Herman Melville - Moby-Dick", "title"],
    ["aaaaaaaaaaaaaaaaaaaaaaaa", ""],
    ["2024-13-45", ""],
    ["not.a.jwt", ""],
    ["ftp://example.com", ""],
    [true, "active"],
    [null, "deleted_at"],
  ])("%j (%s)", (value, key) => {
    expect(decodeValue(value, key)).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = new Date("2024-01-01T12:00:00Z");
  it("formats past and future", () => {
    expect(relativeTime(new Date("2024-01-01T12:14:00Z"), now)).toBe("in 14 min");
    expect(relativeTime(new Date("2024-01-01T10:00:00Z"), now)).toBe("2 h ago");
    expect(relativeTime(new Date("2023-12-29T12:00:00Z"), now)).toBe("3 days ago");
    expect(relativeTime(new Date("2024-01-01T12:00:02Z"), now)).toBe("just now");
  });
});
