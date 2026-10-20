import { describe, expect, it } from "vitest";
import { demoWorkspace } from "./model";
import {
  addCollection, addRequest, deleteCollection, deleteRequest, dependents, duplicateRequest, moveCollection, moveRequest, renameCollection,
} from "./workspace-ops";

const names = (ws: ReturnType<typeof demoWorkspace>, i = 0) => ws.collections[i].requests.map((r) => r.name);
const withHistory = () => {
  const ws = demoWorkspace();
  const r = ws.collections[0].requests[0];
  ws.history = [{ id: "h", requestId: r.id, requestName: r.name, method: r.method, url: "", at: 0 }];
  return ws;
};

describe("workspace operations", () => {
  it("adds requests with unique names, creating a collection if none exist", () => {
    const [ws1] = addRequest(demoWorkspace());
    const [, r2] = addRequest(ws1);
    expect(r2.name).toBe("Untitled request 2");
    const [empty, r] = addRequest({ ...demoWorkspace(), collections: [] });
    expect(empty.collections[0].requests).toEqual([r]);
  });

  it("duplicates right after the original with a unique name and new id", () => {
    const ws = demoWorkspace();
    const src = ws.collections[0].requests[0];
    const [out, copy] = duplicateRequest(ws, src.id)!;
    expect(names(out)).toEqual(["Create session", "Create session copy", "Fetch profile", "Simulate server error"]);
    expect(copy.id).not.toBe(src.id);
    expect(duplicateRequest(out, src.id)![1].name).toBe("Create session copy 2");
  });

  it("deletes requests and collections along with their history", () => {
    const ws = withHistory();
    const id = ws.collections[0].requests[0].id;
    const out = deleteRequest(ws, id);
    expect(names(out)).toEqual(["Fetch profile", "Simulate server error"]);
    expect(out.history).toEqual([]);
    expect(deleteCollection(ws, ws.collections[0].id)).toMatchObject({ collections: [], history: [] });
  });

  it("finds requests that depend on a request", () => {
    const ws = demoWorkspace();
    expect(dependents(ws, ws.collections[0].requests[0]).map((r) => r.name)).toEqual(["Fetch profile"]);
    expect(dependents(ws, ws.collections[0].requests[2])).toEqual([]);
  });

  it("moves requests within and across collections", () => {
    let [ws, c2] = addCollection(demoWorkspace(), "Second");
    const [a, , c] = ws.collections[0].requests;
    ws = moveRequest(ws, c.id, ws.collections[0].id, 0);
    expect(names(ws)).toEqual(["Simulate server error", "Create session", "Fetch profile"]);
    ws = moveRequest(ws, a.id, c2.id, 99);
    expect(names(ws)).toEqual(["Simulate server error", "Fetch profile"]);
    expect(names(ws, 1)).toEqual(["Create session"]);
  });

  it("renames and reorders collections", () => {
    let [ws, c2] = addCollection(demoWorkspace(), "Second");
    ws = moveCollection(renameCollection(ws, c2.id, "  "), c2.id, 0);
    expect(ws.collections.map((c) => c.name)).toEqual(["Second", "Example (httpbin.org)"]);
  });
});
