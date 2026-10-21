import { parse as parseYaml } from "yaml";
import { looksLikeCurl, parseCurl } from "./curl";
import { METHODS, uid, type Collection, type Environment, type KV, type Method, type RequestDef, type Workspace } from "./model";
import { uniqueName } from "./refs";

export type ImportedCollection = { name: string; requests: RequestDef[] };
export type ImportResult = {
  source: string;
  collections: ImportedCollection[];
  environments: Environment[];
  warnings: string[];
};
export type ImportOutcome = ImportResult | { error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asMethod = (m: unknown): Method => (METHODS.includes(String(m).toUpperCase() as Method) ? (String(m).toUpperCase() as Method) : "GET");
const kv = (key: string, value: string, enabled = true): KV => ({ key, value, enabled });
const countRequests = (r: ImportResult) => r.collections.reduce((n, c) => n + c.requests.length, 0);

function parseJsonOrYaml(text: string): unknown {
  try { return JSON.parse(text); } catch { /* try YAML */ }
  try { return parseYaml(text); } catch { return undefined; }
}

function req(init: Partial<RequestDef> & { name: string }): RequestDef {
  return { id: uid(), method: "GET", url: "", headers: [], body: "", ...init };
}

/* ——— Postman ——— */

function postmanUrl(u: unknown): string {
  if (typeof u === "string") return u;
  if (!isObj(u)) return "";
  if (typeof u.raw === "string") return u.raw;
  const host = Array.isArray(u.host) ? u.host.join(".") : str(u.host);
  const path = Array.isArray(u.path) ? u.path.join("/") : str(u.path);
  const query = arr(u.query).filter(isObj).filter((x) => x.disabled !== true).map((x) => `${str(x.key)}=${str(x.value)}`).join("&");
  return `${str(u.protocol) ? `${str(u.protocol)}://` : ""}${host}${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
}

function postmanRequest(name: string, r: Obj, warnings: string[]): RequestDef {
  const headers = arr(r.header).filter(isObj).map((h) => kv(str(h.key), str(h.value), h.disabled !== true));
  let body = "";
  if (isObj(r.body)) {
    const b = r.body;
    if (b.mode === "raw") body = str(b.raw);
    else if (b.mode === "urlencoded") {
      body = arr(b.urlencoded).filter(isObj).filter((x) => x.disabled !== true).map((x) => `${encodeURIComponent(str(x.key))}=${encodeURIComponent(str(x.value))}`).join("&");
      if (body && !headers.some((h) => h.key.toLowerCase() === "content-type")) headers.push(kv("Content-Type", "application/x-www-form-urlencoded"));
    } else if (b.mode === "formdata" || b.mode === "file" || b.mode === "graphql") {
      warnings.push(`“${name}”: ${String(b.mode)} bodies aren’t supported yet; the body was left empty.`);
    }
    if (body && isObj(b.options) && isObj(b.options.raw) && b.options.raw.language === "json" && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
      headers.push(kv("Content-Type", "application/json"));
    }
  }
  const auth = isObj(r.auth) ? r.auth : undefined;
  if (auth) {
    const field = (type: string, key: string) => str(arr(auth[type]).filter(isObj).find((x) => x.key === key)?.value);
    if (auth.type === "bearer") headers.push(kv("Authorization", `Bearer ${field("bearer", "token")}`));
    else if (auth.type === "apikey" && field("apikey", "in") !== "query") headers.push(kv(field("apikey", "key") || "X-API-Key", field("apikey", "value")));
    else if (auth.type === "basic") {
      const [u, p] = [field("basic", "username"), field("basic", "password")];
      if (`${u}${p}`.includes("{{")) warnings.push(`“${name}”: Basic auth uses variables; add the Authorization header yourself.`);
      else headers.push(kv("Authorization", `Basic ${btoa(`${u}:${p}`)}`));
    } else if (auth.type !== "noauth") warnings.push(`“${name}”: ${String(auth.type)} authorization isn’t supported yet.`);
  }
  return req({ name, method: asMethod(r.method), url: postmanUrl(r.url), headers, body, ...(str(r.description) ? { description: str(r.description) } : {}) });
}

function importPostman(data: Obj): ImportResult {
  const info = isObj(data.info) ? data.info : {};
  const title = str(info.name, "Postman collection");
  const warnings: string[] = [];
  const groups = new Map<string, RequestDef[]>();
  const add = (group: string, r: RequestDef) => groups.set(group, [...(groups.get(group) ?? []), r]);

  const walk = (items: unknown[], top: string | null, prefix: string[]) => {
    for (const it of items.filter(isObj)) {
      if (Array.isArray(it.item)) walk(it.item, top ?? str(it.name, "Folder"), top ? [...prefix, str(it.name)] : []);
      else if (isObj(it.request)) {
        const name = [...prefix, str(it.name, "Request")].join(" / ");
        add(top ?? title, postmanRequest(name, it.request, warnings));
      }
    }
  };
  walk(arr(data.item), null, []);

  const vars = arr(data.variable).filter(isObj).filter((v) => str(v.key));
  const environments: Environment[] = vars.length
    ? [{ id: uid(), name: `${title} variables`, vars: vars.map((v) => kv(str(v.key), str(v.value ?? v.initial))), secrets: [] }]
    : [];
  return { source: "Postman collection", collections: [...groups].map(([name, requests]) => ({ name, requests })), environments, warnings };
}

function importPostmanEnv(data: Obj): ImportResult {
  const values = arr(data.values).filter(isObj).filter((v) => str(v.key));
  const secret = (v: Obj) => v.type === "secret";
  return {
    source: "Postman environment",
    collections: [],
    environments: [{
      id: uid(), name: str(data.name, "Imported environment"),
      vars: values.filter((v) => !secret(v)).map((v) => kv(str(v.key), str(v.value), v.enabled !== false)),
      secrets: values.filter(secret).map((v) => kv(str(v.key), str(v.value), v.enabled !== false)),
    }],
    warnings: [],
  };
}

/* ——— Insomnia v4 ——— */

const insomniaTpl = (s: string) => s.replace(/\{\{\s*_\.([^}\s]+)\s*\}\}/g, "{{$1}}");

function importInsomnia(data: Obj): ImportResult {
  const res = arr(data.resources).filter(isObj);
  const byId = new Map(res.map((r) => [str(r._id), r]));
  const warnings: string[] = [];
  const groups = new Map<string, RequestDef[]>();
  const rootOf = (r: Obj): { top: string; path: string[] } => {
    const path: string[] = [];
    let cur: Obj | undefined = byId.get(str(r.parentId));
    let top = "Insomnia";
    while (cur) {
      if (cur._type === "request_group") { path.unshift(str(cur.name)); top = str(cur.name, top); }
      else if (cur._type === "workspace") { top = str(cur.name, top); break; }
      cur = byId.get(str(cur.parentId));
    }
    // Keep the workspace (or first folder) as the collection; deeper folders become name prefixes.
    return { top: path.length ? path[0] : top, path: path.slice(1) };
  };
  for (const r of res.filter((x) => x._type === "request")) {
    const { top, path } = rootOf(r);
    const headers = arr(r.headers).filter(isObj).map((h) => kv(insomniaTpl(str(h.name)), insomniaTpl(str(h.value)), h.disabled !== true));
    const b = isObj(r.body) ? r.body : {};
    let body = "";
    if (typeof b.text === "string") body = insomniaTpl(b.text);
    else if (b.mimeType === "multipart/form-data" || b.mimeType === "application/graphql") warnings.push(`“${str(r.name)}”: ${String(b.mimeType)} bodies aren’t supported yet.`);
    const a = isObj(r.authentication) ? r.authentication : {};
    if (a.type === "bearer" && !a.disabled) headers.push(kv("Authorization", `Bearer ${insomniaTpl(str(a.token))}`));
    groups.set(top, [...(groups.get(top) ?? []), req({
      name: [...path, str(r.name, "Request")].join(" / "), method: asMethod(r.method), url: insomniaTpl(str(r.url)), headers, body,
    })]);
  }
  const environments = res.filter((x) => x._type === "environment" && isObj(x.data) && Object.keys(x.data).length).map((e) => ({
    id: uid(), name: str(e.name, "Environment"),
    vars: Object.entries(e.data as Obj).filter(([, v]) => typeof v !== "object").map(([k, v]) => kv(k, str(v))), secrets: [] as KV[],
  }));
  return { source: "Insomnia export", collections: [...groups].map(([name, requests]) => ({ name, requests })), environments, warnings };
}

/* ——— OpenAPI / Swagger ——— */

function deref(root: Obj, node: unknown, depth = 0): unknown {
  if (isObj(node) && typeof node.$ref === "string" && node.$ref.startsWith("#/") && depth < 8) {
    const target = node.$ref.slice(2).split("/").reduce<unknown>((acc, k) => (isObj(acc) ? acc[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
    return deref(root, target, depth + 1);
  }
  return node;
}

function sample(root: Obj, schema: unknown, depth = 0): unknown {
  const s = deref(root, schema);
  if (!isObj(s) || depth > 4) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (Array.isArray(s.allOf)) return Object.assign({}, ...s.allOf.map((x) => sample(root, x, depth + 1)).filter(isObj));
  const pick = (Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : [])[0];
  if (pick) return sample(root, pick, depth + 1);
  const type = s.type ?? (s.properties ? "object" : undefined);
  if (type === "object") {
    const out: Obj = {};
    for (const [k, v] of Object.entries(isObj(s.properties) ? s.properties : {})) out[k] = sample(root, v, depth + 1);
    return out;
  }
  if (type === "array") return [sample(root, s.items, depth + 1)];
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return s.format === "date-time" ? "2024-01-01T00:00:00Z" : "string";
}

function importOpenApi(data: Obj): ImportResult {
  const warnings: string[] = [];
  const title = str(isObj(data.info) ? data.info.title : "", "API");
  const isV2 = typeof data.swagger === "string";
  const server = isV2
    ? `${arr(data.schemes)[0] ?? "https"}://${str(data.host, "localhost")}${str(data.basePath)}`
    : str(isObj(arr(data.servers)[0]) ? (arr(data.servers)[0] as Obj).url : "", "http://localhost");
  const groups = new Map<string, RequestDef[]>();

  const security = isObj(data.components) && isObj(data.components.securitySchemes) ? data.components.securitySchemes : isObj(data.securityDefinitions) ? data.securityDefinitions : {};
  const authHeaders: KV[] = [];
  const needsAuth = (op: Obj) => (Array.isArray(op.security) ? op.security.length > 0 : Array.isArray(data.security) && data.security.length > 0);

  for (const [path, item] of Object.entries(isObj(data.paths) ? data.paths : {})) {
    if (!isObj(item)) continue;
    const common = arr(item.parameters);
    for (const m of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = item[m];
      if (!isObj(op)) continue;
      const params = [...common, ...arr(op.parameters)].map((p) => deref(data, p)).filter(isObj);
      const query = params.filter((p) => p.in === "query" && p.required === true).map((p) => `${str(p.name)}={{${str(p.name)}}}`);
      const headers = params.filter((p) => p.in === "header" && p.required === true).map((p) => kv(str(p.name), `{{${str(p.name)}}}`));
      let body = "";
      const rb = deref(data, op.requestBody);
      if (isObj(rb) && isObj(rb.content)) {
        const json = Object.entries(rb.content).find(([t]) => /json/i.test(t));
        if (json && isObj(json[1])) {
          const media = json[1];
          const ex = media.example ?? (isObj(media.examples) ? (Object.values(media.examples).find(isObj) as Obj | undefined)?.value : undefined) ?? sample(data, media.schema);
          body = JSON.stringify(ex, null, 2);
          headers.push(kv("Content-Type", json[0]));
        } else warnings.push(`${m.toUpperCase()} ${path}: only JSON request bodies are imported.`);
      } else if (isV2) {
        const bp = params.find((p) => p.in === "body");
        if (bp) { body = JSON.stringify(sample(data, bp.schema), null, 2); headers.push(kv("Content-Type", "application/json")); }
      }
      if (needsAuth(op)) {
        const scheme = Object.values(security).filter(isObj)[0];
        if (scheme && (scheme.scheme === "bearer" || scheme.type === "oauth2" || scheme.type === "http")) headers.push(kv("Authorization", "Bearer {{token}}"));
        else if (scheme && scheme.type === "apiKey" && scheme.in === "header") headers.push(kv(str(scheme.name, "X-API-Key"), "{{api_key}}"));
        else if (scheme) authHeaders.push(kv("", ""));
      }
      const url = `{{base_url}}${path.replace(/\{([^}]+)\}/g, "{{$1}}")}${query.length ? `?${query.join("&")}` : ""}`;
      const tag = str(arr(op.tags)[0], title);
      const name = str(op.summary) || str(op.operationId) || `${m.toUpperCase()} ${path}`;
      groups.set(tag, [...(groups.get(tag) ?? []), req({ name, method: asMethod(m), url, headers, body, ...(str(op.description) ? { description: str(op.description) } : {}) })]);
    }
  }
  if (authHeaders.length) warnings.push("Some operations use an authorization scheme Tether can’t fill in yet; add headers where needed.");
  const environments: Environment[] = [{ id: uid(), name: `${title} (imported)`, vars: [kv("base_url", server.replace(/\/$/, ""))], secrets: [] }];
  return { source: `OpenAPI ${str(data.openapi ?? data.swagger)}`, collections: [...groups].map(([name, requests]) => ({ name, requests })), environments, warnings };
}

/* ——— Entry points ——— */

export function detectAndParse(text: string): ImportOutcome {
  const t = text.trim();
  if (!t) return { error: "Paste a cURL command, or a Postman, Insomnia or OpenAPI file." };
  if (looksLikeCurl(t)) {
    const r = parseCurl(t);
    if ("error" in r) return r;
    return { source: "cURL command", collections: [{ name: "Imported", requests: [req(r.request)] }], environments: [], warnings: r.warnings };
  }
  const data = parseJsonOrYaml(t);
  if (!isObj(data)) return { error: "Couldn’t read that as cURL, JSON or YAML." };
  let out: ImportResult | null = null;
  if (typeof data.openapi === "string" || typeof data.swagger === "string") out = importOpenApi(data);
  else if (Array.isArray(data.item) && isObj(data.info)) out = importPostman(data);
  else if (data._type === "export" && Array.isArray(data.resources)) out = importInsomnia(data);
  else if (Array.isArray(data.values) && (typeof data.name === "string" || data._postman_variable_scope)) out = importPostmanEnv(data);
  if (!out) return { error: "That isn’t a format Tether can import yet. Supported: cURL, Postman (v2), Insomnia (v4), OpenAPI 3 and Swagger 2." };
  if (!countRequests(out) && !out.environments.length) return { error: "No requests were found in that file." };
  return out;
}

export function describe(r: ImportResult) {
  const n = countRequests(r);
  const bits = [];
  if (n) bits.push(`${n} request${n === 1 ? "" : "s"}${r.collections.length > 1 ? ` in ${r.collections.length} collections` : ""}`);
  if (r.environments.length) bits.push(`${r.environments.length} environment${r.environments.length === 1 ? "" : "s"}`);
  return bits.join(" and ");
}

/**
 * Adds imported collections and environments, keeping request names unique (references depend on them).
 * Imported variables would leave the new requests unresolved, so the first imported environment becomes active.
 */
export function mergeImport(ws: Workspace, r: ImportResult, into?: string): { ws: Workspace; firstRequestId?: string } {
  let next = ws;
  let first: string | undefined;
  const fresh: Collection[] = [];
  const target = into && r.collections.length === 1 ? ws.collections.find((c) => c.id === into) : undefined;
  const taken = new Set(ws.collections.map((c) => c.name));
  for (const c of r.collections) {
    const added: RequestDef[] = [];
    for (const rq of c.requests) {
      const all: Workspace = { ...next, collections: [...next.collections, ...fresh, { id: "", name: "", requests: added }] };
      const named = { ...rq, name: uniqueName(all, rq.name, rq.id) };
      added.push(named);
      first ??= named.id;
    }
    if (target) next = { ...next, collections: next.collections.map((x) => (x.id === target.id ? { ...x, requests: [...x.requests, ...added] } : x)) };
    else {
      let name = c.name;
      for (let n = 2; taken.has(name); n++) name = `${c.name} ${n}`;
      taken.add(name);
      fresh.push({ id: uid(), name, requests: added });
    }
  }
  const envNames = new Set(ws.environments.map((e) => e.name));
  const envs = r.environments.map((e) => {
    let name = e.name;
    for (let n = 2; envNames.has(name); n++) name = `${e.name} ${n}`;
    envNames.add(name);
    return { ...e, name };
  });
  next = { ...next, collections: [...next.collections, ...fresh], environments: [...next.environments, ...envs], activeEnvId: envs[0]?.id ?? next.activeEnvId };
  return { ws: next, firstRequestId: first };
}
