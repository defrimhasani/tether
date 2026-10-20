import { invoke, isTauri } from "@tauri-apps/api/core";
import { compactEntry } from "./body";
import { demoWorkspace, type KV, type Workspace } from "./model";

const STORE = "tether.workspace.v1";
const LEGACY_SECRETS = "tether.secrets.v1";

type SecretMap = Record<string, KV[]>;

/** Loads the shareable workspace synchronously; secrets arrive later via `loadSecrets`. */
export function loadWorkspace(): Workspace {
  try {
    const ws = JSON.parse(localStorage.getItem(STORE) ?? "") as Workspace;
    ws.environments = ws.environments.map((e) => ({ ...e, secrets: [] }));
    return ws;
  } catch {
    return demoWorkspace();
  }
}

export function saveWorkspace(ws: Workspace) {
  const shareable = { ...ws, environments: ws.environments.map((e) => ({ ...e, secrets: [] })), history: ws.history.map(compactEntry) };
  localStorage.setItem(STORE, JSON.stringify(shareable));
}

const legacy = (): SecretMap | null => {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_SECRETS) ?? "null");
  } catch {
    return null;
  }
};

/**
 * Desktop: reads secrets from the macOS Keychain, first migrating any secrets an earlier
 * version left in localStorage. Browser preview: localStorage (no Keychain available).
 */
export async function loadSecrets(envIds: string[]): Promise<SecretMap> {
  if (!isTauri()) return legacy() ?? {};
  const old = legacy();
  if (old) {
    for (const [envId, secrets] of Object.entries(old)) if (secrets.length) await invoke("save_secrets", { envId, secrets });
    localStorage.removeItem(LEGACY_SECRETS);
  }
  return invoke<SecretMap>("load_secrets", { envIds });
}

/** Writes only environments whose secrets changed since `prev`, and removes deleted ones. */
export async function saveSecrets(next: SecretMap, prev: SecretMap) {
  if (!isTauri()) {
    localStorage.setItem(LEGACY_SECRETS, JSON.stringify(next));
    return;
  }
  for (const [envId, secrets] of Object.entries(next))
    if (JSON.stringify(secrets) !== JSON.stringify(prev[envId] ?? [])) await invoke("save_secrets", { envId, secrets });
  for (const envId of Object.keys(prev)) if (!(envId in next)) await invoke("delete_secrets", { envId });
}

export const secretsOf = (ws: Workspace): SecretMap => Object.fromEntries(ws.environments.map((e) => [e.id, e.secrets]));
