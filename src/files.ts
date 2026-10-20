import { compactEntry } from "./body";
import { METHODS, slug, type Collection, type Environment, type HistoryEntry, type KV, type Method, type RequestDef, type Workspace } from "./model";

/**
 * On-disk workspace layout (all JSON, 2-space indented, stable key order):
 *
 *   tether.json                          { version, collections: [dir…] }
 *   collections/<dir>/collection.json    { id, name, requests: [file…] }
 *   collections/<dir>/<file>.json        { id, name, method, url, headers, body }
 *   environments/<file>.json             { id, name, vars }        (secrets live in the Keychain)
 *   .tether/state.json                   { activeEnvId }           (git-ignored)
 *   .tether/history.json                 [HistoryEntry…]           (git-ignored)
 *
 * Multi-line bodies are stored as an array of lines so diffs stay readable.
 */
export type Files = Record<string, string>;

const VERSION = 1;
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function uniqueIn(taken: Set<string>, base: string) {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

const kvOut = (rows: KV[]) => rows.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled }));

export function toFiles(ws: Workspace): Files {
  const files: Files = {};
  const dirs = new Set<string>();
  const order: string[] = [];
  for (const c of ws.collections) {
    const dir = uniqueIn(dirs, slug(c.name).replace(/_/g, "-"));
    order.push(dir);
    const names = new Set(["collection"]);
    const reqFiles: string[] = [];
    for (const r of c.requests) {
      const file = `${uniqueIn(names, slug(r.name).replace(/_/g, "-"))}.json`;
      reqFiles.push(file);
      files[`collections/${dir}/${file}`] = json({
        id: r.id,
        name: r.name,
        method: r.method,
        url: r.url,
        headers: kvOut(r.headers),
        body: r.body.includes("\n") ? r.body.split("\n") : r.body,
      });
    }
    files[`collections/${dir}/collection.json`] = json({ id: c.id, name: c.name, requests: reqFiles });
  }
  files["tether.json"] = json({ version: VERSION, collections: order });

  const envNames = new Set<string>();
  for (const e of ws.environments)
    files[`environments/${uniqueIn(envNames, slug(e.name).replace(/_/g, "-"))}.json`] = json({ id: e.id, name: e.name, vars: kvOut(e.vars) });

  files[".tether/state.json"] = json({ activeEnvId: ws.activeEnvId });
  files[".tether/history.json"] = json(ws.history.map(compactEntry));
  return files;
}

export type LoadResult = { workspace: Workspace; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const kvIn = (v: unknown): KV[] =>
  Array.isArray(v) ? v.filter(isObj).map((r) => ({ key: str(r.key), value: str(r.value), enabled: r.enabled !== false })) : [];

export function hasWorkspace(files: Files) {
  return "tether.json" in files;
}

export function fromFiles(files: Files): LoadResult {
  const problems: string[] = [];
  const parse = (path: string): unknown => {
    try {
      return JSON.parse(files[path]);
    } catch (e) {
      problems.push(`${path}: ${(e as Error).message}`);
      return undefined;
    }
  };

  const root = parse("tether.json");
  const listed = isObj(root) && Array.isArray(root.collections) ? root.collections.map(String) : [];
  const allDirs = [...new Set(Object.keys(files).map((p) => p.match(/^collections\/([^/]+)\//)?.[1]).filter((d): d is string => !!d))];
  // Listed order first, then anything added outside the app (e.g. by a teammate), alphabetically.
  const dirs = [...listed.filter((d) => allDirs.includes(d)), ...allDirs.filter((d) => !listed.includes(d)).sort()];

  const seenIds = new Set<string>();
  const freshId = (id: unknown, path: string) => {
    let v = str(id) || crypto.randomUUID().slice(0, 8);
    if (seenIds.has(v)) {
      problems.push(`${path}: duplicate id “${v}”; assigned a new one`);
      v = crypto.randomUUID().slice(0, 8);
    }
    seenIds.add(v);
    return v;
  };

  const collections: Collection[] = dirs.map((dir) => {
    const metaPath = `collections/${dir}/collection.json`;
    const meta = metaPath in files ? parse(metaPath) : undefined;
    const prefix = `collections/${dir}/`;
    const present = Object.keys(files).filter((p) => p.startsWith(prefix) && p !== metaPath && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length));
    const listedReqs = isObj(meta) && Array.isArray(meta.requests) ? meta.requests.map(String) : [];
    const order = [...listedReqs.filter((f) => present.includes(f)), ...present.filter((f) => !listedReqs.includes(f)).sort()];
    const requests: RequestDef[] = [];
    for (const file of order) {
      const path = prefix + file;
      const r = parse(path);
      if (!isObj(r)) {
        if (r !== undefined) problems.push(`${path}: expected an object`);
        continue;
      }
      const method = str(r.method).toUpperCase();
      requests.push({
        id: freshId(r.id, path),
        name: str(r.name, file.replace(/\.json$/, "")),
        method: (METHODS as readonly string[]).includes(method) ? (method as Method) : "GET",
        url: str(r.url),
        headers: kvIn(r.headers),
        body: Array.isArray(r.body) ? r.body.map(String).join("\n") : str(r.body),
      });
    }
    return { id: freshId(isObj(meta) ? meta.id : undefined, metaPath), name: isObj(meta) ? str(meta.name, dir) : dir, requests };
  });

  const environments: Environment[] = Object.keys(files)
    .filter((p) => /^environments\/[^/]+\.json$/.test(p))
    .sort()
    .flatMap((path) => {
      const e = parse(path);
      if (!isObj(e)) return [];
      return [{ id: freshId(e.id, path), name: str(e.name, path.slice(13, -5)), vars: kvIn(e.vars), secrets: [] }];
    });

  const state = ".tether/state.json" in files ? parse(".tether/state.json") : undefined;
  const wanted = isObj(state) ? str(state.activeEnvId) : "";
  const history = ".tether/history.json" in files ? parse(".tether/history.json") : [];

  return {
    workspace: {
      collections,
      environments,
      activeEnvId: environments.some((e) => e.id === wanted) ? wanted : environments[0]?.id ?? null,
      history: Array.isArray(history) ? (history as HistoryEntry[]) : [],
    },
    problems,
  };
}
