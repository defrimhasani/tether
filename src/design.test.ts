import { describe, expect, it } from "vitest";
import {
  addOperation, addProperty, blankSpec, deleteOperation, deleteSchema, exampleSpec, generateRequests, getIn, kindOf, listOperations,
  mockRoutes, moveOperation, newDesign, parseSpec, removeProperty, renameProperty, renameSchema, schemaUsage, setIn, setRequired, stringifySpec, validateSpec, withKind,
} from "./design";
import { demoWorkspace } from "./model";

const todo = () => parseSpec(exampleSpec()).doc;

describe("spec text", () => {
  it("round-trips YAML and reports errors with a line", () => {
    const doc = todo();
    expect(parseSpec(stringifySpec(doc)).doc).toEqual(doc);
    const bad = parseSpec("openapi: 3.0.3\ninfo: [unclosed");
    expect(bad.error).toMatch(/^Line \d+:/);
    expect(parseSpec("- a\n- b").error).toMatch(/object/);
    expect(parseSpec("").doc).toEqual({});
  });
});

describe("setIn", () => {
  it("is immutable, creates parents and deletes on undefined", () => {
    const a = { x: { y: 1 }, list: [1, 2, 3] };
    const b = setIn(a, ["x", "z", "w"], 5);
    expect(a.x).toEqual({ y: 1 });
    expect(getIn(b, ["x", "z", "w"])).toBe(5);
    expect(setIn(a, ["x", "y"], undefined)).toEqual({ x: {}, list: [1, 2, 3] });
    expect(setIn(a, ["list", 1], undefined).list).toEqual([1, 3]);
  });
});

describe("operations", () => {
  it("adds an operation with its path parameters declared", () => {
    const doc = addOperation(blankDoc(), "get", "/pets/{petId}/toys/{toyId}");
    const params = getIn(doc, ["paths", "/pets/{petId}/toys/{toyId}", "get", "parameters"]) as { name: string; in: string; required: boolean }[];
    expect(params.map((p) => [p.name, p.in, p.required])).toEqual([["petId", "path", true], ["toyId", "path", true]]);
    expect(validateSpec(doc).filter((i) => i.level === "error")).toEqual([]);
  });

  it("moves an operation and declares newly introduced path parameters", () => {
    let doc = addOperation(blankDoc(), "get", "/pets");
    doc = moveOperation(doc, { method: "get", path: "/pets" }, { method: "post", path: "/pets/{id}" });
    expect(listOperations(doc).map((o) => `${o.method} ${o.path}`)).toEqual(["post /pets/{id}"]);
    expect(validateSpec(doc).some((i) => /not|isn’t declared/.test(i.message))).toBe(false);
  });

  it("deletes an operation and removes an emptied path", () => {
    const doc = deleteOperation(addOperation(blankDoc(), "get", "/a"), "get", "/a");
    expect(doc.paths).toEqual({});
  });
});

describe("schemas", () => {
  it("renames a schema everywhere it is referenced, and falls back to object when deleted", () => {
    const doc = todo();
    expect(schemaUsage(doc, "Todo")).toBe(3);
    const renamed = renameSchema(doc, "Todo", "Task");
    expect(JSON.stringify(renamed)).not.toContain("schemas/Todo\"");
    expect(JSON.stringify(renamed)).toContain("schemas/Task");
    expect(validateSpec(renamed).filter((i) => i.level === "error")).toEqual([]);
    const gone = deleteSchema(doc, "NewTodo");
    expect(JSON.stringify(gone)).not.toContain("NewTodo");
    expect(validateSpec(gone).filter((i) => i.level === "error")).toEqual([]);
  });

  it("edits properties and the required list", () => {
    let s = addProperty({ type: "object", properties: {} }, "name");
    s = setRequired(addProperty(s, "age", "integer"), "name", true);
    expect(s).toMatchObject({ required: ["name"], properties: { name: { type: "string" }, age: { type: "integer" } } });
    s = renameProperty(s, "name", "title");
    expect(s.required).toEqual(["title"]);
    s = removeProperty(s, "title");
    expect(s.required).toBeUndefined();
    expect(Object.keys(s.properties as object)).toEqual(["age"]);
  });

  it("changes kinds while keeping the description", () => {
    expect(kindOf({ $ref: "#/components/schemas/A" })).toBe("ref");
    expect(withKind({ type: "string", description: "d" }, "array")).toEqual({ type: "array", items: { type: "string" }, description: "d" });
    expect(withKind(null, "ref", "Pet")).toEqual({ $ref: "#/components/schemas/Pet" });
  });
});

describe("validateSpec", () => {
  it("accepts the example", () => {
    expect(validateSpec(todo())).toEqual([]);
  });

  it("finds the common mistakes", () => {
    const msgs = (d: object) => validateSpec(d as never).map((i) => i.message);
    expect(msgs({ openapi: "2.0", info: {}, paths: {} })).toEqual(expect.arrayContaining([expect.stringMatching(/3\.x/), expect.stringMatching(/title/), expect.stringMatching(/version/)]));
    expect(msgs({ openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/a/{id}": { get: { responses: { "200": { description: "ok" } } } } } })).toEqual([expect.stringMatching(/\{id\} isn’t declared/)]);
    expect(msgs({ openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/a": { get: { responses: {} } } } })).toEqual([expect.stringMatching(/at least one response/)]);
    const dup = { openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/a": { get: { operationId: "x", responses: { "200": {} } }, post: { operationId: "x", responses: { "200": {} } } } } };
    expect(msgs(dup)).toEqual([expect.stringMatching(/already used/)]);
    const ref = { openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/a": { get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Nope" } } } } } } } } };
    expect(msgs(ref)).toEqual([expect.stringMatching(/Unknown schema Nope/)]);
    expect(msgs({ ...todo(), components: { schemas: { A: { type: "object", required: ["z"], properties: {} }, B: { type: "array" } } } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/required property “z”/), expect.stringMatching(/items/)]),
    );
  });
});

describe("mockRoutes", () => {
  it("serves examples from schemas, picks the success status and prefixes the server path", () => {
    const doc = setIn(todo(), ["servers", 0, "url"], "https://api.test/v1");
    const routes = mockRoutes(doc);
    const get = routes.find((r) => r.method === "GET" && r.pattern === "/v1/todos/{id}")!;
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body)).toEqual({ id: "t_1", title: "Write the spec", done: false });
    expect(get.headers).toEqual([["content-type", "application/json"]]);
    expect(routes.find((r) => r.method === "POST")!.status).toBe(201);
    const del = routes.find((r) => r.method === "DELETE")!;
    expect(del).toMatchObject({ status: 204, body: "" });
    expect(JSON.parse(routes.find((r) => r.method === "GET" && r.pattern === "/v1/todos")!.body)).toEqual([{ id: "t_1", title: "Write the spec", done: false }]);
  });
});

describe("generateRequests", () => {
  it("creates a collection and two environments, then only adds what is missing", () => {
    const ws = demoWorkspace();
    const design = newDesign("Todo API", exampleSpec());
    const first = generateRequests(ws, design, "http://127.0.0.1:4010");
    expect(first.added).toBe(4);
    expect(first.environments).toEqual(["Todo API (server)", "Todo API (mock)"]);
    const col = first.ws.collections.find((c) => c.id === first.collectionId)!;
    expect(col.requests.map((r) => r.name)).toEqual(["List todos", "Create a todo", "Get a todo", "Delete a todo"]);
    expect(first.ws.environments.find((e) => e.name === "Todo API (mock)")!.vars[0].value).toBe("http://127.0.0.1:4010");

    const withMore = { ...design, collectionId: first.collectionId, spec: stringifySpec(addOperation(parseSpec(design.spec).doc, "get", "/health")) };
    const second = generateRequests(first.ws, withMore, "http://127.0.0.1:4010");
    expect(second.added).toBe(1);
    expect(second.environments).toEqual([]);
    expect(second.ws.collections.find((c) => c.id === first.collectionId)!.requests).toHaveLength(5);

    const again = generateRequests(second.ws, withMore, "http://127.0.0.1:4010");
    expect(again.added).toBe(0);
  });

  it("refuses a spec it cannot read", () => {
    expect(() => generateRequests(demoWorkspace(), newDesign("x", "info: ["), "http://127.0.0.1:4010")).toThrow();
  });
});

function blankDoc() {
  return parseSpec(blankSpec("Pets")).doc;
}
