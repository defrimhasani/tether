import { parse, stringify } from "yaml";
import { deref, importOpenApi, mergeImport, sample } from "./importers";
import { uid, type ApiDesign, type Environment, type Workspace } from "./model";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export const OPS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
export type OpMethod = (typeof OPS)[number];
export const SCHEMA_REF = "#/components/schemas/";

/* ——— Text <-> document ——— */

export function parseSpec(text: string): { doc: Obj; error?: string } {
  try {
    const v = parse(text, { prettyErrors: true });
    if (v === null || v === undefined) return { doc: {} };
    if (!isObj(v)) return { doc: {}, error: "The spec must be a YAML or JSON object." };
    return { doc: v };
  } catch (e) {
    const err = e as { message?: string; linePos?: { line: number }[] };
    const line = err.linePos?.[0]?.line;
    return { doc: {}, error: `${line ? `Line ${line}: ` : ""}${(err.message ?? "Invalid YAML").split("\n")[0]}` };
  }
}

export const stringifySpec = (doc: Obj) => stringify(doc, { lineWidth: 0, indent: 2 });

/* ——— Immutable path helpers ——— */

export function getIn(node: unknown, path: (string | number)[]): unknown {
  let cur = node;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/** Returns a copy of `node` with `path` set to `value`; `undefined` removes the key. */
export function setIn<T>(node: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  if (Array.isArray(node)) {
    const next = [...node];
    const i = k as number;
    const v = setIn(next[i], rest, value);
    if (v === undefined) next.splice(i, 1);
    else next[i] = v;
    return next as T;
  }
  const base: Obj = isObj(node) ? node : {};
  const v = setIn(base[k as string], rest, value);
  const next: Obj = { ...base };
  if (v === undefined) delete next[k as string];
  else next[k as string] = v;
  return next as T;
}

/* ——— Starters ——— */

export function blankSpec(title: string): string {
  return stringifySpec({
    openapi: "3.0.3",
    info: { title, version: "1.0.0", description: "" },
    servers: [{ url: "http://localhost:4010" }],
    paths: {},
    components: { schemas: {} },
  });
}

export function exampleSpec(): string {
  return stringifySpec({
    openapi: "3.0.3",
    info: { title: "Todo API", version: "1.0.0", description: "A small API for keeping a to-do list." },
    servers: [{ url: "http://localhost:4010" }],
    tags: [{ name: "todos" }],
    paths: {
      "/todos": {
        get: {
          tags: ["todos"], summary: "List todos", operationId: "listTodos",
          parameters: [{ name: "done", in: "query", required: false, schema: { type: "boolean" } }],
          responses: { "200": { description: "All todos", content: { "application/json": { schema: { type: "array", items: { $ref: `${SCHEMA_REF}Todo` } } } } } },
        },
        post: {
          tags: ["todos"], summary: "Create a todo", operationId: "createTodo",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: `${SCHEMA_REF}NewTodo` } } } },
          responses: { "201": { description: "Created", content: { "application/json": { schema: { $ref: `${SCHEMA_REF}Todo` } } } }, "422": { description: "Validation failed" } },
        },
      },
      "/todos/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { tags: ["todos"], summary: "Get a todo", operationId: "getTodo", responses: { "200": { description: "The todo", content: { "application/json": { schema: { $ref: `${SCHEMA_REF}Todo` } } } }, "404": { description: "Not found" } } },
        delete: { tags: ["todos"], summary: "Delete a todo", operationId: "deleteTodo", responses: { "204": { description: "Deleted" } } },
      },
    },
    components: {
      schemas: {
        NewTodo: { type: "object", required: ["title"], properties: { title: { type: "string", example: "Write the spec" }, done: { type: "boolean", example: false } } },
        Todo: { type: "object", required: ["id", "title"], properties: { id: { type: "string", example: "t_1" }, title: { type: "string", example: "Write the spec" }, done: { type: "boolean", example: false } } },
      },
    },
  });
}

/* ——— Operations ——— */

export type Op = { method: OpMethod; path: string; op: Obj };

export function listOperations(doc: Obj): Op[] {
  const out: Op[] = [];
  for (const [path, item] of Object.entries(obj(doc.paths))) {
    for (const method of OPS) if (isObj(obj(item)[method])) out.push({ method, path, op: obj(item)[method] as Obj });
  }
  return out;
}

export const pathParams = (path: string) => [...path.matchAll(/\{([^}/]+)\}/g)].map((m) => m[1]);

const paramNode = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });

/** Adds any `{param}` in `path` that the operation doesn't declare yet. */
function withPathParams(op: Obj, path: string, itemParams: unknown[]): Obj {
  const declared = new Set([...arr(op.parameters), ...itemParams].filter(isObj).filter((p) => p.in === "path").map((p) => str(p.name)));
  const missing = pathParams(path).filter((n) => !declared.has(n));
  return missing.length ? { ...op, parameters: [...arr(op.parameters), ...missing.map(paramNode)] } : op;
}

export function addOperation(doc: Obj, method: OpMethod, path: string): Obj {
  const p = path.startsWith("/") ? path : `/${path}`;
  const item = obj(obj(doc.paths)[p]);
  const op = withPathParams({ summary: "", responses: { "200": { description: "OK" } } }, p, arr(item.parameters));
  return setIn(doc, ["paths", p], { ...item, [method]: op });
}

export function deleteOperation(doc: Obj, method: OpMethod, path: string): Obj {
  const item = { ...obj(obj(doc.paths)[path]) };
  delete item[method];
  const left = OPS.some((m) => isObj(item[m]));
  return setIn(doc, ["paths", path], left ? item : undefined);
}

/** Moves an operation to another method and/or path, keeping its content. */
export function moveOperation(doc: Obj, from: { method: OpMethod; path: string }, to: { method: OpMethod; path: string }): Obj {
  if (from.method === to.method && from.path === to.path) return doc;
  const op = obj(obj(obj(doc.paths)[from.path])[from.method]);
  const next = deleteOperation(doc, from.method, from.path);
  const target = to.path.startsWith("/") ? to.path : `/${to.path}`;
  const item = obj(obj(next.paths)[target]);
  return setIn(next, ["paths", target], { ...item, [to.method]: withPathParams(op, target, arr(item.parameters)) });
}

/* ——— Schemas ——— */

export const schemaNames = (doc: Obj) => Object.keys(obj(obj(doc.components).schemas));

function mapRefs(node: unknown, from: string, to: string | null): unknown {
  if (Array.isArray(node)) return node.map((x) => mapRefs(x, from, to));
  if (!isObj(node)) return node;
  if (node.$ref === `${SCHEMA_REF}${from}`) return to ? { ...node, $ref: `${SCHEMA_REF}${to}` } : { type: "object" };
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, mapRefs(v, from, to)]));
}

export function addSchema(doc: Obj, name: string, schema: Obj = { type: "object", properties: {} }): Obj {
  return setIn(doc, ["components", "schemas", name], schema);
}

export function renameSchema(doc: Obj, from: string, to: string): Obj {
  if (from === to) return doc;
  const schemas = obj(obj(doc.components).schemas);
  const renamed = Object.fromEntries(Object.entries(schemas).map(([k, v]) => [k === from ? to : k, v]));
  return mapRefs(setIn(doc, ["components", "schemas"], renamed), from, to) as Obj;
}

/** Removes a schema; places that referenced it fall back to a plain object. */
export function deleteSchema(doc: Obj, name: string): Obj {
  return mapRefs(setIn(doc, ["components", "schemas", name], undefined), name, null) as Obj;
}

export function schemaUsage(doc: Obj, name: string): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObj(x)) { if (x.$ref === `${SCHEMA_REF}${name}`) n++; Object.values(x).forEach(walk); }
  };
  walk({ ...doc, components: { ...obj(doc.components), schemas: Object.fromEntries(Object.entries(obj(obj(doc.components).schemas)).filter(([k]) => k !== name)) } });
  return n;
}

export type Kind = "string" | "integer" | "number" | "boolean" | "array" | "object" | "ref";
export const KINDS: Kind[] = ["string", "integer", "number", "boolean", "array", "object", "ref"];

export function kindOf(node: unknown): Kind {
  const n = obj(node);
  if (typeof n.$ref === "string") return "ref";
  if (n.type === "array") return "array";
  if (n.type === "integer" || n.type === "number" || n.type === "boolean" || n.type === "string") return n.type;
  return "object";
}

export const refName = (node: unknown) => str(obj(node).$ref).replace(SCHEMA_REF, "");

/** A fresh schema node of the given kind, keeping the description if there was one. */
export function withKind(node: unknown, kind: Kind, ref = ""): Obj {
  const description = str(obj(node).description);
  const base: Obj = kind === "ref" ? { $ref: `${SCHEMA_REF}${ref}` } : kind === "object" ? { type: "object", properties: {} } : kind === "array" ? { type: "array", items: { type: "string" } } : { type: kind };
  return description && kind !== "ref" ? { ...base, description } : base;
}

export function addProperty(node: Obj, name: string, kind: Kind = "string"): Obj {
  return { ...node, type: "object", properties: { ...obj(node.properties), [name]: withKind(null, kind) } };
}

export function renameProperty(node: Obj, from: string, to: string): Obj {
  if (from === to) return node;
  const props = Object.fromEntries(Object.entries(obj(node.properties)).map(([k, v]) => [k === from ? to : k, v]));
  const required = arr(node.required).map((r) => (r === from ? to : r));
  return { ...node, properties: props, ...(required.length ? { required } : {}) };
}

export function removeProperty(node: Obj, name: string): Obj {
  const props = { ...obj(node.properties) };
  delete props[name];
  const required = arr(node.required).filter((r) => r !== name);
  const next: Obj = { ...node, properties: props };
  if (required.length) next.required = required; else delete next.required;
  return next;
}

export function setRequired(node: Obj, name: string, on: boolean): Obj {
  const rest = arr(node.required).filter((r) => r !== name);
  const required = on ? [...rest, name] : rest;
  const next: Obj = { ...node };
  if (required.length) next.required = required; else delete next.required;
  return next;
}

/* ——— Validation ——— */

export type Where = { kind: "info" } | { kind: "op"; method: OpMethod; path: string } | { kind: "schema"; name: string };
export type Issue = { level: "error" | "warning"; message: string; where: Where };

export function validateSpec(doc: Obj): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], message: string, where: Where) => issues.push({ level, message, where });
  const info = obj(doc.info);
  if (!/^3\.\d/.test(str(doc.openapi))) add("error", "Set openapi to a 3.x version, for example 3.0.3.", { kind: "info" });
  if (!str(info.title).trim()) add("error", "The API needs a title.", { kind: "info" });
  if (!str(info.version).trim()) add("error", "The API needs a version.", { kind: "info" });

  const names = new Set(schemaNames(doc));
  const checkRefs = (x: unknown, where: Where) => {
    if (Array.isArray(x)) x.forEach((y) => checkRefs(y, where));
    else if (isObj(x)) {
      if (typeof x.$ref === "string" && x.$ref.startsWith(SCHEMA_REF) && !names.has(x.$ref.slice(SCHEMA_REF.length))) add("error", `Unknown schema ${x.$ref.slice(SCHEMA_REF.length)}.`, where);
      Object.values(x).forEach((y) => checkRefs(y, where));
    }
  };

  const ids = new Map<string, string>();
  for (const [path, item] of Object.entries(obj(doc.paths))) {
    if (!path.startsWith("/")) add("error", `Path “${path}” must start with /.`, { kind: "info" });
    const itemParams = arr(obj(item).parameters);
    for (const method of OPS) {
      const op = obj(item)[method];
      if (!isObj(op)) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const where: Where = { kind: "op", method, path };
      const params = [...itemParams, ...arr(op.parameters)].map((p) => deref(doc, p)).filter(isObj);
      const declared = new Set(params.filter((p) => p.in === "path").map((p) => str(p.name)));
      for (const n of pathParams(path)) if (!declared.has(n)) add("error", `${label}: path parameter {${n}} isn’t declared.`, where);
      for (const p of params.filter((p) => p.in === "path")) {
        if (!pathParams(path).includes(str(p.name))) add("warning", `${label}: parameter ${str(p.name)} isn’t part of the path.`, where);
        if (p.required !== true) add("error", `${label}: path parameter ${str(p.name)} must be required.`, where);
      }
      const responses = obj(op.responses);
      if (!Object.keys(responses).length) add("error", `${label}: add at least one response.`, where);
      else if (!Object.keys(responses).some((c) => c.startsWith("2") || c === "default")) add("warning", `${label}: no success (2xx) response.`, where);
      const id = str(op.operationId);
      if (id) {
        if (ids.has(id)) add("error", `${label}: operationId “${id}” is already used by ${ids.get(id)}.`, where);
        else ids.set(id, label);
      }
      checkRefs(op, where);
    }
  }
  for (const [name, schema] of Object.entries(obj(obj(doc.components).schemas))) {
    const where: Where = { kind: "schema", name };
    const s = obj(schema);
    if (s.type === "array" && !isObj(s.items)) add("warning", `Schema ${name}: arrays need an items type.`, where);
    for (const r of arr(s.required)) if (!(str(r) in obj(s.properties))) add("warning", `Schema ${name}: required property “${str(r)}” isn’t defined.`, where);
    checkRefs(s, where);
  }
  return issues;
}

/* ——— Mock server ——— */

export type MockRoute = { method: string; pattern: string; status: number; headers: [string, string][]; body: string; delayMs?: number };

export const serverUrl = (doc: Obj) => str(obj(arr(doc.servers)[0]).url, "");
const basePath = (doc: Obj) => {
  const u = serverUrl(doc);
  try { return new URL(u).pathname.replace(/\/$/, ""); } catch { return u.startsWith("/") ? u.replace(/\/$/, "") : ""; }
};

function pickResponse(op: Obj): { status: number; res: Obj } | null {
  const responses = obj(op.responses);
  const codes = Object.keys(responses);
  const ok = codes.filter((c) => /^2\d\d$/.test(c)).sort()[0];
  const code = ok ?? (codes.includes("default") ? "default" : codes.sort()[0]);
  return code ? { status: /^\d{3}$/.test(code) ? Number(code) : 200, res: obj(deref({}, responses[code])) } : null;
}

export function mockRoutes(doc: Obj): MockRoute[] {
  const base = basePath(doc);
  return listOperations(doc).flatMap(({ method, path, op }) => {
    const picked = pickResponse(op);
    const res = picked ? (obj(deref(doc, picked.res)) as Obj) : {};
    const content = obj(res.content);
    const json = Object.entries(content).find(([t]) => /json/i.test(t));
    let body = "";
    const headers: [string, string][] = [];
    if (json && isObj(json[1]) && picked && picked.status !== 204) {
      const media = json[1];
      const ex = media.example ?? (isObj(media.examples) ? obj(Object.values(media.examples).find(isObj)).value : undefined) ?? sample(doc, media.schema);
      body = JSON.stringify(ex, null, 2);
      headers.push(["content-type", json[0]]);
    }
    return [{ method: method.toUpperCase(), pattern: `${base}${path}`, status: picked?.status ?? 200, headers, body }];
  });
}

/* ——— Requests ——— */

export function newDesign(name: string, spec: string): ApiDesign {
  return { id: uid(), name, spec };
}

export const designTitle = (spec: string, fallback = "Untitled API") => str(obj(parseSpec(spec).doc.info).title).trim() || fallback;

/**
 * Creates (or tops up) a collection of requests for the design, plus environments pointing at the
 * real server and at the local mock. Existing requests are kept; only missing ones are added.
 */
export function generateRequests(ws: Workspace, design: ApiDesign, mockBase: string): { ws: Workspace; added: number; collectionId: string; environments: string[] } {
  const { doc, error } = parseSpec(design.spec);
  if (error) throw new Error(error);
  const imported = importOpenApi(doc);
  const title = designTitle(design.spec, design.name);
  const flat = imported.collections.flatMap((c) => c.requests);
  const existing = ws.collections.find((c) => c.id === design.collectionId);
  const key = (r: { method: string; url: string }) => `${r.method} ${r.url}`;
  const have = new Set((existing?.requests ?? []).map(key));
  const fresh = flat.filter((r) => !have.has(key(r)));
  const envs: Environment[] = [];
  const names = new Set(ws.environments.map((e) => e.name));
  const server = imported.environments[0]?.vars[0]?.value;
  if (server && !names.has(`${title} (server)`)) envs.push({ id: uid(), name: `${title} (server)`, vars: [{ key: "base_url", value: server, enabled: true }], secrets: [] });
  if (!names.has(`${title} (mock)`)) envs.push({ id: uid(), name: `${title} (mock)`, vars: [{ key: "base_url", value: `${mockBase}${basePath(doc)}`, enabled: true }], secrets: [] });

  const result = { ...imported, collections: [{ name: title, requests: fresh }], environments: [] as Environment[] };
  const merged = mergeImport(ws, result, existing?.id);
  let next = merged.ws;
  const collectionId = existing?.id ?? next.collections.find((c) => c.name.startsWith(title) && !ws.collections.some((o) => o.id === c.id))?.id ?? "";
  next = { ...next, environments: [...next.environments, ...envs] };
  return { ws: next, added: fresh.length, collectionId, environments: envs.map((e) => e.name) };
}
