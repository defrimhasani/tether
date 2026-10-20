import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: (...a: unknown[]) => invoke(...a) }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});

const { loadSecrets, saveSecrets, saveWorkspace, loadWorkspace } = await import("./storage");
const { demoWorkspace } = await import("./model");
const kv = (key: string, value = "v") => [{ key, value, enabled: true }];

beforeEach(() => {
  invoke.mockReset();
  store.clear();
});

describe("secret storage (desktop)", () => {
  it("never writes secrets into the workspace store", () => {
    const ws = demoWorkspace();
    ws.environments[0].secrets = kv("api_key", "s3cret");
    saveWorkspace(ws);
    expect(store.get("tether.workspace.v1")).not.toContain("s3cret");
    expect(loadWorkspace().environments[0].secrets).toEqual([]);
  });

  it("migrates legacy localStorage secrets into the Keychain", async () => {
    store.set("tether.secrets.v1", JSON.stringify({ a: kv("x"), b: [] }));
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ a: kv("x") });
    expect(await loadSecrets(["a"])).toEqual({ a: kv("x") });
    expect(invoke.mock.calls).toEqual([
      ["save_secrets", { envId: "a", secrets: kv("x") }],
      ["load_secrets", { envIds: ["a"] }],
    ]);
    expect(store.has("tether.secrets.v1")).toBe(false);
  });

  it("writes only changed environments and deletes removed ones", async () => {
    await saveSecrets({ a: kv("x"), b: kv("y", "new") }, { a: kv("x"), b: kv("y"), c: kv("z") });
    expect(invoke.mock.calls).toEqual([
      ["save_secrets", { envId: "b", secrets: kv("y", "new") }],
      ["delete_secrets", { envId: "c" }],
    ]);
  });
});
