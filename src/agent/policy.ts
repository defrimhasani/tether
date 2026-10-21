import { allRequests, slug, type RequestDef, type Workspace } from "../model";
import { tokensIn } from "../refs";

export type Grant = { requestId: string; environments: string[] };
export type AgentPolicy = { version: 1; grants: Grant[] };
export const EMPTY_POLICY: AgentPolicy = { version: 1, grants: [] };

export const READ = new Set(["GET", "HEAD", "OPTIONS"]);
export const isWrite = (request: RequestDef) => !READ.has(request.method);

export function grantFor(policy: AgentPolicy, requestId: string) {
  return policy.grants.find((g) => g.requestId === requestId);
}

export function allowed(policy: AgentPolicy, request: RequestDef, envId: string | null) {
  const g = grantFor(policy, request.id);
  return !!g && !!envId && g.environments.includes(envId);
}

export function setGrant(policy: AgentPolicy, requestId: string, environmentId: string, on: boolean): AgentPolicy {
  const grants = policy.grants.map((g) => ({ ...g, environments: [...g.environments] }));
  const g = grants.find((g) => g.requestId === requestId);
  if (on) {
    if (g) { if (!g.environments.includes(environmentId)) g.environments.push(environmentId); }
    else grants.push({ requestId, environments: [environmentId] });
  } else if (g) {
    g.environments = g.environments.filter((id) => id !== environmentId);
  }
  return { version: 1, grants: grants.filter((g) => g.environments.length) };
}

export function enabledRequests(ws: Workspace, policy: AgentPolicy) {
  return allRequests(ws).filter(({ request }) => policy.grants.some((g) => g.requestId === request.id && g.environments.length));
}

/** External variables: environment values and chained response references are not agent input. */
export function inputsFor(ws: Workspace, request: RequestDef, envId: string | null) {
  const env = ws.environments.find((e) => e.id === envId);
  const known = new Set([...(env?.vars ?? []), ...(env?.secrets ?? [])].filter((v) => v.enabled).map((v) => v.key));
  return tokensIn(request).filter((t) => !t.startsWith("@") && !known.has(t));
}

export function toolName(request: RequestDef, all: RequestDef[]) {
  const base = `run_${slug(request.name)}`.replace(/[^a-z0-9_]/g, "_");
  const collisions = all.filter((r) => `run_${slug(r.name)}`.replace(/[^a-z0-9_]/g, "_") === base);
  return collisions.length <= 1 ? base : `${base}_${request.id}`;
}

export function dependencies(ws: Workspace, request: RequestDef) {
  const bySlug = new Map(allRequests(ws).map(({ request }) => [slug(request.name), request]));
  return [...new Set(tokensIn(request).filter((t) => t.startsWith("@")).map((t) => bySlug.get(t.slice(1).split(".")[0])).filter((r): r is RequestDef => !!r))];
}
