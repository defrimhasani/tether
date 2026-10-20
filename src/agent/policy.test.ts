import { describe, expect, it } from "vitest";
import { demoWorkspace } from "../model";
import { EMPTY_POLICY, allowed, dependencies, enabledRequests, inputsFor, isWrite, setGrant, toolName } from "./policy";
import { applyInputs, redact, redactHeaders, resolveWithInputs, validateInputs } from "./safety";

const ws = () => demoWorkspace();

describe("agent grants", () => {
  it("grants per request and environment and revokes cleanly", () => {
    const w = ws(); const r = w.collections[0].requests[0];
    let p = setGrant(EMPTY_POLICY, r.id, "env-demo", true);
    expect(allowed(p, r, "env-demo")).toBe(true);
    expect(enabledRequests(w, p).map((x) => x.request.id)).toEqual([r.id]);
    p = setGrant(p, r.id, "env-demo", false);
    expect(p.grants).toEqual([]);
  });
  it("finds only unknown variables and request dependencies", () => {
    const w = ws(); const [login, profile] = w.collections[0].requests;
    expect(inputsFor(w, profile, "env-demo")).toEqual([]);
    profile.url += "?page={{page}}";
    expect(inputsFor(w, profile, "env-demo")).toEqual(["page"]);
    expect(dependencies(w, profile)).toEqual([login]);
  });
  it("names tools uniquely and flags writes", () => {
    const w = ws(); const [a, , c] = w.collections[0].requests;
    expect(toolName(a, w.collections[0].requests)).toBe("run_create_session");
    expect(isWrite(a)).toBe(true); expect(isWrite(c)).toBe(false);
    const other = { ...a, id: "other" }; w.collections[0].requests.push(other);
    expect(toolName(a, w.collections[0].requests)).toBe(`run_create_session_${a.id}`);
  });
});

describe("agent input safety", () => {
  const request = { id: "r", name: "R", method: "GET" as const, url: "https://api.example.com/users/{{id}}?q={{query}}", headers: [{ key: "X-Search", value: "{{query}}", enabled: true }], body: "{\"id\": {{id}}}" };
  it("accepts only declared scalar input with no controls", () => {
    expect(validateInputs(request, { id: 7, query: "Ada" }, ["id", "query"])).toEqual([]);
    expect(validateInputs(request, { nope: "x" }, ["id"])[0].reason).toContain("not an input");
    expect(validateInputs(request, { id: { x: 1 } }, ["id"])[0].reason).toContain("string, number or boolean");
    expect(validateInputs(request, { id: "a\r\nX-Evil: yes" }, ["id"])[0].reason).toContain("newline");
  });
  it("refuses input in URL authority but allows a saved path hole", () => {
    const host = { ...request, url: "https://{{tenant}}.example.com/users/{{id}}" };
    expect(validateInputs(host, { tenant: "evil", id: "7" }, ["tenant", "id"])).toMatchObject([{ variable: "tenant" }]);
    const path = { ...request, url: "https://api.example.com/{{tenant}}/users/{{id}}" };
    expect(validateInputs(path, { tenant: "acme", id: "7" }, ["tenant", "id"])).toEqual([]);
  });
  it("only substitutes holes that already exist", () => {
    const out = resolveWithInputs(request, { id: 7, query: "a&b", ignored: "no" });
    expect(out.url).toBe("https://api.example.com/users/7?q=a&b");
    expect(out.headers[0].value).toBe("a&b");
    expect(out.body).toBe('{"id": 7}');
    expect(applyInputs("x={{unknown}}", { id: 1 })).toBe("x={{unknown}}");
  });
  it("redacts values and sensitive headers", () => {
    expect(redact("Bearer abcdef and abc", ["abcdef", "abc"])).toBe("Bearer [secret] and abc");
    expect(redactHeaders([["Authorization", "Bearer real"], ["X", "real"]], ["real"])).toEqual([["Authorization", "[secret]"], ["X", "[secret]"]]);
  });
});
