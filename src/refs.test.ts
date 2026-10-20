import { describe, expect, it } from "vitest";
import { demoWorkspace, type HttpResponse, type Workspace } from "./model";
import { downstreamUses, getPath, interpolate, renameReferences, resolveToken, tokensIn, uniqueName } from "./refs";

const response = (body: string, extra: Partial<HttpResponse> = {}): HttpResponse => ({
  status: 200, statusText: "OK", headers: [["ETag", "abc"]], body, size: body.length, durationMs: 1, ...extra,
});

function withResponse(ws: Workspace, body: string, extra?: Partial<HttpResponse>): Workspace {
  const src = ws.collections[0].requests[0];
  return {
    ...ws,
    history: [{ id: "h1", requestId: src.id, requestName: src.name, method: src.method, url: "", at: 0, response: response(body, extra) }],
  };
}

describe("getPath", () => {
  it("walks objects and arrays", () => {
    expect(getPath({ a: [{ b: 1 }] }, ["a", "0", "b"])).toBe(1);
    expect(getPath({ a: null }, ["a", "b"])).toBeUndefined();
  });
});

describe("resolveToken", () => {
  it("resolves environment variables", () => {
    const r = resolveToken(demoWorkspace(), "base_url");
    expect(r).toMatchObject({ ok: true, kind: "env", value: "https://httpbin.org" });
  });

  it("resolves secrets and reports them as secrets", () => {
    const ws = demoWorkspace();
    ws.environments[0].secrets = [{ key: "api_key", value: "s3cret", enabled: true }];
    expect(resolveToken(ws, "api_key")).toMatchObject({ ok: true, kind: "secret", value: "s3cret" });
  });

  it("ignores disabled variables", () => {
    const ws = demoWorkspace();
    ws.environments[0].vars[0].enabled = false;
    expect(resolveToken(ws, "base_url").ok).toBe(false);
  });

  it("explains a missing environment", () => {
    const ws = { ...demoWorkspace(), activeEnvId: null };
    expect(resolveToken(ws, "base_url")).toMatchObject({ ok: false, reason: "No environment is selected." });
  });

  it("asks to send the source request when it has no response", () => {
    const ws = demoWorkspace();
    const r = resolveToken(ws, "@create_session.body.json.token");
    expect(r).toMatchObject({ ok: false, fix: { requestId: ws.collections[0].requests[0].id } });
  });

  it("reads status, headers (case-insensitive) and JSON body paths", () => {
    const ws = withResponse(demoWorkspace(), '{"json":{"token":"t1","n":[5]}}', { status: 201 });
    expect(resolveToken(ws, "@create_session.status")).toMatchObject({ ok: true, value: "201" });
    expect(resolveToken(ws, "@create_session.headers.etag")).toMatchObject({ ok: true, value: "abc" });
    expect(resolveToken(ws, "@create_session.body.json.token")).toMatchObject({ ok: true, value: "t1" });
    expect(resolveToken(ws, "@create_session.body.json.n")).toMatchObject({ ok: true, value: "[5]" });
  });

  it("reports missing paths, non-JSON bodies and unknown requests", () => {
    expect(resolveToken(withResponse(demoWorkspace(), "{}"), "@create_session.body.nope").ok).toBe(false);
    expect(resolveToken(withResponse(demoWorkspace(), "<html>"), "@create_session.body.a")).toMatchObject({ ok: false, reason: expect.stringContaining("JSON") });
    expect(resolveToken(demoWorkspace(), "@ghost.status")).toMatchObject({ ok: false, reason: expect.stringContaining("ghost") });
  });
});

describe("interpolate", () => {
  it("replaces resolved tokens and lists unresolved ones", () => {
    const { out, unresolved } = interpolate(demoWorkspace(), "{{base_url}}/x/{{ missing }}");
    expect(out).toBe("https://httpbin.org/x/{{missing}}");
    expect(unresolved).toEqual(["missing"]);
  });
});

describe("tokensIn / downstreamUses", () => {
  it("collects tokens from URL, headers and body, skipping disabled headers", () => {
    const ws = demoWorkspace();
    const profile = ws.collections[0].requests[1];
    expect(tokensIn(profile).sort()).toEqual(["@create_session.body.json.token", "@create_session.body.json.user", "base_url"]);
    profile.headers[0].enabled = false;
    expect(tokensIn(profile)).not.toContain("@create_session.body.json.token");
  });

  it("finds requests that use a token", () => {
    const uses = downstreamUses(demoWorkspace(), "@create_session.body.json.user");
    expect(uses.map((u) => u.request.name)).toEqual(["Fetch profile"]);
  });
});

describe("renameReferences", () => {
  it("rewrites references to the renamed request only", () => {
    const ws = demoWorkspace();
    const profile = { ...ws.collections[0].requests[1], body: "{{@create_session_old.status}} {{ @create_session.status }}" };
    const out = renameReferences(profile, "create_session", "login");
    expect(out.url).toBe("{{base_url}}/get?user={{@login.body.json.user}}");
    expect(out.headers[0].value).toBe("Bearer {{@login.body.json.token}}");
    expect(out.body).toBe("{{@create_session_old.status}} {{ @login.status }}");
  });
});

describe("uniqueName", () => {
  it("suffixes names whose slug collides with another request", () => {
    const ws = demoWorkspace();
    const [login, profile] = ws.collections[0].requests;
    expect(uniqueName(ws, "Create Session!", profile.id)).toBe("Create Session! 2");
    expect(uniqueName(ws, "Create session", login.id)).toBe("Create session");
  });
});
