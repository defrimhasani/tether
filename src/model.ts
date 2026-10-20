export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export type KV = { key: string; value: string; enabled: boolean };

export type RequestDef = {
  id: string;
  name: string;
  method: Method;
  url: string;
  headers: KV[];
  body: string;
};

export type Collection = { id: string; name: string; requests: RequestDef[] };

export type Environment = { id: string; name: string; vars: KV[]; secrets: KV[] };

export type HttpResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  size: number;
  durationMs: number;
};

export type SendError =
  | { kind: "cancelled" }
  | { kind: "timeout"; afterMs: number }
  | { kind: "connection"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "unresolved"; names: string[] };

export type HistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: Method;
  url: string;
  at: number;
  /** Headers Tether sent, with credentials masked. */
  requestHeaders?: [string, string][];
  response?: HttpResponse;
  error?: SendError;
};

export type Workspace = {
  collections: Collection[];
  environments: Environment[];
  activeEnvId: string | null;
  history: HistoryEntry[];
};

export const uid = () => crypto.randomUUID().slice(0, 8);

export const slug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "request";

export function findRequest(ws: Workspace, id: string) {
  for (const c of ws.collections) {
    const r = c.requests.find((r) => r.id === id);
    if (r) return r;
  }
}

export function allRequests(ws: Workspace) {
  return ws.collections.flatMap((c) => c.requests.map((r) => ({ collection: c, request: r })));
}

export function lastResponse(ws: Workspace, requestId: string) {
  return ws.history.find((h) => h.requestId === requestId && h.response)?.response;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function demoWorkspace(): Workspace {
  const login: RequestDef = {
    id: uid(),
    name: "Create session",
    method: "POST",
    url: "{{base_url}}/post",
    headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
    body: '{\n  "user": "demo-user",\n  "token": "example-token-0000"\n}',
  };
  const profile: RequestDef = {
    id: uid(),
    name: "Fetch profile",
    method: "GET",
    url: "{{base_url}}/get?user={{@create_session.body.json.user}}",
    headers: [{ key: "Authorization", value: "Bearer {{@create_session.body.json.token}}", enabled: true }],
    body: "",
  };
  const status: RequestDef = {
    id: uid(),
    name: "Simulate server error",
    method: "GET",
    url: "{{base_url}}/status/503",
    headers: [],
    body: "",
  };
  return {
    collections: [{ id: uid(), name: "Example (httpbin.org)", requests: [login, profile, status] }],
    environments: [
      { id: "env-demo", name: "Demo", vars: [{ key: "base_url", value: "https://httpbin.org", enabled: true }], secrets: [] },
    ],
    activeEnvId: "env-demo",
    history: [],
  };
}
