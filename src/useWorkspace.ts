import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromFiles, hasWorkspace, toFiles, type Files } from "./files";
import type { KV, Workspace } from "./model";
import { loadSecrets, loadWorkspace, saveSecrets, saveWorkspace, secretsOf } from "./storage";

const FOLDER = "tether.folder";

const canonical = (f: Files) => JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]]));
const readFolder = (dir: string) => invoke<Files>("read_workspace", { dir });

export type Notice = { tone: "info" | "error"; text: string };

/**
 * Owns the workspace and where it lives: a folder of Git-friendly files (desktop) or
 * localStorage (browser preview, or before a folder is chosen). Secrets always go to the
 * Keychain. Nothing is written until the initial load finishes.
 */
export function useWorkspace() {
  const [ws, setWs] = useState<Workspace>(loadWorkspace);
  const [folder, setFolder] = useState<string | null>(() => (isTauri() ? localStorage.getItem(FOLDER) : null));
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const savedSecrets = useRef<Record<string, KV[]>>({});
  const lastWritten = useRef<string | null>(null);

  const report = (problems: string[]) =>
    problems.length && setNotice({ tone: "error", text: `Skipped ${problems.length} unreadable file${problems.length > 1 ? "s" : ""}: ${problems.join("; ")}` });

  /** Replaces the in-memory workspace, then attaches its secrets from the Keychain. */
  const hydrate = useCallback(async (next: Workspace) => {
    setReady(false);
    const map = await loadSecrets(next.environments.map((e) => e.id));
    savedSecrets.current = map;
    setWs({ ...next, environments: next.environments.map((e) => ({ ...e, secrets: map[e.id] ?? [] })) });
    setReady(true);
  }, []);

  const loadFolder = useCallback(async (dir: string) => {
    const files = await readFolder(dir);
    lastWritten.current = canonical(files);
    const { workspace, problems } = fromFiles(files);
    report(problems);
    await hydrate(workspace);
  }, [hydrate]);

  // Initial load.
  useEffect(() => {
    const start = folder
      ? loadFolder(folder).catch((e) => {
          setNotice({ tone: "error", text: `Couldn’t open ${folder}: ${e}. Using the workspace stored in the app.` });
          setFolder(null);
          localStorage.removeItem(FOLDER);
          return hydrate(loadWorkspace());
        })
      : hydrate(loadWorkspace());
    start.catch((e) => setNotice({ tone: "error", text: `Couldn’t read secrets from the Keychain: ${e}` }));
    // Runs once; later folder changes go through openFolder/closeFolder.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the workspace (debounced for folders, since every keystroke in a saved field would otherwise hit disk).
  useEffect(() => {
    if (!ready) return;
    if (!folder) return saveWorkspace(ws);
    const t = setTimeout(() => {
      const files = toFiles(ws);
      const c = canonical(files);
      if (c === lastWritten.current) return;
      lastWritten.current = c;
      invoke("write_workspace", { dir: folder, files }).catch((e) => setNotice({ tone: "error", text: `Couldn’t save to ${folder}: ${e}` }));
    }, 250);
    return () => clearTimeout(t);
  }, [ws, ready, folder]);

  // Persist secrets.
  useEffect(() => {
    if (!ready) return;
    const next = secretsOf(ws);
    const prev = savedSecrets.current;
    savedSecrets.current = next;
    saveSecrets(next, prev).catch((e) => setNotice({ tone: "error", text: `Couldn’t save secrets to the Keychain: ${e}` }));
  }, [ws, ready]);

  // Pick up edits made outside the app (git pull, another editor) when the window regains focus.
  useEffect(() => {
    if (!folder || !ready) return;
    const check = async () => {
      try {
        const files = await readFolder(folder);
        if (canonical(files) === lastWritten.current) return;
        lastWritten.current = canonical(files);
        const { workspace, problems } = fromFiles(files);
        await hydrate(workspace);
        if (!report(problems)) setNotice({ tone: "info", text: "Reloaded changes made outside Tether." });
      } catch (e) {
        setNotice({ tone: "error", text: `Couldn’t read ${folder}: ${e}` });
      }
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [folder, ready, hydrate]);

  /** Opens a folder: loads it if it already holds a workspace, otherwise saves the current one into it. */
  const openFolder = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Choose a workspace folder" });
    if (typeof dir !== "string") return;
    try {
      const files = await readFolder(dir);
      if (hasWorkspace(files)) {
        await loadFolder(dir);
        setNotice({ tone: "info", text: `Opened workspace in ${dir}.` });
      } else {
        lastWritten.current = null;
        setNotice({ tone: "info", text: `Saved this workspace to ${dir}. Commit it to share; secrets stay in your Keychain.` });
      }
      setFolder(dir);
      localStorage.setItem(FOLDER, dir);
    } catch (e) {
      setNotice({ tone: "error", text: `Couldn’t open ${dir}: ${e}` });
    }
  }, [loadFolder]);

  /** Stops syncing with the folder; the current workspace is kept in the app. */
  const closeFolder = useCallback(() => {
    setFolder(null);
    localStorage.removeItem(FOLDER);
    lastWritten.current = null;
  }, []);

  return { ws, setWs, ready, folder, openFolder, closeFolder, canUseFolders: isTauri(), notice, setNotice };
}
