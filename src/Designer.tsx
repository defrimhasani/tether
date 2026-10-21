import { invoke, isTauri } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy, Plus, Radio, Square, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  KINDS, OPS, SCHEMA_REF, addOperation, addProperty, addSchema, deleteOperation, deleteSchema, getIn, isObj, kindOf, listOperations, mockRoutes, moveOperation, parseSpec,
  refName, removeProperty, renameProperty, renameSchema, schemaNames, schemaUsage, serverUrl, setIn, setRequired, stringifySpec, validateSpec, withKind,
  type Issue, type Kind, type Obj, type OpMethod, type Where,
} from "./design";
import type { ApiDesign } from "./model";

const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

type Sel = { kind: "info" } | { kind: "op"; method: OpMethod; path: string } | { kind: "schema"; name: string };
const sameSel = (a: Sel, b: Sel) => JSON.stringify(a) === JSON.stringify(b);

/** A text field that applies its value on blur or Enter, so renames don't fire on every keystroke. */
function CommitInput({ value, onCommit, label, className, placeholder, mono }: { value: string; onCommit: (v: string) => void; label: string; className?: string; placeholder?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => v !== value && onCommit(v);
  return (
    <input
      className={`dz-input ${mono ? "mono" : ""} ${className ?? ""}`} value={v} aria-label={label} placeholder={placeholder} spellCheck={false}
      onChange={(e) => setV(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(value); e.currentTarget.blur(); } }}
    />
  );
}

/* ——— Mock server ——— */

type Hit = { method: string; path: string; status: number; matched: string | null; at: number };
let mockOwner: string | null = null;

function useMock(designId: string, doc: Obj, enabled: boolean) {
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const routes = useMemo(() => mockRoutes(doc), [doc]);
  const key = JSON.stringify(routes);

  useEffect(() => {
    if (!isTauri() || !enabled) return;
    let off: (() => void) | undefined;
    invoke<number | null>("mock_status").then((p) => { if (p) setPort(p); }).catch(() => {});
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<Omit<Hit, "at">>("mock-hit", (e) => setHits((h) => [{ ...e.payload, at: Date.now() }, ...h].slice(0, 30))).then((u) => (off = u)));
    return () => off?.();
  }, [enabled]);

  const start = async (p: number) => {
    setError(null);
    try {
      const used = await invoke<number>("mock_start", { routes, port: p });
      mockOwner = designId;
      setPort(used);
    } catch (e) { setError(String(e)); setPort(null); }
  };
  const stop = async () => { await invoke("mock_stop"); mockOwner = null; setPort(null); };

  // Keep the running mock in step with edits to the design.
  useEffect(() => {
    if (port === null || mockOwner !== designId) return;
    const t = setTimeout(() => { invoke("mock_start", { routes, port }).catch((e) => setError(String(e))); }, 350);
    return () => clearTimeout(t);
    // Restart only when the routes themselves change.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { port, error, hits, start, stop, count: routes.length, running: port !== null, owned: port !== null && mockOwner === designId };
}

/* ——— Schema editor ——— */

const PRIMITIVES: Kind[] = ["string", "integer", "number", "boolean"];

function SchemaEditor({ node, onChange, schemas, self }: { node: Obj; onChange: (n: Obj) => void; schemas: string[]; self?: string }) {
  const kind = kindOf(node);
  const choices = schemas.filter((s) => s !== self);
  const setKind = (k: Kind) => onChange(withKind(node, k, k === "ref" ? choices[0] ?? "" : ""));
  return (
    <div className="dz-schema">
      <div className="dz-kind">
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Type">
          {KINDS.map((k) => <option key={k} value={k} disabled={k === "ref" && !choices.length}>{k === "ref" ? "schema…" : k}</option>)}
        </select>
        {kind === "ref" && (
          <select value={refName(node)} onChange={(e) => onChange({ $ref: `${SCHEMA_REF}${e.target.value}` })} aria-label="Schema">
            {!choices.includes(refName(node)) && <option value={refName(node)}>{refName(node) || "choose…"}</option>}
            {choices.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {PRIMITIVES.includes(kind) && (
          <CommitInput label="Example" placeholder="example" mono value={node.example === undefined ? "" : String(node.example)}
            onCommit={(v) => onChange(setIn(node, ["example"], v === "" ? undefined : kind === "integer" || kind === "number" ? (Number.isNaN(Number(v)) ? v : Number(v)) : kind === "boolean" ? v === "true" : v))} />
        )}
        {kind !== "ref" && <CommitInput label="Description" placeholder="description" className="grow" value={str(node.description)} onCommit={(v) => onChange(setIn(node, ["description"], v || undefined))} />}
      </div>

      {kind === "object" && (
        <div className="dz-props">
          {Object.entries(obj(node.properties)).map(([name, prop], i) => (
            <div className="dz-prop" key={i}>
              <div className="dz-prop-head">
                <CommitInput label="Property name" mono value={name} onCommit={(v) => v.trim() && !(v in obj(node.properties)) && onChange(renameProperty(node, name, v.trim()))} />
                <label className="dz-check"><input type="checkbox" checked={arr(node.required).includes(name)} onChange={(e) => onChange(setRequired(node, name, e.target.checked))} /> required</label>
                <button className="icon" aria-label={`Remove ${name}`} onClick={() => onChange(removeProperty(node, name))}><Trash2 size={13} /></button>
              </div>
              <SchemaEditor node={obj(prop)} schemas={schemas} self={self} onChange={(n) => onChange(setIn(node, ["properties", name], n))} />
            </div>
          ))}
          <button className="ghost small" onClick={() => {
            let n = "property"; for (let i = 2; n in obj(node.properties); i++) n = `property${i}`;
            onChange(addProperty(node, n));
          }}><Plus size={12} /> Add property</button>
        </div>
      )}
      {kind === "array" && (
        <div className="dz-props">
          <p className="dz-sub">Items</p>
          <SchemaEditor node={obj(node.items)} schemas={schemas} self={self} onChange={(n) => onChange({ ...node, items: n })} />
        </div>
      )}
    </div>
  );
}

/* ——— Editors ——— */

type DocProps = { doc: Obj; setDoc: (d: Obj) => void };

function InfoEditor({ doc, setDoc }: DocProps) {
  const info = obj(doc.info);
  const servers = arr(doc.servers).map((s) => str(obj(s).url));
  const scheme = Object.entries(obj(obj(doc.components).securitySchemes))[0];
  const authKind = !scheme ? "none" : obj(scheme[1]).type === "apiKey" ? "apikey" : "bearer";
  const setAuth = (k: string) => {
    const withScheme = setIn(doc, ["components", "securitySchemes"], k === "none" ? undefined : k === "bearer" ? { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } : { apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } });
    setDoc(setIn(withScheme, ["security"], k === "none" ? undefined : [{ [k === "bearer" ? "bearerAuth" : "apiKeyAuth"]: [] }]));
  };
  return (
    <div className="dz-form">
      <h2>Overview</h2>
      <label><span>Title</span><CommitInput label="Title" value={str(info.title)} onCommit={(v) => setDoc(setIn(doc, ["info", "title"], v))} /></label>
      <label><span>Version</span><CommitInput label="Version" mono value={str(info.version)} onCommit={(v) => setDoc(setIn(doc, ["info", "version"], v))} /></label>
      <label className="top"><span>Description</span>
        <textarea className="dz-input" rows={3} value={str(info.description)} aria-label="Description" onChange={(e) => setDoc(setIn(doc, ["info", "description"], e.target.value || undefined))} />
      </label>
      <h3>Servers</h3>
      {servers.map((u, i) => (
        <div className="dz-row" key={i}>
          <CommitInput label={`Server ${i + 1}`} mono className="grow" value={u} onCommit={(v) => setDoc(setIn(doc, ["servers", i, "url"], v))} />
          <button className="icon" aria-label="Remove server" onClick={() => setDoc(setIn(doc, ["servers", i], undefined))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="ghost small" onClick={() => setDoc(setIn(doc, ["servers"], [...arr(doc.servers), { url: "https://api.example.com" }]))}><Plus size={12} /> Add server</button>
      <h3>Authentication</h3>
      <div className="dz-row">
        <select value={authKind} onChange={(e) => setAuth(e.target.value)} aria-label="Authentication">
          <option value="none">None</option><option value="bearer">Bearer token</option><option value="apikey">API key in a header</option>
        </select>
        {authKind === "apikey" && scheme && (
          <CommitInput label="Header name" mono value={str(obj(scheme[1]).name)} onCommit={(v) => setDoc(setIn(doc, ["components", "securitySchemes", scheme[0], "name"], v))} />
        )}
      </div>
      <p className="dz-hint">Applies to every endpoint. Generated requests get an Authorization or API-key header with a variable to fill in.</p>
    </div>
  );
}

const COMMON_CODES = ["200", "201", "202", "204", "400", "401", "403", "404", "409", "422", "429", "500"];

function OpEditor({ doc, setDoc, method, path, schemas, onMoved }: DocProps & { method: OpMethod; path: string; schemas: string[]; onMoved: (s: Sel) => void }) {
  const op = obj(obj(obj(doc.paths)[path])[method]);
  const base = ["paths", path, method];
  const put = (sub: (string | number)[], v: unknown) => setDoc(setIn(doc, [...base, ...sub], v));
  const params = arr(op.parameters);
  const responses = obj(op.responses);
  const hasBody = ["post", "put", "patch"].includes(method);
  const body = getIn(op, ["requestBody", "content", "application/json", "schema"]);
  const jsonSchema = (r: unknown) => getIn(r, ["content", "application/json", "schema"]);

  return (
    <div className="dz-form">
      <div className="dz-op-head">
        <select value={method} aria-label="Method" className={`m-${method.toUpperCase()}`}
          onChange={(e) => { const m = e.target.value as OpMethod; if (!obj(obj(doc.paths)[path])[m]) { setDoc(moveOperation(doc, { method, path }, { method: m, path })); onMoved({ kind: "op", method: m, path }); } }}>
          {OPS.map((m) => <option key={m} value={m} disabled={m !== method && isObj(obj(obj(doc.paths)[path])[m])}>{m.toUpperCase()}</option>)}
        </select>
        <CommitInput label="Path" mono className="grow" value={path} onCommit={(v) => {
          const to = v.startsWith("/") ? v : `/${v}`;
          if (to === path || isObj(obj(obj(doc.paths)[to])[method])) return;
          setDoc(moveOperation(doc, { method, path }, { method, path: to }));
          onMoved({ kind: "op", method, path: to });
        }} />
        <button className="ghost small danger-text" onClick={() => { setDoc(deleteOperation(doc, method, path)); onMoved({ kind: "info" }); }}><Trash2 size={12} /> Delete</button>
      </div>
      <label><span>Summary</span><CommitInput label="Summary" value={str(op.summary)} onCommit={(v) => put(["summary"], v || undefined)} /></label>
      <label><span>Operation ID</span><CommitInput label="Operation ID" mono value={str(op.operationId)} placeholder="listPets" onCommit={(v) => put(["operationId"], v || undefined)} /></label>
      <label><span>Tag</span><CommitInput label="Tag" value={str(arr(op.tags)[0])} placeholder="pets" onCommit={(v) => put(["tags"], v.trim() ? [v.trim()] : undefined)} /></label>
      <label className="top"><span>Description</span><textarea className="dz-input" rows={2} value={str(op.description)} aria-label="Description" onChange={(e) => put(["description"], e.target.value || undefined)} /></label>

      <h3>Parameters</h3>
      {params.length === 0 && <p className="dz-hint">No parameters.{method === "get" ? " Add query filters like limit or page." : ""}</p>}
      {params.map((raw, i) => {
        const p = obj(raw);
        if (typeof p.$ref === "string") return <div className="dz-row" key={i}><code>{p.$ref}</code></div>;
        const type = str(obj(p.schema).type) || "string";
        return (
          <div className="dz-row dz-param" key={i}>
            <CommitInput label="Parameter name" mono value={str(p.name)} onCommit={(v) => put(["parameters", i, "name"], v)} />
            <select value={str(p.in)} aria-label="Location" onChange={(e) => setDoc(setIn(setIn(doc, [...base, "parameters", i, "in"], e.target.value), [...base, "parameters", i, "required"], e.target.value === "path" ? true : p.required))}>
              {["path", "query", "header", "cookie"].map((x) => <option key={x}>{x}</option>)}
            </select>
            <select value={type} aria-label="Type" onChange={(e) => put(["parameters", i, "schema"], { type: e.target.value })}>
              {PRIMITIVES.map((x) => <option key={x}>{x}</option>)}
            </select>
            <label className="dz-check"><input type="checkbox" disabled={p.in === "path"} checked={p.required === true} onChange={(e) => put(["parameters", i, "required"], e.target.checked)} /> required</label>
            <button className="icon" aria-label="Remove parameter" onClick={() => put(["parameters", i], undefined)}><Trash2 size={13} /></button>
          </div>
        );
      })}
      <button className="ghost small" onClick={() => put(["parameters"], [...params, { name: "limit", in: "query", required: false, schema: { type: "integer" } }])}><Plus size={12} /> Add parameter</button>

      {hasBody && (
        <>
          <h3>Request body</h3>
          {body === undefined ? (
            <button className="ghost small" onClick={() => put(["requestBody"], { required: true, content: { "application/json": { schema: { type: "object", properties: {} } } } })}><Plus size={12} /> Add JSON body</button>
          ) : (
            <div className="dz-card">
              <div className="dz-card-head"><span>application/json</span><button className="icon" aria-label="Remove body" onClick={() => put(["requestBody"], undefined)}><Trash2 size={13} /></button></div>
              <SchemaEditor node={obj(body)} schemas={schemas} onChange={(n) => put(["requestBody", "content", "application/json", "schema"], n)} />
            </div>
          )}
        </>
      )}

      <h3>Responses</h3>
      {Object.entries(responses).map(([code, raw]) => {
        const r = obj(raw);
        const schema = jsonSchema(r);
        return (
          <div className="dz-card" key={code}>
            <div className="dz-card-head">
              <span className={`dz-code c${code[0]}`}>{code}</span>
              <CommitInput label={`Description for ${code}`} className="grow" value={str(r.description)} placeholder="Description" onCommit={(v) => put(["responses", code, "description"], v)} />
              <button className="icon" aria-label={`Remove ${code}`} onClick={() => put(["responses", code], undefined)}><Trash2 size={13} /></button>
            </div>
            {schema === undefined ? (
              <button className="ghost small" onClick={() => put(["responses", code, "content"], { "application/json": { schema: { type: "object", properties: {} } } })}><Plus size={12} /> Add JSON body</button>
            ) : (
              <>
                <SchemaEditor node={obj(schema)} schemas={schemas} onChange={(n) => put(["responses", code, "content", "application/json", "schema"], n)} />
                <button className="ghost small" onClick={() => put(["responses", code, "content"], undefined)}>Remove body</button>
              </>
            )}
          </div>
        );
      })}
      <select className="dz-add" value="" aria-label="Add response" onChange={(e) => e.target.value && put(["responses", e.target.value], { description: e.target.value.startsWith("2") ? "Success" : "Error" })}>
        <option value="">Add response…</option>
        {COMMON_CODES.filter((c) => !(c in responses)).map((c) => <option key={c}>{c}</option>)}
      </select>
    </div>
  );
}

function SchemaPage({ doc, setDoc, name, schemas, onMoved }: DocProps & { name: string; schemas: string[]; onMoved: (s: Sel) => void }) {
  const schema = obj(obj(obj(doc.components).schemas)[name]);
  const used = schemaUsage(doc, name);
  return (
    <div className="dz-form">
      <h2>Schema</h2>
      <div className="dz-op-head">
        <CommitInput label="Schema name" mono className="grow" value={name} onCommit={(v) => {
          const n = v.trim().replace(/[^A-Za-z0-9_.-]/g, "");
          if (!n || schemas.includes(n)) return;
          setDoc(renameSchema(doc, name, n)); onMoved({ kind: "schema", name: n });
        }} />
        <button className="ghost small danger-text" onClick={() => { setDoc(deleteSchema(doc, name)); onMoved({ kind: "info" }); }}><Trash2 size={12} /> Delete</button>
      </div>
      <p className="dz-hint">{used ? `Used in ${used} place${used === 1 ? "" : "s"}; renaming updates them all.` : "Not used anywhere yet."}</p>
      <SchemaEditor node={schema} schemas={schemas} self={name} onChange={(n) => setDoc(setIn(doc, ["components", "schemas", name], n))} />
    </div>
  );
}

/* ——— The designer ——— */

export function Designer({
  design, onSpec, onRename, onGenerate, onUseMock, hasCollection, canRun,
}: {
  design: ApiDesign;
  onSpec: (spec: string) => void;
  onRename: (name: string) => void;
  onGenerate: (mockBase: string) => void;
  onUseMock: (mockBase: string) => void;
  hasCollection: boolean;
  canRun: boolean;
}) {
  const parsed = useMemo(() => parseSpec(design.spec), [design.spec]);
  const doc = parsed.doc;
  const issues = useMemo(() => (parsed.error ? [] : validateSpec(doc)), [doc, parsed.error]);
  const ops = useMemo(() => listOperations(doc), [doc]);
  const schemas = useMemo(() => schemaNames(doc), [doc]);
  const [sel, setSel] = useState<Sel>({ kind: "info" });
  const [showSpec, setShowSpec] = useState(true);
  const [showIssues, setShowIssues] = useState(false);
  const [adding, setAdding] = useState<{ method: OpMethod; path: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [portText, setPortText] = useState("4010");
  const mock = useMock(design.id, doc, canRun);
  const errors = issues.filter((i) => i.level === "error").length;

  const setDoc = (d: Obj) => onSpec(stringifySpec(d));
  const go = (w: Where) => setSel(w.kind === "info" ? { kind: "info" } : w);
  const mockBase = `http://127.0.0.1:${mock.port ?? (Number(portText) || 4010)}`;

  // If the selected item disappears (edited in YAML, or deleted), fall back to the overview.
  useEffect(() => {
    if (sel.kind === "op" && !isObj(obj(obj(doc.paths)[sel.path])[sel.method])) setSel({ kind: "info" });
    if (sel.kind === "schema" && !schemas.includes(sel.name)) setSel({ kind: "info" });
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const UNTAGGED = "Untagged";
  const groups = useMemo(() => {
    const g = new Map<string, typeof ops>();
    for (const o of ops) { const t = str(arr(o.op.tags)[0]) || UNTAGGED; g.set(t, [...(g.get(t) ?? []), o]); }
    return [...g];
  }, [ops]);

  const addEndpoint = () => {
    if (!adding || !adding.path.trim()) return;
    const path = adding.path.startsWith("/") ? adding.path : `/${adding.path}`;
    if (isObj(obj(obj(doc.paths)[path])[adding.method])) { setSel({ kind: "op", method: adding.method, path }); setAdding(null); return; }
    setDoc(addOperation(doc, adding.method, path));
    setSel({ kind: "op", method: adding.method, path });
    setAdding(null);
  };
  const addNewSchema = () => {
    let n = "NewSchema"; for (let i = 2; schemas.includes(n); i++) n = `NewSchema${i}`;
    setDoc(addSchema(doc, n));
    setSel({ kind: "schema", name: n });
  };

  return (
    <div className="designer">
      <div className="dz-bar">
        <input className="title dz-title" value={design.name} size={Math.max(8, design.name.length + 1)} onChange={(e) => onRename(e.target.value)} aria-label="Design name" spellCheck={false} />
        <span className="dz-version">OpenAPI {str(doc.openapi) || "3.x"}</span>
        <span className="spacer" />
        <button className={`dz-chip ${errors ? "bad" : issues.length ? "warn" : "ok"}`} onClick={() => setShowIssues((s) => !s)} disabled={parsed.error !== undefined || issues.length === 0} aria-expanded={showIssues}>
          {parsed.error ? <><AlertTriangle size={12} /> YAML error</> : issues.length === 0 ? <><Check size={12} /> Valid</> : <><AlertTriangle size={12} /> {issues.length} {issues.length === 1 ? "problem" : "problems"}</>}
        </button>
        <button className="ghost small" disabled={parsed.error !== undefined || ops.length === 0} onClick={() => onGenerate(mockBase)} title={hasCollection ? "Add requests for new endpoints" : "Create a collection of requests from this design"}>
          <Wand2 size={13} /> {hasCollection ? "Update requests" : "Generate requests"}
        </button>
        <button className="ghost small" onClick={async () => { await navigator.clipboard.writeText(design.spec); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy YAML"}
        </button>
        <button className="ghost small" onClick={() => setShowSpec((s) => !s)} aria-pressed={showSpec}>Spec</button>
      </div>

      <div className={`dz-mock ${mock.running ? "on" : ""}`}>
        <Radio size={13} aria-hidden />
        {!canRun ? (
          <span className="muted">Mock server: available in the desktop app.</span>
        ) : mock.running ? (
          <>
            <span><b>Mock running</b> at <code>{`http://127.0.0.1:${mock.port}`}</code>{!mock.owned && <em> (for another design)</em>}</span>
            <button className="ghost small" onClick={() => navigator.clipboard.writeText(`http://127.0.0.1:${mock.port}`)}><Copy size={12} /> Copy URL</button>
            {mock.owned
              ? <button className="ghost small" onClick={() => onUseMock(`http://127.0.0.1:${mock.port}`)}>Use in requests</button>
              : <button className="ghost small" onClick={() => mock.start(mock.port ?? 0)}>Serve this design instead</button>}
            <button className="ghost small" onClick={mock.stop}><Square size={11} fill="currentColor" /> Stop</button>
          </>
        ) : (
          <>
            <span>Serve example responses from this design on your machine.</span>
            <label className="dz-port">Port <input value={portText} inputMode="numeric" aria-label="Mock port" onChange={(e) => setPortText(e.target.value.replace(/\D/g, ""))} /></label>
            <button className="ghost small" disabled={parsed.error !== undefined || mock.count === 0} onClick={() => mock.start(Number(portText) || 0)}>Start mock</button>
          </>
        )}
        {mock.error && <span className="bad">{mock.error}</span>}
      </div>
      {mock.running && mock.hits.length > 0 && (
        <div className="dz-hits" aria-label="Mock requests">
          {mock.hits.slice(0, 4).map((h, i) => (
            <span key={`${h.at}-${i}`}><b className={`c${String(h.status)[0]}`}>{h.status}</b> {h.method} {h.path}{h.matched ? "" : " (no route)"}</span>
          ))}
        </div>
      )}

      {showIssues && issues.length > 0 && (
        <ul className="dz-issues">
          {issues.map((i: Issue, n) => <li key={n}><button className={i.level} onClick={() => go(i.where)}>{i.level === "error" ? "Error" : "Warning"}</button> {i.message}</li>)}
        </ul>
      )}

      <div className={`dz-body ${showSpec ? "with-spec" : ""}`}>
        <nav className="dz-outline" aria-label="Design outline">
          <button className="dz-item" aria-current={sel.kind === "info"} onClick={() => setSel({ kind: "info" })}>Overview</button>
          <div className="dz-section"><span>Endpoints</span>
            <button className="icon" aria-label="Add endpoint" onClick={() => setAdding(adding ? null : { method: "get", path: "/" })}><Plus size={13} /></button>
          </div>
          {adding && (
            <form className="dz-add-row" onSubmit={(e) => { e.preventDefault(); addEndpoint(); }}>
              <select value={adding.method} aria-label="Method" onChange={(e) => setAdding({ ...adding, method: e.target.value as OpMethod })}>{OPS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select>
              <input autoFocus value={adding.path} aria-label="Path" className="mono" onChange={(e) => setAdding({ ...adding, path: e.target.value })} placeholder="/pets/{id}" onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
              <button type="submit" className="ghost small">Add</button>
            </form>
          )}
          {ops.length === 0 && !adding && <p className="dz-hint pad">No endpoints yet.</p>}
          {groups.map(([tag, list]) => (
            <div key={tag}>
              {groups.length > 1 && <p className="dz-tag">{tag}<span>{list.length}</span></p>}
              {list.map((o) => {
                const s: Sel = { kind: "op", method: o.method, path: o.path };
                const broken = issues.some((i) => i.level === "error" && i.where.kind === "op" && i.where.method === o.method && i.where.path === o.path);
                return (
                  <button key={`${o.method} ${o.path}`} className="dz-item op" title={str(o.op.summary) || undefined} aria-current={sameSel(sel, s)} onClick={() => setSel(s)}>
                    <b className={`m m-${o.method.toUpperCase()}`}>{o.method === "delete" ? "DEL" : o.method.toUpperCase().slice(0, 4)}</b>
                    <span className="mono">{o.path}</span>{broken && <i className="dz-dot" title="Has errors" />}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="dz-section"><span>Schemas</span><button className="icon" aria-label="Add schema" onClick={addNewSchema}><Plus size={13} /></button></div>
          {schemas.length === 0 && <p className="dz-hint pad">Reusable shapes like Pet or Error.</p>}
          {schemas.map((n) => (
            <button key={n} className="dz-item" aria-current={sel.kind === "schema" && sel.name === n} onClick={() => setSel({ kind: "schema", name: n })}><span className="mono">{n}</span></button>
          ))}
        </nav>

        <section className="dz-editor" aria-label="Editor">
          {parsed.error ? (
            <div className="dz-broken"><AlertTriangle size={18} /><p><b>The YAML can’t be read.</b></p><p className="mono">{parsed.error}</p><p className="muted">Fix it in the spec pane, and the visual editor comes back.</p></div>
          ) : sel.kind === "info" ? (
            <InfoEditor doc={doc} setDoc={setDoc} />
          ) : sel.kind === "op" ? (
            <OpEditor doc={doc} setDoc={setDoc} method={sel.method} path={sel.path} schemas={schemas} onMoved={setSel} />
          ) : (
            <SchemaPage doc={doc} setDoc={setDoc} name={sel.name} schemas={schemas} onMoved={setSel} />
          )}
        </section>

        {showSpec && (
          <section className="dz-spec" aria-label="Spec">
            <textarea value={design.spec} spellCheck={false} aria-label="OpenAPI spec (YAML)" onChange={(e) => onSpec(e.target.value)} />
            {parsed.error && <p className="dz-err">{parsed.error}</p>}
            {!parsed.error && serverUrl(doc) === "" && <p className="dz-hint pad">Tip: add a server so generated requests know where to send.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
