import { allRequests, lastResponse, slug, type RequestDef, type Workspace } from "./model";

// Template tokens:
//   {{name}}                       environment variable or secret
//   {{@request_slug.status}}       status code of the latest response
//   {{@request_slug.headers.name}} response header
//   {{@request_slug.body.a.b.0}}   JSON path into the latest response body
export const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

export type Resolution =
  | { ok: true; token: string; kind: "env" | "secret" | "response"; source: string; value: string; requestId?: string }
  | { ok: false; token: string; kind: "env" | "response"; reason: string; fix?: { label: string; requestId?: string } };

export function getPath(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function resolveToken(ws: Workspace, token: string): Resolution {
  if (!token.startsWith("@")) {
    const env = ws.environments.find((e) => e.id === ws.activeEnvId);
    if (!env) return { ok: false, token, kind: "env", reason: "No environment is selected.", fix: { label: "Choose an environment" } };
    const v = env.vars.find((v) => v.enabled && v.key === token);
    if (v) return { ok: true, token, kind: "env", source: env.name, value: v.value };
    const s = env.secrets.find((v) => v.enabled && v.key === token);
    if (s) return { ok: true, token, kind: "secret", source: `${env.name} (secret)`, value: s.value };
    return { ok: false, token, kind: "env", reason: `“${token}” is not defined in ${env.name}.`, fix: { label: `Add to ${env.name}` } };
  }

  const [reqSlug, part, ...rest] = token.slice(1).split(".");
  const match = allRequests(ws).find(({ request }) => slug(request.name) === reqSlug);
  if (!match) return { ok: false, token, kind: "response", reason: `No request is named “${reqSlug}”.` };
  const src = match.request;
  const res = lastResponse(ws, src.id);
  if (!res)
    return { ok: false, token, kind: "response", reason: `${src.name} has no response yet.`, fix: { label: `Send ${src.name}`, requestId: src.id } };

  let value: unknown;
  if (part === "status") value = res.status;
  else if (part === "headers") value = res.headers.find(([k]) => k.toLowerCase() === rest.join(".").toLowerCase())?.[1];
  else if (part === "body") {
    if (rest.length === 0) value = res.body;
    else {
      try {
        value = getPath(JSON.parse(res.body), rest);
      } catch {
        return { ok: false, token, kind: "response", reason: `${src.name} did not return JSON.`, fix: { label: `Resend ${src.name}`, requestId: src.id } };
      }
    }
  } else return { ok: false, token, kind: "response", reason: `Use .status, .headers.<name> or .body.<path>.` };

  if (value === undefined)
    return {
      ok: false,
      token,
      kind: "response",
      reason: `${[part, ...rest].join(".")} is missing from the latest ${src.name} response.`,
      fix: { label: `Resend ${src.name}`, requestId: src.id },
    };
  return {
    ok: true,
    token,
    kind: "response",
    source: `${src.name} → ${[part, ...rest].join(".")}`,
    value: typeof value === "string" ? value : JSON.stringify(value),
    requestId: src.id,
  };
}

export function tokensIn(req: RequestDef) {
  const texts = [req.url, req.body, ...req.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value])];
  const set = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(TOKEN)) set.add(m[1]);
  return [...set];
}

export function interpolate(ws: Workspace, text: string) {
  const unresolved: string[] = [];
  const out = text.replace(TOKEN, (_, name: string) => {
    const r = resolveToken(ws, name);
    if (r.ok) return r.value;
    unresolved.push(name);
    return `{{${name}}}`;
  });
  return { out, unresolved };
}

export function downstreamUses(ws: Workspace, token: string) {
  return allRequests(ws).filter(({ request }) => tokensIn(request).includes(token));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrites `{{@from.…}}` references to `{{@to.…}}` in every text field of a request. */
export function renameReferences(req: RequestDef, from: string, to: string): RequestDef {
  if (from === to) return req;
  const re = new RegExp(`(\\{\\{\\s*@)${escapeRe(from)}(?=[.\\s}])`, "g");
  const fix = (t: string) => t.replace(re, `$1${to}`);
  return {
    ...req,
    url: fix(req.url),
    body: fix(req.body),
    headers: req.headers.map((h) => ({ ...h, key: fix(h.key), value: fix(h.value) })),
  };
}

/** Returns `name`, suffixed if needed so its slug is unique among other requests. */
export function uniqueName(ws: Workspace, name: string, exceptId: string) {
  const taken = new Set(allRequests(ws).filter(({ request }) => request.id !== exceptId).map(({ request }) => slug(request.name)));
  if (!taken.has(slug(name))) return name;
  let n = 2;
  while (taken.has(slug(`${name} ${n}`))) n++;
  return `${name} ${n}`;
}

export type Field = "url" | "body" | `header:${number}`;
export type InsertTarget =
  | { kind: "header"; name: string }
  | { kind: "query"; name: string }
  | { kind: "body"; name: string }
  | { kind: "cursor"; field: Field; pos: number };

/** Suggests a parameter name and placement from the referenced path, e.g. `…body.data.token` → Authorization header. */
export function suggestTarget(token: string, method: RequestDef["method"]): InsertTarget {
  const name = token.split(".").pop() || "value";
  if (/token|jwt|access/i.test(name)) return { kind: "header", name: "Authorization" };
  if (method === "GET" || method === "HEAD") return { kind: "query", name };
  return { kind: "body", name };
}

export function insertReference(req: RequestDef, token: string, target: InsertTarget): RequestDef {
  const ref = `{{${token}}}`;
  switch (target.kind) {
    case "header": {
      const value = target.name.toLowerCase() === "authorization" ? `Bearer ${ref}` : ref;
      const i = req.headers.findIndex((h) => h.key.toLowerCase() === target.name.toLowerCase());
      const headers = i < 0
        ? [...req.headers, { key: target.name, value, enabled: true }]
        : req.headers.map((h, j) => (j === i ? { ...h, value, enabled: true } : h));
      return { ...req, headers };
    }
    case "query": {
      const [base, hash] = req.url.split("#", 2);
      const sep = !base.includes("?") ? "?" : /[?&]$/.test(base) ? "" : "&";
      return { ...req, url: `${base}${sep}${encodeURIComponent(target.name)}=${ref}${hash !== undefined ? `#${hash}` : ""}` };
    }
    case "body": {
      if (!req.body.trim()) return { ...req, body: JSON.stringify({ [target.name]: ref }, null, 2) };
      try {
        const obj = JSON.parse(req.body);
        if (obj && typeof obj === "object" && !Array.isArray(obj))
          return { ...req, body: JSON.stringify({ ...obj, [target.name]: ref }, null, 2) };
      } catch { /* not JSON: append below */ }
      return { ...req, body: `${req.body.replace(/\n?$/, "\n")}${ref}` };
    }
    case "cursor": {
      const splice = (t: string) => t.slice(0, target.pos) + ref + t.slice(target.pos);
      if (target.field === "url") return { ...req, url: splice(req.url) };
      if (target.field === "body") return { ...req, body: splice(req.body) };
      const i = Number(target.field.split(":")[1]);
      return { ...req, headers: req.headers.map((h, j) => (j === i ? { ...h, value: splice(h.value) } : h)) };
    }
  }
}
