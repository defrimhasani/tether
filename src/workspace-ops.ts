import { slug, uid, type Collection, type RequestDef, type Workspace } from "./model";
import { tokensIn, uniqueName } from "./refs";

const mapCollections = (ws: Workspace, fn: (c: Collection) => Collection): Workspace => ({ ...ws, collections: ws.collections.map(fn) });

export function addCollection(ws: Workspace, name = "New collection"): [Workspace, Collection] {
  const c: Collection = { id: uid(), name, requests: [] };
  return [{ ...ws, collections: [...ws.collections, c] }, c];
}

export function renameCollection(ws: Workspace, id: string, name: string): Workspace {
  return mapCollections(ws, (c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c));
}

export function deleteCollection(ws: Workspace, id: string): Workspace {
  const gone = new Set(ws.collections.find((c) => c.id === id)?.requests.map((r) => r.id));
  return {
    ...ws,
    collections: ws.collections.filter((c) => c.id !== id),
    history: ws.history.filter((h) => !gone.has(h.requestId)),
  };
}

export function addRequest(ws: Workspace, collectionId?: string, init: Partial<RequestDef> = {}): [Workspace, RequestDef] {
  const cols = ws.collections.length ? ws.collections : [{ id: uid(), name: "My collection", requests: [] }];
  const target = collectionId ?? cols[0].id;
  const r: RequestDef = { id: uid(), method: "GET", url: "", headers: [], body: "", ...init, name: "" };
  r.name = uniqueName({ ...ws, collections: cols }, init.name ?? "Untitled request", r.id);
  return [{ ...ws, collections: cols.map((c) => (c.id === target ? { ...c, requests: [...c.requests, r] } : c)) }, r];
}

export function duplicateRequest(ws: Workspace, id: string, source?: RequestDef): [Workspace, RequestDef] | null {
  const c = ws.collections.find((c) => c.requests.some((r) => r.id === id));
  const original = source ?? c?.requests.find((r) => r.id === id);
  if (!c || !original) return null;
  const copy: RequestDef = { ...original, id: uid(), headers: original.headers.map((h) => ({ ...h })), name: "" };
  copy.name = uniqueName(ws, `${original.name} copy`, copy.id);
  const ws2 = mapCollections(ws, (col) => {
    if (col.id !== c.id) return col;
    const i = col.requests.findIndex((r) => r.id === id);
    return { ...col, requests: [...col.requests.slice(0, i + 1), copy, ...col.requests.slice(i + 1)] };
  });
  return [ws2, copy];
}

export function deleteRequest(ws: Workspace, id: string): Workspace {
  return {
    ...mapCollections(ws, (c) => ({ ...c, requests: c.requests.filter((r) => r.id !== id) })),
    history: ws.history.filter((h) => h.requestId !== id),
  };
}

/** Requests that reference `request` and would break if it were deleted. */
export function dependents(ws: Workspace, request: RequestDef) {
  const prefix = `@${slug(request.name)}.`;
  return ws.collections
    .flatMap((c) => c.requests)
    .filter((r) => r.id !== request.id && tokensIn(r).some((t) => t.startsWith(prefix)));
}

/** Moves a request to `index` within `toCollectionId` (index counts positions after removal). */
export function moveRequest(ws: Workspace, id: string, toCollectionId: string, index: number): Workspace {
  const r = ws.collections.flatMap((c) => c.requests).find((r) => r.id === id);
  if (!r) return ws;
  const without = mapCollections(ws, (c) => ({ ...c, requests: c.requests.filter((x) => x.id !== id) }));
  return mapCollections(without, (c) => {
    if (c.id !== toCollectionId) return c;
    const i = Math.max(0, Math.min(index, c.requests.length));
    return { ...c, requests: [...c.requests.slice(0, i), r, ...c.requests.slice(i)] };
  });
}

export function moveCollection(ws: Workspace, id: string, index: number): Workspace {
  const c = ws.collections.find((c) => c.id === id);
  if (!c) return ws;
  const rest = ws.collections.filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(index, rest.length));
  return { ...ws, collections: [...rest.slice(0, i), c, ...rest.slice(i)] };
}
