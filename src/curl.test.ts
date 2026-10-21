import { describe, expect, it } from "vitest";
import { parseCurl, shellWords, toCurl } from "./curl";

const ok = (s: string) => {
  const r = parseCurl(s);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("shellWords", () => {
  it("handles quotes, escapes and line continuations", () => {
    expect(shellWords(`curl -H 'A: b c' "x y" \\\n  z\\ w`)).toEqual(["curl", "-H", "A: b c", "x y", "z w"]);
    expect(shellWords(`$'a\\nb' 'it'\\''s'`)).toEqual(["a\nb", "it's"]);
  });
});

describe("parseCurl", () => {
  it("reads a JSON POST with headers", () => {
    const { request: r } = ok(`curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"Ada"}'`);
    expect(r.method).toBe("POST");
    expect(r.url).toBe("https://api.example.com/users");
    expect(r.headers).toEqual([{ key: "Content-Type", value: "application/json", enabled: true }]);
    expect(JSON.parse(r.body)).toEqual({ name: "Ada" });
    expect(r.name).toBe("POST /users");
  });

  it("infers POST from data and GET otherwise, and adds a scheme", () => {
    expect(ok("curl example.com/x -d a=1").request.method).toBe("POST");
    expect(ok("curl example.com/x").request).toMatchObject({ method: "GET", url: "http://example.com/x" });
  });

  it("turns -u into a Basic header and -G into a query string", () => {
    const { request: r } = ok("curl -u user:pass -G https://x.test/s -d q=1 -d page=2");
    expect(r.headers).toContainEqual({ key: "Authorization", value: `Basic ${btoa("user:pass")}`, enabled: true });
    expect(r.url).toBe("https://x.test/s?q=1&page=2");
    expect(r.body).toBe("");
  });

  it("supports --json, --url= and skips flags that take values", () => {
    const { request: r } = ok(`curl -sSL --max-time 5 -o out.txt --url=https://x.test/j --json '{"a":1}'`);
    expect(r.url).toBe("https://x.test/j");
    expect(r.method).toBe("POST");
    expect(r.headers.map((h) => h.key)).toEqual(["Content-Type", "Accept"]);
  });

  it("warns about unsupported pieces", () => {
    expect(ok("curl https://x.test -F file=@a.png").warnings[0]).toMatch(/Multipart/);
    expect(ok("curl https://x.test -d @body.json").warnings[0]).toMatch(/file/);
  });

  it("rejects non-curl input", () => {
    expect(parseCurl("wget x")).toHaveProperty("error");
    expect(parseCurl("curl -X POST")).toHaveProperty("error");
  });
});

describe("toCurl", () => {
  const base = { method: "POST" as const, url: "https://x.test/a", headers: [{ key: "A", value: "b'c", enabled: true }, { key: "Off", value: "x", enabled: false }], body: '{"k":1}' };
  it("quotes safely and skips disabled headers", () => {
    expect(toCurl(base)).toBe(`curl -X POST 'https://x.test/a' \\\n  -H 'A: b'\\''c' \\\n  --data-raw '{"k":1}'`);
  });
  it("omits -X for GET and uses --head for HEAD", () => {
    expect(toCurl({ ...base, method: "GET", body: "" })).toContain("curl 'https://x.test/a'");
    expect(toCurl({ ...base, method: "HEAD", body: "" })).toMatch(/^curl --head /);
  });
  it("round-trips through parseCurl", () => {
    const back = ok(toCurl(base)).request;
    expect(back.method).toBe("POST");
    expect(back.headers[0]).toMatchObject({ key: "A", value: "b'c" });
    expect(JSON.parse(back.body)).toEqual({ k: 1 });
  });
  it("resolves variables through the callback", () => {
    expect(toCurl({ ...base, url: "{{base}}/a" }, (s) => s.replace("{{base}}", "https://h"))).toContain("'https://h/a'");
  });
});
