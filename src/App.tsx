import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  METHODS, allRequests, demoWorkspace, findRequest, formatBytes, slug, uid,
  type HistoryEntry, type KV, type Method, type RequestDef, type SendError, type Workspace,
} from "./model";
import {
  downstreamUses, insertReference, interpolate, renameReferences, resolveToken, suggestTarget, tokensIn, uniqueName,
  type Field, type InsertTarget, type Resolution,
} from "./refs";
import { cancel, send } from "./http";
import { JsonTree } from "./JsonTree";

const STORE = "tether.workspace.v1";
const SECRETS = "tether.secrets.v1";

function load(): Workspace {
  try {
    const ws = JSON.parse(localStorage.getItem(STORE) ?? "") as Workspace;
    const secrets = JSON.parse(localStorage.getItem(SECRETS) ?? "{}") as Record<string, KV[]>;
    ws.environments = ws.environments.map((e) => ({ ...e, secrets: secrets[e.id] ?? [] }));
    return ws;
  } catch {
    return demoWorkspace();
  }
}

function persist(ws: Workspace) {
  // Secrets are stored apart from shareable definitions; a Keychain backend will replace this.
  const shareable = { ...ws, environments: ws.environments.map((e) => ({ ...e, secrets: [] })) };
  localStorage.setItem(STORE, JSON.stringify(shareable));
  localStorage.setItem(SECRETS, JSON.stringify(Object.fromEntries(ws.environments.map((e) => [e.id, e.secrets]))));
}

type Pending = { requestId: string; sendId: string };
type Selection = { token: string; value: string; entryId: string };
type Cursor = { field: Field; pos: number };

export default function App() {
  const [ws, setWs] = useState<Workspace>(load);
  const [activeId, setActiveId] = useState<string | null>(() => ws.collections[0]?.requests[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, RequestDef>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [viewing, setViewing] = useState<string | null>(null); // history entry id
  const [palette, setPalette] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [narrowView, setNarrowView] = useState<"request" | "response">("request");
  const [sidebarTab, setSidebarTab] = useState<"collections" | "history">("collections");
  const [filter, setFilter] = useState("");
  const [split, setSplit] = useState(() => Number(localStorage.getItem("tether.split")) || 0.5);
  const [selectedField, setSelectedField] = useState<Selection | null>(null);
  const cursors = useRef<Record<string, Cursor>>({});
  const recent = useRef<string[]>([]);

  useEffect(() => {
    if (activeId) recent.current = [activeId, ...recent.current.filter((id) => id !== activeId)].slice(0, 20);
  }, [activeId]);

  useEffect(() => persist(ws), [ws]);
  useEffect(() => localStorage.setItem("tether.split", String(split)), [split]);

  const saved = activeId ? findRequest(ws, activeId) : undefined;
  const req = activeId ? drafts[activeId] ?? saved : undefined;
  const dirty = !!(activeId && drafts[activeId]);

  const entry: HistoryEntry | undefined = viewing
    ? ws.history.find((h) => h.id === viewing)
    : ws.history.find((h) => h.requestId === activeId);

  const edit = (patch: Partial<RequestDef>) => req && setDrafts((d) => ({ ...d, [req.id]: { ...req, ...patch } }));

  const save = useCallback(() => {
    if (!activeId || !drafts[activeId]) return;
    const prev = findRequest(ws, activeId);
    const draft = { ...drafts[activeId], name: uniqueName(ws, drafts[activeId].name, activeId) };
    const from = prev ? slug(prev.name) : "";
    const to = slug(draft.name);
    // Keep references to this request working after a rename, in saved requests and open drafts alike.
    const fix = (r: RequestDef) => (prev ? renameReferences(r, from, to) : r);
    setWs((w) => ({
      ...w,
      collections: w.collections.map((c) => ({ ...c, requests: c.requests.map((r) => fix(r.id === draft.id ? draft : r)) })),
    }));
    setDrafts((d) => {
      const next: Record<string, RequestDef> = {};
      for (const [id, r] of Object.entries(d)) if (id !== activeId) next[id] = fix(r);
      return next;
    });
  }, [activeId, drafts, ws]);

  const sendRequest = useCallback(
    async (target: RequestDef) => {
      // Resolve against the live workspace, including unsaved drafts of the target itself.
      const headers = target.headers.filter((h) => h.enabled && h.key.trim());
      const parts = [target.url, target.body, ...headers.flatMap((h) => [h.key, h.value])].map((t) => interpolate(ws, t));
      const unresolved = [...new Set(parts.flatMap((p) => p.unresolved))];
      const base = { id: uid(), requestId: target.id, requestName: target.name, method: target.method, url: parts[0].out, at: Date.now() };
      setViewing(null);
      setNarrowView("response");
      if (unresolved.length) {
        setWs((w) => ({ ...w, history: [{ ...base, error: { kind: "unresolved" as const, names: unresolved } }, ...w.history].slice(0, 200) }));
        return;
      }
      const sendId = base.id;
      setPending({ requestId: target.id, sendId });
      const hdrs: [string, string][] = headers.map((_, i) => [parts[2 + i * 2].out, parts[3 + i * 2].out]);
      const hasBody = !["GET", "HEAD"].includes(target.method) && target.body.trim() !== "";
      let result: Partial<HistoryEntry>;
      try {
        result = { response: await send({ id: sendId, method: target.method, url: parts[0].out, headers: hdrs, body: hasBody ? parts[1].out : undefined }) };
      } catch (e) {
        result = { error: (e && typeof e === "object" && "kind" in e ? e : { kind: "connection", message: String(e) }) as SendError };
      }
      setPending((p) => (p?.sendId === sendId ? null : p));
      setWs((w) => ({ ...w, history: [{ ...base, ...result }, ...w.history].slice(0, 200) }));
    },
    [ws],
  );

  const sendById = (id: string) => {
    const r = drafts[id] ?? findRequest(ws, id);
    if (r) sendRequest(r);
  };

  const addRequest = (collectionId?: string) => {
    const r: RequestDef = { id: uid(), name: "Untitled request", method: "GET", url: "", headers: [], body: "" };
    setWs((w) => {
      const cols = w.collections.length ? w.collections : [{ id: uid(), name: "My collection", requests: [] }];
      const target = collectionId ?? cols[0].id;
      return { ...w, collections: cols.map((c) => (c.id === target ? { ...c, requests: [...c.requests, r] } : c)) };
    });
    setActiveId(r.id);
    setViewing(null);
  };

  const useInRequest = (targetId: string, token: string, target: InsertTarget) => {
    const base = drafts[targetId] ?? findRequest(ws, targetId);
    if (!base) return;
    setDrafts((d) => ({ ...d, [targetId]: insertReference(base, token, target) }));
    setActiveId(targetId);
    setViewing(null);
    setSelectedField(null);
    setNarrowView("request");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "Enter" && req) { e.preventDefault(); sendRequest(req); }
      else if (e.key === "." && pending) { e.preventDefault(); cancel(pending.sendId); }
      else if (e.key === "s") { e.preventDefault(); save(); }
      else if (e.key === "k" || e.key === "p") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "n") { e.preventDefault(); addRequest(); }
      else if (e.key === "e") { e.preventDefault(); setEnvOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const q = filter.trim().toLowerCase();

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Workspace">
        <div className="brand">
          <span className="logo" aria-hidden>⟜</span> Tether
        </div>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={sidebarTab === "collections"} onClick={() => setSidebarTab("collections")}>Collections</button>
          <button role="tab" aria-selected={sidebarTab === "history"} onClick={() => setSidebarTab("history")}>History</button>
        </div>
        {sidebarTab === "collections" ? (
          <>
            <input className="filter" placeholder="Filter requests" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter requests" />
            <nav className="tree">
              {ws.collections.length === 0 && (
                <div className="empty-side">
                  <p>No collections yet.</p>
                  <button onClick={() => addRequest()}>New request</button>
                </div>
              )}
              {ws.collections.map((c) => {
                const items = c.requests.filter((r) => !q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
                return (
                  <section key={c.id}>
                    <header>
                      <span>{c.name}</span>
                      <button className="icon" title="New request in collection" aria-label={`New request in ${c.name}`} onClick={() => addRequest(c.id)}>+</button>
                    </header>
                    {items.length === 0 && <p className="muted small pad">{q ? "No matches." : "Empty collection."}</p>}
                    {items.map((r) => (
                      <button key={r.id} className="req-item" aria-current={r.id === activeId} onClick={() => { setActiveId(r.id); setViewing(null); }}>
                        <span className={`m m-${r.method}`}>{r.method === "DELETE" ? "DEL" : r.method === "OPTIONS" ? "OPT" : r.method}</span>
                        <span className="name">{r.name}</span>
                        {drafts[r.id] && <span className="dot" title="Unsaved changes" aria-label="Unsaved" />}
                      </button>
                    ))}
                  </section>
                );
              })}
            </nav>
          </>
        ) : (
          <nav className="tree history">
            {ws.history.length === 0 && <p className="muted small pad">Sent requests appear here.</p>}
            {ws.history.map((h) => (
              <button key={h.id} className="req-item" aria-current={h.id === viewing} onClick={() => { setActiveId(h.requestId); setViewing(h.id); setNarrowView("response"); }}>
                <span className={`m m-${h.method}`}>{h.method.slice(0, 4)}</span>
                <span className="name">{h.requestName}<small>{new Date(h.at).toLocaleTimeString()}</small></span>
                <StatusChip entry={h} />
              </button>
            ))}
          </nav>
        )}
        <footer className="side-foot">
          <kbd>⌘K</kbd> Commands
        </footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            {req ? (
              <input className="title" value={req.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Request name" />
            ) : <span className="muted">No request selected</span>}
            {dirty && <button className="ghost small" onClick={save}>Save <kbd>⌘S</kbd></button>}
          </div>
          <div className="env">
            <label htmlFor="env">Environment</label>
            <select id="env" value={ws.activeEnvId ?? ""} onChange={(e) => setWs((w) => ({ ...w, activeEnvId: e.target.value || null }))}>
              <option value="">None</option>
              {ws.environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button className="ghost small" onClick={() => setEnvOpen(true)}>Edit</button>
          </div>
        </header>

        {!req ? (
          <div className="first-run">
            <h1>Start with a request</h1>
            <p>Everything stays on this Mac. No account required.</p>
            <button className="primary" onClick={() => addRequest()}>New request <kbd>⌘N</kbd></button>
          </div>
        ) : (
          <>
            <form className="urlbar" onSubmit={(e) => { e.preventDefault(); sendRequest(req); }}>
              <select className={`method m-${req.method}`} value={req.method} onChange={(e) => edit({ method: e.target.value as Method })} aria-label="Method">
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <TemplateInput ws={ws} value={req.url} onChange={(url) => edit({ url })} onCursor={(pos) => (cursors.current[req.id] = { field: "url", pos })} placeholder="https://api.example.com/resource" />
              {pending?.requestId === req.id ? (
                <button type="button" className="primary danger" onClick={() => cancel(pending.sendId)}>Cancel <kbd>⌘.</kbd></button>
              ) : (
                <button type="submit" className="primary">Send <kbd>⌘↵</kbd></button>
              )}
            </form>

            <div className="narrow-tabs" role="tablist">
              <button role="tab" aria-selected={narrowView === "request"} onClick={() => setNarrowView("request")}>Request</button>
              <button role="tab" aria-selected={narrowView === "response"} onClick={() => setNarrowView("response")}>Response</button>
            </div>

            <div className="panes" data-view={narrowView} style={{ ["--split" as string]: `${split * 100}%` }}>
              <section className="pane request-pane" aria-label="Request">
                <RequestEditor req={req} edit={edit} ws={ws} onCursor={(c) => (cursors.current[req.id] = c)} />
                <References ws={ws} req={req} onSend={sendById} onEnv={() => setEnvOpen(true)} />
              </section>
              <Splitter onChange={setSplit} />
              <section className="pane response-pane" aria-label="Response">
                <ResponseView
                  entry={entry}
                  loading={pending?.requestId === req.id}
                  sourceSlug={entry ? slug(findRequest(ws, entry.requestId)?.name ?? entry.requestName) : ""}
                  ws={ws}
                  selected={selectedField}
                  onSelect={setSelectedField}
                  onUse={useInRequest}
                  defaultTargetId={recent.current.find((id) => id !== entry?.requestId && findRequest(ws, id)) ?? allRequests(ws).find(({ request }) => request.id !== entry?.requestId)?.request.id}
                  cursorFor={(id) => cursors.current[id]}
                  draftFor={(id) => drafts[id] ?? findRequest(ws, id)}
                  onRetry={() => sendRequest(req)}
                  onEnv={() => setEnvOpen(true)}
                />
              </section>
            </div>
          </>
        )}
      </main>

      {palette && (
        <Palette
          ws={ws}
          onClose={() => setPalette(false)}
          onPick={(id) => { setActiveId(id); setViewing(null); setPalette(false); }}
          actions={[
            { label: "New request", hint: "⌘N", run: () => addRequest() },
            { label: "Edit environments", hint: "⌘E", run: () => setEnvOpen(true) },
            ...ws.environments.map((e) => ({ label: `Switch environment: ${e.name}`, run: () => setWs((w) => ({ ...w, activeEnvId: e.id })) })),
            { label: "Clear history", run: () => setWs((w) => ({ ...w, history: [] })) },
            { label: "Reset to example workspace", run: () => { const d = demoWorkspace(); setWs(d); setDrafts({}); setActiveId(d.collections[0].requests[0].id); } },
          ]}
        />
      )}
      {envOpen && <EnvEditor ws={ws} setWs={setWs} onClose={() => setEnvOpen(false)} />}
    </div>
  );
}

function StatusChip({ entry }: { entry: HistoryEntry }) {
  if (entry.response) {
    const s = entry.response.status;
    return <span className={`chip ${s >= 500 ? "bad" : s >= 400 ? "warn" : "ok"}`}>{s}</span>;
  }
  return <span className="chip bad">{entry.error?.kind === "cancelled" ? "—" : "ERR"}</span>;
}

function TemplateInput({ ws, value, onChange, onCursor, placeholder, multiline }: { ws: Workspace; value: string; onChange: (v: string) => void; onCursor?: (pos: number) => void; placeholder?: string; multiline?: boolean }) {
  // Overlay highlights {{tokens}} by resolution state beneath a transparent native input.
  const parts = value.split(/(\{\{[^}]+\}\})/g);
  const overlay = parts.map((p, i) => {
    const m = p.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (!m) return <span key={i}>{p}</span>;
    const r = resolveToken(ws, m[1]);
    return <mark key={i} className={r.ok ? (r.kind === "response" ? "ref" : "var") : "broken"}>{p}</mark>;
  });
  const track = (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => onCursor?.(e.currentTarget.selectionStart ?? value.length);
  const props = { value, placeholder, spellCheck: false, onChange: (e: { target: { value: string } }) => onChange(e.target.value), onSelect: track, onBlur: track };
  return (
    <div className={`tpl ${multiline ? "multi" : ""}`}>
      <div className="tpl-overlay" aria-hidden>{overlay}{multiline ? "\n" : ""}</div>
      {multiline ? <textarea {...props} aria-label="Body" /> : <input {...props} aria-label="URL" />}
    </div>
  );
}

function RequestEditor({ req, edit, ws, onCursor }: { req: RequestDef; edit: (p: Partial<RequestDef>) => void; ws: Workspace; onCursor: (c: Cursor) => void }) {
  const [tab, setTab] = useState<"headers" | "body">(req.body ? "body" : "headers");
  const enabledHeaders = req.headers.filter((h) => h.enabled).length;
  const bodyDisabled = req.method === "GET" || req.method === "HEAD";
  return (
    <div className="editor">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "headers"} onClick={() => setTab("headers")}>Headers {enabledHeaders > 0 && <span className="count">{enabledHeaders}</span>}</button>
        <button role="tab" aria-selected={tab === "body"} onClick={() => setTab("body")}>Body</button>
      </div>
      {tab === "headers" ? (
        <KVTable rows={req.headers} onChange={(headers) => edit({ headers })} ws={ws} keyPlaceholder="Header" onCursor={(i, pos) => onCursor({ field: `header:${i}`, pos })} />
      ) : (
        <div className="body-edit">
          {bodyDisabled && <p className="note">{req.method} requests are sent without a body.</p>}
          <TemplateInput ws={ws} multiline value={req.body} onChange={(body) => edit({ body })} onCursor={(pos) => onCursor({ field: "body", pos })} placeholder='{ "key": "value" }' />
        </div>
      )}
    </div>
  );
}

function KVTable({ rows, onChange, ws, keyPlaceholder, secret, onCursor }: { rows: KV[]; onChange: (r: KV[]) => void; ws?: Workspace; keyPlaceholder: string; secret?: boolean; onCursor?: (row: number, pos: number) => void }) {
  const set = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  return (
    <div className="kv">
      {rows.map((r, i) => (
        <div className="kv-row" key={i}>
          <input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label="Enabled" />
          <input className="mono" value={r.key} placeholder={keyPlaceholder} onChange={(e) => set(i, { key: e.target.value })} aria-label="Name" />
          {ws ? (
            <TemplateInput ws={ws} value={r.value} onChange={(value) => set(i, { value })} onCursor={(pos) => onCursor?.(i, pos)} placeholder="Value" />
          ) : (
            <input className="mono" type={secret ? "password" : "text"} value={r.value} placeholder="Value" onChange={(e) => set(i, { value: e.target.value })} aria-label="Value" />
          )}
          <button className="icon" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="ghost small add" onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])}>+ Add</button>
    </div>
  );
}

function References({ ws, req, onSend, onEnv }: { ws: Workspace; req: RequestDef; onSend: (id: string) => void; onEnv: () => void }) {
  const tokens = tokensIn(req);
  if (!tokens.length) return null;
  const rs = tokens.map((t) => resolveToken(ws, t));
  const broken = rs.filter((r) => !r.ok).length;
  return (
    <details className="refs" open>
      <summary>
        References <span className="muted">{tokens.length}</span>
        {broken > 0 && <span className="chip bad">{broken} unresolved</span>}
      </summary>
      <ul>
        {rs.map((r) => <RefRow key={r.token} r={r} onSend={onSend} onEnv={onEnv} />)}
      </ul>
    </details>
  );
}

function RefRow({ r, onSend, onEnv }: { r: Resolution; onSend: (id: string) => void; onEnv: () => void }) {
  return (
    <li className={r.ok ? "" : "is-broken"}>
      <code className={r.ok ? (r.kind === "response" ? "ref" : "var") : "broken"}>{`{{${r.token}}}`}</code>
      {r.ok ? (
        <>
          <span className="src">{r.source}</span>
          <code className="val" title={r.kind === "secret" ? "Hidden" : r.value}>{r.kind === "secret" ? "••••••" : r.value}</code>
        </>
      ) : (
        <>
          <span className="why">{r.reason}</span>
          {r.fix && (
            <button className="ghost small" onClick={() => (r.fix?.requestId ? onSend(r.fix.requestId) : onEnv())}>{r.fix.label}</button>
          )}
        </>
      )}
    </li>
  );
}

function Splitter({ onChange }: { onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent) => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const move = (ev: PointerEvent) => onChange(Math.min(0.75, Math.max(0.25, (ev.clientX - rect.left) / rect.width)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };
  return (
    <div
      ref={ref}
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        const cur = Number(localStorage.getItem("tether.split")) || 0.5;
        if (e.key === "ArrowLeft") onChange(Math.max(0.25, cur - 0.05));
        if (e.key === "ArrowRight") onChange(Math.min(0.75, cur + 0.05));
      }}
    />
  );
}

function ResponseView(props: {
  entry?: HistoryEntry; loading: boolean; sourceSlug: string; ws: Workspace;
  selected: Selection | null; onSelect: (s: Selection | null) => void;
  onUse: (targetId: string, token: string, target: InsertTarget) => void; defaultTargetId?: string;
  cursorFor: (id: string) => Cursor | undefined; draftFor: (id: string) => RequestDef | undefined;
  onRetry: () => void; onEnv: () => void;
}) {
  const { entry, loading, sourceSlug, ws, onSelect, onRetry, onEnv } = props;
  // A selection belongs to the response it was made in (#6).
  const selected = props.selected && props.selected.entryId === entry?.id ? props.selected : null;
  const pick = (token: string, value: string) => entry && onSelect({ token, value, entryId: entry.id });
  const [tab, setTab] = useState<"body" | "headers">("body");
  const [raw, setRaw] = useState(false);
  const res = entry?.response;
  const parsed = useMemo(() => {
    if (!res) return undefined;
    try { return { ok: true as const, value: JSON.parse(res.body) as unknown }; } catch { return { ok: false as const }; }
  }, [res]);

  if (loading) return <div className="state"><div className="spinner" aria-hidden /> <p>Sending…</p></div>;
  if (!entry) return <div className="state"><p className="muted">Send the request to see its response here.</p><p className="muted small">Select any response field to reuse it in another request.</p></div>;

  if (entry.error) {
    const e = entry.error;
    return (
      <div className="state error" role="alert">
        {e.kind === "cancelled" && <><h2>Request cancelled</h2><p>Nothing was received.</p></>}
        {e.kind === "timeout" && <><h2>Timed out after {e.afterMs / 1000}s</h2><p>The server did not respond in time.</p></>}
        {e.kind === "connection" && <><h2>Could not connect</h2><p className="mono">{e.message}</p><p className="muted small">Check the URL, your network, or whether the server is running.</p></>}
        {e.kind === "invalid" && <><h2>Request is not valid</h2><p>{e.message}</p></>}
        {e.kind === "unresolved" && (
          <>
            <h2>Not sent: unresolved {e.names.length === 1 ? "reference" : "references"}</h2>
            <ul className="refs-inline">{e.names.map((n) => <RefRow key={n} r={resolveToken(ws, n)} onSend={() => {}} onEnv={onEnv} />)}</ul>
          </>
        )}
        <button className="primary" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  if (!res) return null;

  const tone = res.status >= 500 ? "bad" : res.status >= 400 ? "warn" : "ok";
  const uses = selected ? downstreamUses(ws, selected.token) : [];
  return (
    <div className="response">
      <div className="summary">
        <span className={`status ${tone}`}>{res.status} {res.statusText}</span>
        <span><small>Time</small>{res.durationMs} ms</span>
        <span><small>Size</small>{formatBytes(res.size)}</span>
        <span className="muted small url" title={entry.url}>{entry.url}</span>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "body"} onClick={() => setTab("body")}>Body</button>
        <button role="tab" aria-selected={tab === "headers"} onClick={() => setTab("headers")}>Headers <span className="count">{res.headers.length}</span></button>
        {tab === "body" && parsed?.ok && <label className="raw-toggle"><input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Raw</label>}
      </div>
      <div className="payload">
        {tab === "headers" ? (
          <table className="hdrs"><tbody>{res.headers.map(([k, v], i) => (
            <tr key={i} className={selected?.token === `@${sourceSlug}.headers.${k}` ? "sel" : ""} onClick={() => pick(`@${sourceSlug}.headers.${k}`, v)}>
              <th>{k}</th><td>{v}</td>
            </tr>))}</tbody></table>
        ) : parsed?.ok && !raw ? (
          <JsonTree value={parsed.value} selected={selected?.token.replace(`@${sourceSlug}.body.`, "")} onSelect={(path, value) => pick(`@${sourceSlug}.body.${path.join(".")}`, value)} />
        ) : res.body.length === 0 ? (
          <p className="muted pad">Empty body.</p>
        ) : (
          <pre className="raw">{res.body.length > 500_000 ? res.body.slice(0, 500_000) + "\n\n… truncated for display (" + formatBytes(res.size) + " total)" : res.body}</pre>
        )}
      </div>
      {selected && (
        <aside className="inspector" aria-label="Field inspector">
          <div className="insp-head">
            <code className="ref">{`{{${selected.token}}}`}</code>
            <button className="icon" aria-label="Close inspector" onClick={() => onSelect(null)}>×</button>
          </div>
          <dl>
            <dt>Value</dt><dd><code className="val">{selected.value}</code></dd>
            <dt>Used by</dt>
            <dd>{uses.length ? uses.map((u) => u.request.name).join(", ") : <span className="muted">No requests yet</span>}</dd>
          </dl>
          <UseIn
            key={selected.token}
            ws={ws}
            token={selected.token}
            sourceId={entry.requestId}
            defaultTargetId={props.defaultTargetId}
            cursorFor={props.cursorFor}
            draftFor={props.draftFor}
            onUse={props.onUse}
          />
        </aside>
      )}
    </div>
  );
}

function UseIn({ ws, token, sourceId, defaultTargetId, cursorFor, draftFor, onUse }: {
  ws: Workspace; token: string; sourceId: string; defaultTargetId?: string;
  cursorFor: (id: string) => Cursor | undefined; draftFor: (id: string) => RequestDef | undefined;
  onUse: (targetId: string, token: string, target: InsertTarget) => void;
}) {
  const others = allRequests(ws).filter(({ request }) => request.id !== sourceId);
  const [targetId, setTargetId] = useState(defaultTargetId ?? "");
  const target = draftFor(targetId);
  const cursor = cursorFor(targetId);
  const initial = (id: string) => {
    if (cursorFor(id)) return { kind: "cursor" as const, name: "" };
    const r = draftFor(id);
    const t = suggestTarget(token, r?.method ?? "GET");
    return { kind: t.kind, name: t.kind === "cursor" ? "" : t.name };
  };
  const [placement, setPlacement] = useState(() => initial(targetId));
  const fieldLabel = (f: Field) => (f === "url" ? "URL" : f === "body" ? "body" : `header “${target?.headers[Number(f.split(":")[1])]?.key || "…"}”`);

  if (!others.length) return <p className="muted small">Create another request to reuse this value in it.</p>;

  const apply = () => {
    if (!target) return;
    const t: InsertTarget = placement.kind === "cursor" && cursor ? { kind: "cursor", ...cursor } : { kind: placement.kind as "header" | "query" | "body", name: placement.name.trim() };
    onUse(targetId, token, t);
  };
  const needsName = placement.kind !== "cursor";
  return (
    <form className="use-in" onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <label>
        <span>Use in</span>
        <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setPlacement(initial(e.target.value)); }}>
          {!targetId && <option value="">Choose a request…</option>}
          {others.map(({ request }) => <option key={request.id} value={request.id}>{request.name}</option>)}
        </select>
      </label>
      <label>
        <span>As</span>
        <select value={placement.kind} onChange={(e) => setPlacement((p) => ({ ...p, kind: e.target.value as InsertTarget["kind"] }))}>
          {cursor && <option value="cursor">At cursor in {fieldLabel(cursor.field)}</option>}
          <option value="header">Header</option>
          <option value="query">Query parameter</option>
          <option value="body">JSON body field</option>
        </select>
        {needsName && <input className="mono" aria-label="Name" value={placement.name} onChange={(e) => setPlacement((p) => ({ ...p, name: e.target.value }))} placeholder="name" />}
      </label>
      <div className="insp-actions">
        <button type="submit" className="primary small" disabled={!target || (needsName && !placement.name.trim())}>Insert</button>
        <button type="button" className="ghost small" onClick={() => navigator.clipboard.writeText(`{{${token}}}`)}>Copy reference</button>
      </div>
    </form>
  );
}

function Palette({ ws, onClose, onPick, actions }: { ws: Workspace; onClose: () => void; onPick: (id: string) => void; actions: { label: string; hint?: string; run: () => void }[] }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const items = [
    ...allRequests(ws).map(({ request, collection }) => ({ label: request.name, sub: `${request.method} · ${collection.name}`, hint: undefined as string | undefined, run: () => onPick(request.id) })),
    ...actions.map((a) => ({ ...a, sub: "Command", run: () => { a.run(); onClose(); } })),
  ].filter((it) => it.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus value={q} placeholder="Go to request or run a command…"
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") items[i]?.run();
          }}
        />
        <ul role="listbox">
          {items.length === 0 && <li className="muted">No matches</li>}
          {items.slice(0, 50).map((it, j) => (
            <li key={j} role="option" aria-selected={i === j} onMouseEnter={() => setI(j)} onClick={it.run}>
              <span>{it.label}</span><small>{it.sub}</small>{it.hint && <kbd>{it.hint}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EnvEditor({ ws, setWs, onClose }: { ws: Workspace; setWs: React.Dispatch<React.SetStateAction<Workspace>>; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(ws.activeEnvId ?? ws.environments[0]?.id ?? null);
  const env = ws.environments.find((e) => e.id === sel);
  const update = (patch: Partial<typeof env>) =>
    setWs((w) => ({ ...w, environments: w.environments.map((e) => (e.id === sel ? { ...e, ...patch } : e)) }));
  const add = () => {
    const e = { id: uid(), name: "New environment", vars: [], secrets: [] };
    setWs((w) => ({ ...w, environments: [...w.environments, e] }));
    setSel(e.id);
  };
  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-label="Environments" onMouseDown={(e) => e.stopPropagation()}>
        <aside>
          {ws.environments.map((e) => (
            <button key={e.id} aria-current={e.id === sel} onClick={() => setSel(e.id)}>{e.name}{e.id === ws.activeEnvId && <small> · active</small>}</button>
          ))}
          <button className="ghost small" onClick={add}>+ New environment</button>
        </aside>
        <div className="modal-body">
          {env ? (
            <>
              <input className="title" value={env.name} onChange={(e) => update({ name: e.target.value })} aria-label="Environment name" autoFocus />
              <h3>Variables <small className="muted">Shareable — saved with the workspace</small></h3>
              <KVTable rows={env.vars} onChange={(vars) => update({ vars })} keyPlaceholder="name" />
              <h3>Secrets <small className="muted">Private — never written to shareable files</small></h3>
              <KVTable rows={env.secrets} onChange={(secrets) => update({ secrets })} keyPlaceholder="name" secret />
            </>
          ) : <p className="muted">Create an environment to define variables like <code>{"{{base_url}}"}</code>.</p>}
          <div className="modal-foot">
            {env && <button className="ghost small danger-text" onClick={() => { setWs((w) => ({ ...w, environments: w.environments.filter((e) => e.id !== env.id), activeEnvId: w.activeEnvId === env.id ? null : w.activeEnvId })); setSel(null); }}>Delete</button>}
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
