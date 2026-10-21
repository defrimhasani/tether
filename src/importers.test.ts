import { describe, expect, it } from "vitest";
import { detectAndParse, mergeImport, type ImportResult } from "./importers";
import { demoWorkspace } from "./model";

const ok = (text: string) => {
  const r = detectAndParse(text);
  if ("error" in r) throw new Error(r.error);
  return r;
};

const postman = {
  info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "host", value: "https://shop.test" }],
  item: [
    { name: "List", request: { method: "GET", url: { raw: "{{host}}/items?limit=5" }, header: [{ key: "Accept", value: "application/json" }] } },
    { name: "Admin", item: [
      { name: "Create", request: { method: "POST", url: "{{host}}/items", header: [], body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } }, auth: { type: "bearer", bearer: [{ key: "token", value: "{{tok}}" }] } } },
      { name: "More", item: [{ name: "Form", request: { method: "POST", url: "{{host}}/f", body: { mode: "formdata", formdata: [] } } }] },
    ] },
  ],
};

describe("detectAndParse", () => {
  it("imports a cURL command", () => {
    const r = ok("curl https://x.test/a -H 'X: 1'");
    expect(r.source).toBe("cURL command");
    expect(r.collections[0].requests[0]).toMatchObject({ method: "GET", url: "https://x.test/a" });
  });

  it("imports Postman folders, auth, variables and warns about form-data", () => {
    const r = ok(JSON.stringify(postman));
    expect(r.collections.map((c) => c.name)).toEqual(["Shop", "Admin"]);
    const admin = r.collections[1].requests;
    expect(admin.map((x) => x.name)).toEqual(["Create", "More / Form"]);
    expect(admin[0].headers).toContainEqual({ key: "Authorization", value: "Bearer {{tok}}", enabled: true });
    expect(admin[0].headers).toContainEqual({ key: "Content-Type", value: "application/json", enabled: true });
    expect(r.environments[0].vars).toEqual([{ key: "host", value: "https://shop.test", enabled: true }]);
    expect(r.warnings.some((w) => /formdata/.test(w))).toBe(true);
  });

  it("imports a Postman environment, keeping secrets apart", () => {
    const r = ok(JSON.stringify({ name: "Prod", values: [{ key: "a", value: "1", enabled: true }, { key: "k", value: "s", type: "secret" }], _postman_variable_scope: "environment" }));
    expect(r.environments[0]).toMatchObject({ name: "Prod", vars: [{ key: "a" }], secrets: [{ key: "k", value: "s" }] });
  });

  it("imports an Insomnia export and rewrites its templates", () => {
    const r = ok(JSON.stringify({ _type: "export", resources: [
      { _id: "w", _type: "workspace", name: "Acme" },
      { _id: "f", _type: "request_group", name: "Users", parentId: "w" },
      { _id: "r1", _type: "request", name: "Get", method: "GET", url: "{{ _.base }}/u", parentId: "f", headers: [{ name: "X", value: "{{ _.k }}" }] },
      { _id: "e", _type: "environment", name: "Base", data: { base: "https://a.test" }, parentId: "w" },
    ] }));
    expect(r.collections[0]).toMatchObject({ name: "Users" });
    expect(r.collections[0].requests[0]).toMatchObject({ url: "{{base}}/u", headers: [{ key: "X", value: "{{k}}" }] });
    expect(r.environments[0].vars).toEqual([{ key: "base", value: "https://a.test", enabled: true }]);
  });

  it("imports OpenAPI YAML with params, body samples and a base_url variable", () => {
    const r = ok(`
openapi: 3.0.0
info: { title: Pets }
servers: [{ url: https://pets.test/v1/ }]
components:
  schemas:
    Pet: { type: object, properties: { name: { type: string }, age: { type: integer } } }
paths:
  /pets/{id}:
    get:
      tags: [pets]
      summary: Get pet
      parameters:
        - { name: id, in: path, required: true }
        - { name: expand, in: query, required: true }
    put:
      tags: [pets]
      operationId: updatePet
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Pet' }
`);
    expect(r.collections[0].name).toBe("pets");
    const [get, put] = r.collections[0].requests;
    expect(get).toMatchObject({ name: "Get pet", url: "{{base_url}}/pets/{{id}}?expand={{expand}}" });
    expect(put.name).toBe("updatePet");
    expect(JSON.parse(put.body)).toEqual({ name: "string", age: 0 });
    expect(r.environments[0].vars).toEqual([{ key: "base_url", value: "https://pets.test/v1", enabled: true }]);
  });

  it("explains what it cannot read", () => {
    expect(detectAndParse("")).toHaveProperty("error");
    expect(detectAndParse('{"hello":1}')).toHaveProperty("error");
    expect(detectAndParse("just words")).toHaveProperty("error");
  });
});

describe("mergeImport", () => {
  const imported = (): ImportResult => ok(JSON.stringify(postman));

  it("adds collections and environments without clobbering names", () => {
    const ws = demoWorkspace();
    const { ws: out, firstRequestId } = mergeImport(ws, imported());
    expect(out.collections).toHaveLength(ws.collections.length + 2);
    expect(out.environments).toHaveLength(ws.environments.length + 1);
    expect(out.activeEnvId).toBe(out.environments.at(-1)?.id);
    expect(firstRequestId).toBeTruthy();
  });

  it("keeps request names unique so references stay unambiguous", () => {
    const once = mergeImport(demoWorkspace(), imported()).ws;
    const twice = mergeImport(once, imported()).ws;
    const names = twice.collections.flatMap((c) => c.requests.map((r) => r.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
    expect(twice.collections.map((c) => c.name)).toContain("Shop 2");
  });

  it("can drop a single imported request into an existing collection", () => {
    const ws = demoWorkspace();
    const target = ws.collections[0];
    const { ws: out } = mergeImport(ws, ok("curl https://x.test/a"), target.id);
    expect(out.collections).toHaveLength(1);
    expect(out.collections[0].requests).toHaveLength(target.requests.length + 1);
  });

  it("leaves the active environment alone when nothing was imported into it", () => {
    const ws = demoWorkspace();
    expect(mergeImport(ws, ok("curl https://x.test/a")).ws.activeEnvId).toBe(ws.activeEnvId);
  });
});
