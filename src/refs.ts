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
