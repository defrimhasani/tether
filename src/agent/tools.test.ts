import { describe, expect, it } from "vitest";
import { demoWorkspace, type HttpResponse } from "../model";
import { EMPTY_POLICY, setGrant } from "./policy";
import { parseSelect, resolveEnvironment, resolveRequest, selectValue, shape, shapeResponse, toolList } from "./tools";

const res = (body: string): HttpResponse => ({ status: 200, statusText: "OK", headers: [["Content-Type", "application/json"], ["X-Ignored", "yes"]], body, size: body.length, durationMs: 12 });

describe("agent tool list", () => {
  it("shows common tools and a typed tool only for grants", () => {
    const ws = demoWorkspace(); const r = ws.collections[0].requests[1];
    expect(toolList(ws, EMPTY_POLICY).map((t) => t.name)).toContain("list_requests");
    expect(toolList(ws, EMPTY_POLICY).map((t) => t.name)).not.toContain("run_fetch_profile");
    const p = setGrant(EMPTY_POLICY, r.id, "env-demo", true);
    const tool = toolList(ws, p).find((t) => t.name === "run_fetch_profile")!;
    expect(tool.description).toContain("GET");
    expect(tool.inputSchema.properties).toHaveProperty("environment");
  });
  it("resolves exact names and environments with helpful errors", () => {
    const ws = demoWorkspace();
    expect(resolveRequest(ws, "fetch profile").name).toBe("Fetch profile");
    expect(resolveEnvironment(ws, "demo")?.id).toBe("env-demo");
    expect(() => resolveRequest(ws, "nope")).toThrow("No saved request");
  });
});

describe("shape and select", () => {
  const data = { data: { items: [{ id: 1, name: "Ada" }, { id: 2, name: "Bo" }, { id: 3, name: "Cy" }], meta: { total: 3 } } };
  it("selects paths, slices and wildcards", () => {
    expect(parseSelect("data.items[0:2].name")).toHaveLength(3);
    expect(selectValue(data, "data.meta.total")).toBe(3);
    expect(selectValue(data, "data.items[1:3].name")).toEqual(["Bo", "Cy"]);
    expect(selectValue(data, "data.items[*].id")).toEqual([1, 2, 3]);
    expect(() => selectValue(data, "data..bad")).toThrow("Invalid select");
  });
  it("shapes JSON and bounds output", () => {
    expect(shape(data)).toContain("items: Array");
    const out = shapeResponse(res(JSON.stringify({ data: { items: Array.from({ length: 200 }, (_, i) => ({ id: i, text: "x".repeat(100) })) } })), { select: "data.items[0:10]", maxBytes: 300 });
    expect(out).toMatchObject({ status: 200, untrusted: true, select: "data.items[0:10]", truncated: true });
    expect(JSON.stringify(out.body).length).toBeLessThan(1000);
  });
  it("handles text and binary responses", () => {
    expect(shapeResponse({ ...res("hello"), headers: [], body: "hello" })).toMatchObject({ body: "hello" });
    expect(shapeResponse({ ...res(""), bodyBase64: "AQI=", size: 2 })).toMatchObject({ body: { type: "binary" } });
  });
});
