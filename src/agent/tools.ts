import { allRequests, formatBytes, slug, type HttpResponse, type RequestDef, type Workspace } from "../model";
import { dependencies, inputsFor, toolName, type AgentPolicy } from "./policy";

export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown> };

const text = (t: string) => ({ type: "string", description: t });
const varsSchema = (inputs: string[]) => ({ type: "object", properties: Object.fromEntries(inputs.map((x) => [x, text(`Value for {{${x}}}`)])), additionalProperties: false });

export function toolList(ws: Workspace, policy: AgentPolicy): McpTool[] {
  const requests = allRequests(ws).map((x) => x.request);
  const enabled = requests.filter((r) => policy.grants.some((g) => g.requestId === r.id && g.environments.length));
  const common: McpTool[] = [
    { name: "list_requests", description: "List saved API requests that this agent may run.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "describe_request", description: "Get the URL template, inputs, and dependencies for one enabled saved request.", inputSchema: { type: "object", properties: { request: text("Request name or id") }, required: ["request"], additionalProperties: false } },
    { name: "list_environments", description: "List environments that are enabled for agent access. Secrets are never returned.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    {
      name: "run_request",
      description: "Run an enabled saved request by name or id. You may only supply its declared inputs; you cannot change its URL, method, headers or authentication.",
      inputSchema: { type: "object", properties: { request: text("Request name or id"), environment: text("Optional enabled environment name or id"), variables: { ...varsSchema([]), description: "Values for declared variables" }, select: text("Optional response path or slice, e.g. data.items[0:5]"), max_bytes: { type: "integer", minimum: 256, maximum: 50000, description: "Maximum response body bytes to return (default 8000)" } }, required: ["request"], additionalProperties: false },
    },
    { name: "create_draft_request", description: "Create an unsent, disabled draft request for a human to review. It cannot run until enabled in Tether.", inputSchema: { type: "object", properties: { name: text("Request name"), method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] }, url: text("Full http or https URL"), description: text("Why this request is needed"), headers: { type: "object", additionalProperties: { type: "string" } }, body: text("Optional body") }, required: ["name", "method", "url"], additionalProperties: false } },
    { name: "get_last_response", description: "Read the last stored response of an enabled request without running it.", inputSchema: { type: "object", properties: { request: text("Request name or id"), select: text("Optional response path or slice") }, required: ["request"], additionalProperties: false } },
    { name: "search_history", description: "Search recent agent and human runs by enabled request or HTTP status.", inputSchema: { type: "object", properties: { request: text("Optional request name or id"), status: { type: "integer", minimum: 100, maximum: 599 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false } },
  ];
  const typed = enabled.map((r) => ({
    name: toolName(r, requests),
    description: `${r.description ? `${r.description} ` : ""}Run saved ${r.method} request “${r.name}”. ${dependencies(ws, r).length ? "Tether also runs its saved dependencies when allowed. " : ""}Authentication stays in Tether.`,
    inputSchema: { ...varsSchema(inputsFor(ws, r, ws.activeEnvId)), properties: { ...varsSchema(inputsFor(ws, r, ws.activeEnvId)).properties, environment: text("Optional enabled environment name or id"), select: text("Optional response path or slice"), max_bytes: { type: "integer", minimum: 256, maximum: 50000 } } },
  }));
  return [...common, ...typed];
}

export function requestSummary(ws: Workspace, policy: AgentPolicy, r: RequestDef) {
  const grant = policy.grants.find((g) => g.requestId === r.id);
  return {
    id: r.id, name: r.name, ...(r.description ? { description: r.description } : {}), tool: toolName(r, allRequests(ws).map((x) => x.request)), method: r.method,
    urlTemplate: r.url, enabled: !!grant?.environments.length,
    inputs: inputsFor(ws, r, ws.activeEnvId), dependencies: dependencies(ws, r).map((d) => d.name),
    environments: grant?.environments ?? [],
  };
}

export function resolveRequest(ws: Workspace, nameOrId: string) {
  const q = nameOrId.toLowerCase();
  const matches = allRequests(ws).map((x) => x.request).filter((r) => r.id === nameOrId || r.name.toLowerCase() === q || slug(r.name) === slug(nameOrId));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No saved request matches “${nameOrId}”.`);
  throw new Error(`“${nameOrId}” is ambiguous; use its id.`);
}

export function resolveEnvironment(ws: Workspace, nameOrId?: string) {
  if (!nameOrId) return ws.environments.find((e) => e.id === ws.activeEnvId) ?? null;
  const q = nameOrId.toLowerCase();
  const matches = ws.environments.filter((e) => e.id === nameOrId || e.name.toLowerCase() === q);
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No environment matches “${nameOrId}”.`);
  throw new Error(`“${nameOrId}” is ambiguous; use its id.`);
}

// ——— Compact response output ———

const MAX_DEPTH = 5;
const primitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

export function shape(value: unknown, depth = 0): string {
  if (depth >= MAX_DEPTH) return "…";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (!value.length) return "Array<unknown> (0)";
    return `Array<${shape(value[0], depth + 1)}> (${value.length})`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as object).slice(0, 20).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`);
    return `{ ${entries.join(", ")}${Object.keys(value as object).length > 20 ? ", …" : ""} }`;
  }
  return typeof value;
}

type Step = { key: string; wildcard?: boolean; start?: number; end?: number };
export function parseSelect(input: string): Step[] {
  if (!input || input === "$") return [];
  const s = input.replace(/^\$\.?/, "");
  const out: Step[] = [];
  const re = /(?:^|\.)([A-Za-z_$][\w$]*)(?:\[(\*|\d+|\d*:\d*)\])?/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index !== last && !(m.index === 0 && last === 0)) throw new Error(`Invalid select path “${input}”.`);
    last = m.index! + m[0].length;
    const bracket = m[2];
    const step: Step = { key: m[1] };
    if (bracket === "*") step.wildcard = true;
    else if (bracket?.includes(":")) { const [a, b] = bracket.split(":"); step.start = a ? Number(a) : undefined; step.end = b ? Number(b) : undefined; }
    else if (bracket) { step.start = Number(bracket); step.end = Number(bracket) + 1; }
    out.push(step);
  }
  if (last !== s.length) throw new Error(`Invalid select path “${input}”.`);
  return out;
}

export function selectValue(value: unknown, input?: string): unknown {
  let values: unknown[] = [value];
  for (const step of parseSelect(input ?? "")) {
    values = values.flatMap((v) => {
      const child = v && typeof v === "object" ? (v as Record<string, unknown>)[step.key] : undefined;
      if (!Array.isArray(child)) return child === undefined ? [] : [child];
      if (step.wildcard) return child;
      if (step.start !== undefined || step.end !== undefined) return child.slice(step.start, step.end);
      return [child];
    });
  }
  return values.length === 1 ? values[0] : values;
}

function limit(value: unknown, budget: number, depth = 0): unknown {
  if (budget <= 0 || depth > 6) return "…";
  if (typeof value === "string") return value.length * 2 > budget ? `${value.slice(0, Math.max(0, Math.floor(budget / 2) - 1))}…` : value;
  if (primitive(value)) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = limit(item, Math.max(64, Math.floor(budget / 8)), depth + 1);
      out.push(next);
      if (JSON.stringify(out).length * 2 > budget || out.length >= 50) { out.push("… truncated"); break; }
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as object)) {
    out[k] = limit(v, Math.max(64, Math.floor(budget / 8)), depth + 1);
    if (JSON.stringify(out).length * 2 > budget || Object.keys(out).length >= 50) { out["…"] = "truncated"; break; }
  }
  return out;
}

export function shapeResponse(res: HttpResponse, opts: { select?: string; maxBytes?: number; secrets?: string[] } = {}) {
  const headers = Object.fromEntries(res.headers.filter(([k]) => /^(content-type|content-length|etag|location|retry-after|cache-control)$/i.test(k)));
  const meta = { status: res.status, statusText: res.statusText, durationMs: res.durationMs, size: res.size, headers, untrusted: true };
  if (!res.body) return { ...meta, body: res.bodyBase64 ? { type: "binary", message: `Binary body (${formatBytes(res.size)}) is not returned to agents.` } : null };
  let json: unknown;
  try { json = JSON.parse(res.body); } catch {
    const max = Math.min(opts.maxBytes ?? 8000, 50_000);
    return { ...meta, body: res.body.length * 2 > max ? `${res.body.slice(0, Math.floor(max / 2))}…` : res.body, truncated: res.body.length * 2 > max };
  }
  const selected = selectValue(json, opts.select);
  const max = Math.min(Math.max(opts.maxBytes ?? 8000, 256), 50_000);
  const body = limit(selected, max);
  const text = JSON.stringify(body);
  return { ...meta, shape: shape(selected), body, truncated: text.length * 2 >= max, ...(opts.select ? { select: opts.select } : {}) };
}
