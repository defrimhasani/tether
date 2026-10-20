import { describe, expect, it } from "vitest";
import { fromFiles, toFiles } from "./files";
import { demoWorkspace } from "./model";

describe("workspace files", () => {
  it("round-trips a workspace without secrets", () => {
    const ws = demoWorkspace();
    ws.environments[0].secrets = [{ key: "api_key", value: "s3cret", enabled: true }];
    const files = toFiles(ws);
    expect(Object.values(files).join()).not.toContain("s3cret");
    const { workspace, problems } = fromFiles(files);
    expect(problems).toEqual([]);
    expect(workspace).toEqual({ ...ws, environments: ws.environments.map((e) => ({ ...e, secrets: [] })) });
  });

  it("uses a readable, stable layout", () => {
    const files = toFiles(demoWorkspace());
    expect(Object.keys(files).sort()).toEqual([
      ".tether/history.json",
      ".tether/state.json",
      "collections/example-httpbin-org/collection.json",
      "collections/example-httpbin-org/create-session.json",
      "collections/example-httpbin-org/fetch-profile.json",
      "collections/example-httpbin-org/simulate-server-error.json",
      "environments/demo.json",
      "tether.json",
    ]);
    const req = JSON.parse(files["collections/example-httpbin-org/create-session.json"]);
    expect(Object.keys(req)).toEqual(["id", "name", "method", "url", "headers", "body"]);
    expect(req.body).toEqual(["{", '  "user": "demo-user",', '  "token": "example-token-0000"', "}"]);
    expect(files["tether.json"].endsWith("}\n")).toBe(true);
  });

  it("is deterministic", () => {
    const ws = demoWorkspace();
    expect(toFiles(ws)).toEqual(toFiles(fromFiles(toFiles(ws)).workspace));
  });

  it("disambiguates colliding directory and file names", () => {
    const ws = demoWorkspace();
    ws.collections.push({ ...ws.collections[0], id: "c2", requests: [] });
    expect(JSON.parse(toFiles(ws)["tether.json"]).collections).toEqual(["example-httpbin-org", "example-httpbin-org-2"]);
  });

  it("picks up files added outside the app and reports broken ones", () => {
    const files = toFiles(demoWorkspace());
    files["collections/example-httpbin-org/added.json"] = JSON.stringify({ id: "new1", name: "Added", method: "put", url: "/x" });
    files["collections/example-httpbin-org/broken.json"] = "{ nope";
    files["collections/teammate/listing.json"] = JSON.stringify({ name: "Listing" });
    const { workspace, problems } = fromFiles(files);
    expect(workspace.collections[0].requests.map((r) => r.name)).toEqual(["Create session", "Fetch profile", "Simulate server error", "Added"]);
    expect(workspace.collections[0].requests[3].method).toBe("PUT");
    expect(workspace.collections[1]).toMatchObject({ name: "teammate", requests: [{ name: "Listing", method: "GET" }] });
    expect(problems).toEqual([expect.stringContaining("broken.json")]);
  });

  it("replaces duplicate ids, e.g. from a copied file", () => {
    const files = toFiles(demoWorkspace());
    files["collections/example-httpbin-org/copy.json"] = files["collections/example-httpbin-org/create-session.json"];
    const { workspace, problems } = fromFiles(files);
    const ids = workspace.collections[0].requests.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(problems[0]).toContain("duplicate id");
  });
});
