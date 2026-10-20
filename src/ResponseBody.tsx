import { ChevronsDownUp, ChevronsUpDown, Copy, Search, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlight, JsonTree } from "./JsonTree";
import { contentType, detectKind, formatMarkup, tokenizeMarkup, type BodyKind, type Tok } from "./markup";
import { isBinaryResponse } from "./body";
import { formatBytes, type HttpResponse } from "./model";

const MAX_LINES = 5000;
const MAX_CHARS = 500_000;

type Mode = "pretty" | "raw" | "preview";

function useFindShortcut(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "f") { e.preventDefault(); ref.current?.focus(); ref.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

function Find({ value, onChange, count, inputRef }: { value: string; onChange: (v: string) => void; count?: number; inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <label className="find">
      <Search size={12} aria-hidden />
      <input ref={inputRef} value={value} placeholder="Find" aria-label="Find in response" onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")} />
      {value && count !== undefined && <span className="find-count">{count.toLocaleString()}</span>}
      {value && <button className="clear" aria-label="Clear" onClick={() => onChange("")}><X size={10} /></button>}
    </label>
  );
}

function countHits(text: string, q: string) {
  if (!q) return 0;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  let n = 0;
  for (let i = t.indexOf(s); i >= 0; i = t.indexOf(s, i + s.length)) n++;
  return n;
}

/** Tokenizes the whole document (tags can span lines), then splits tokens at newlines. */
function markupLines(text: string): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const tok of tokenizeMarkup(text)) {
    const parts = tok.s.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: tok.t, s: part });
    });
  }
  return lines;
}

/** Line-numbered text. Large bodies are capped so the view stays responsive. */
function Lines({ text, query, wrap, markup }: { text: string; query: string; wrap: boolean; markup?: boolean }) {
  const all = useMemo(() => text.split("\n"), [text]);
  const toks = useMemo(() => (markup ? markupLines(text) : undefined), [markup, text]);
  const lines = all.length > MAX_LINES ? all.slice(0, MAX_LINES) : all;
  const firstHit = useRef<HTMLDivElement>(null);
  const hitIndex = useMemo(() => (query ? lines.findIndex((l) => l.toLowerCase().includes(query.toLowerCase())) : -1), [lines, query]);
  useEffect(() => firstHit.current?.scrollIntoView({ block: "center" }), [hitIndex]);
  return (
    <div className={`lines ${wrap ? "wrap" : ""}`} style={{ ["--gutter" as string]: `${String(lines.length).length + 1}ch` }}>
      {lines.map((l, i) => (
        <div key={i} className="ln" ref={i === hitIndex ? firstHit : undefined}>
          <span className="ln-n" aria-hidden>{i + 1}</span>
          <span className="ln-t">{toks ? toks[i]?.map((t, j) => <span key={j} className={`mk-${t.t}`}>{highlight(t.s, query)}</span>) : highlight(l, query)}{l === "" ? "\u200b" : null}</span>
        </div>
      ))}
      {all.length > MAX_LINES && <p className="muted pad">Showing the first {MAX_LINES.toLocaleString()} of {all.length.toLocaleString()} lines.</p>}
    </div>
  );
}

export function BodyView({ res, selectedPath, onSelect, lead }: { res: HttpResponse; selectedPath?: string; onSelect: (path: string[], value: string) => void; lead: React.ReactNode }) {
  const kind: BodyKind = useMemo(() => (isBinaryResponse(res) ? "binary" : detectKind(res.headers, res.body)), [res]);
  const parsed = useMemo(() => {
    if (kind !== "json") return undefined;
    try { return JSON.parse(res.body) as unknown; } catch { return undefined; }
  }, [kind, res.body]);
  const [mode, setMode] = useState<Mode>("pretty");
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [fold, setFold] = useState(0);
  const [copied, setCopied] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  useFindShortcut(findRef);

  const body = res.body.length > MAX_CHARS ? res.body.slice(0, MAX_CHARS) : res.body;
  const pretty = useMemo(() => (kind === "html" || kind === "xml" ? formatMarkup(body) : body), [kind, body]);
  const shownText = mode === "raw" ? body : pretty;
  const hits = useMemo(() => countHits(mode === "pretty" && parsed !== undefined ? JSON.stringify(parsed, null, 2) : shownText, query), [mode, parsed, shownText, query]);

  const bareBar = <div className="body-bar">{lead}</div>;
  if (res.size === 0) return <div className="body-view">{bareBar}<div className="body-empty"><p>No body</p><p className="muted small">The server returned {res.status} with an empty response.</p></div></div>;
  if (kind === "binary") {
    return (
      <div className="body-view">
        {bareBar}
        <div className="body-empty">
          <p>Binary content</p>
          <p className="muted small">{contentType(res.headers) || "Unknown type"} · {formatBytes(res.size)}. Previews for images and files aren’t supported yet.</p>
        </div>
      </div>
    );
  }

  const modes: [Mode, string][] = [["pretty", "Pretty"], ["raw", "Raw"], ...(kind === "html" ? [["preview", "Preview"] as [Mode, string]] : [])];
  const label = { json: "JSON", html: "HTML", xml: "XML", text: "Text" }[kind];

  return (
    <div className="body-view">
      <div className="body-bar">
        {lead}
        <span className="bar-sep" aria-hidden />
        <div className="seg mini" role="tablist" aria-label="Body view">
          {modes.map(([m, l]) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{l}</button>)}
        </div>
        <span className="kind">{label}</span>
        <span className="spacer" />
        {mode !== "preview" && <Find value={query} onChange={setQuery} count={hits} inputRef={findRef} />}
        {mode === "pretty" && parsed !== undefined && (
          <>
            <button className="icon" title="Expand all" aria-label="Expand all" onClick={() => setFold((f) => Math.abs(f) + 1)}><ChevronsUpDown size={14} /></button>
            <button className="icon" title="Collapse all" aria-label="Collapse all" onClick={() => setFold((f) => -(Math.abs(f) + 1))}><ChevronsDownUp size={14} /></button>
          </>
        )}
        {(mode === "raw" || (mode === "pretty" && parsed === undefined)) && (
          <button className={`icon ${wrap ? "on" : ""}`} title="Wrap lines" aria-label="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={14} /></button>
        )}
        <button className="icon" title={copied ? "Copied" : "Copy body"} aria-label="Copy body" onClick={() => { navigator.clipboard.writeText(res.body); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          <Copy size={13} />
        </button>
      </div>
      <div className="payload">
        {mode === "preview" ? (
          <iframe className="preview" title="HTML preview" sandbox="" srcDoc={body} />
        ) : mode === "pretty" && parsed !== undefined ? (
          <JsonTree value={parsed} selected={selectedPath} onSelect={onSelect} query={query} fold={fold} />
        ) : (
          <Lines text={shownText} query={query} wrap={wrap} markup={mode === "pretty" && (kind === "html" || kind === "xml")} />
        )}
        {(res.truncated || res.body.length > MAX_CHARS) && (
          <p className="muted pad truncated-note">
            Showing the first {formatBytes(Math.min(res.body.length, MAX_CHARS))} of {formatBytes(res.size)}.
            {res.bodyFile ? <> The full body is saved at <code>{res.bodyFile}</code>.</> : res.truncated ? " The rest isn’t kept in history." : null}
          </p>
        )}
      </div>
    </div>
  );
}

function HeaderValue({ name, value, query }: { name: string; value: string; query: string }) {
  if (name.toLowerCase() === "set-cookie") {
    const [pair, ...attrs] = value.split(/;\s*/);
    return <>{highlight(pair, query)}{attrs.map((a, i) => <span key={i} className="cookie-attr">; {highlight(a, query)}</span>)}</>;
  }
  return <>{highlight(value, query)}</>;
}

function HeaderTable({ rows, query, selectedName, onPick, empty }: { rows: [string, string][]; query: string; selectedName?: string; onPick?: (name: string, value: string) => void; empty: string }) {
  const q = query.toLowerCase();
  const shown = rows.filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q));
  if (!shown.length) return <p className="muted pad">{rows.length ? `No headers match “${query}”.` : empty}</p>;
  return (
    <table className="hdrs">
      <tbody>
        {shown.map(([k, v], i) => (
          <tr key={i} className={`${onPick ? "pickable" : ""} ${selectedName === k ? "sel" : ""}`} onClick={() => onPick?.(k, v)}>
            <th scope="row">{highlight(k, query)}</th>
            <td><HeaderValue name={k} value={v} query={query} /></td>
            <td className="row-copy">
              <button className="icon" aria-label={`Copy ${k}`} title="Copy value" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(v); }}><Copy size={12} /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HeadersView({ res, sent, selectedName, onPick, lead }: { res: HttpResponse; sent?: [string, string][]; selectedName?: string; onPick: (name: string, value: string) => void; lead: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  useFindShortcut(findRef);
  return (
    <div className="body-view">
      <div className="body-bar">
        {lead}
        <span className="spacer" />
        <Find value={query} onChange={setQuery} inputRef={findRef} />
      </div>
      <div className="payload headers-payload">
        <h4>Response <span className="count">{res.headers.length}</span></h4>
        <HeaderTable rows={res.headers} query={query} selectedName={selectedName} onPick={onPick} empty="The server sent no headers." />
        {sent && (
          <>
            <h4>Request <span className="count">{sent.length}</span><span className="hint">Sent by Tether; the HTTP client may add defaults. Credentials are masked.</span></h4>
            <HeaderTable rows={sent} query={query} empty="No custom headers. Only the HTTP client’s defaults were sent." />
          </>
        )}
      </div>
    </div>
  );
}
