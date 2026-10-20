import { AlignLeft, Check, CircleAlert, Minimize2 } from "lucide-react";
import { useMemo, useRef } from "react";
import { formatJsonTemplate, lexJsonTemplate, looksLikeJson, type Seg } from "./jsonTemplate";
import { resolveToken } from "./refs";
import type { Workspace } from "./model";

const MAX_VALIDATE = 300_000;
const INDENT = "  ";
const PAIRS: Record<string, string> = { "{": "}", "[": "]", '"': '"' };
const CLOSERS = new Set(["}", "]", '"']);

/** Inserts text through the browser so the native undo stack keeps working. */
function insertText(ta: HTMLTextAreaElement, text: string, from = ta.selectionStart, to = ta.selectionEnd) {
  ta.focus();
  ta.setSelectionRange(from, to);
  if (document.execCommand("insertText", false, text)) return;
  ta.setRangeText(text, from, to, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

const lineStart = (v: string, pos: number) => v.lastIndexOf("\n", pos - 1) + 1;
const insideString = (v: string, pos: number) => {
  let open = false;
  for (let i = 0; i < pos; i++) {
    if (v[i] === "\\" && open) i++;
    else if (v[i] === '"') open = !open;
  }
  return open;
};

function Overlay({ value, ws, json }: { value: string; ws: Workspace; json: boolean }) {
  const segs: Seg[] = useMemo(() => {
    if (json) return lexJsonTemplate(value);
    return value.split(/(\{\{[^}]+\}\})/g).filter(Boolean).map((s) => ({ t: /^\{\{[^}]+\}\}$/.test(s) ? "ref" : "text", s }) as Seg);
  }, [value, json]);
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.t === "ref") {
          const r = resolveToken(ws, seg.s.slice(2, -2).trim());
          return <mark key={i} className={r.ok ? (r.kind === "response" ? "ref" : "var") : "broken"}>{seg.s}</mark>;
        }
        return seg.t === "text" || seg.t === "ws" ? <span key={i}>{seg.s}</span> : <span key={i} className={`jt-${seg.t}`}>{seg.s}</span>;
      })}
      {"\n"}
    </>
  );
}

export function BodyEditor({ ws, value, onChange, onCursor, jsonHint }: {
  ws: Workspace; value: string; onChange: (v: string) => void; onCursor: (pos: number) => void; jsonHint: boolean;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const escaped = useRef(false);

  const json = looksLikeJson(value) || (jsonHint && !value.trim());
  const result = useMemo(() => (json && value.trim() && value.length <= MAX_VALIDATE ? formatJsonTemplate(value) : null), [json, value]);

  const syncScroll = () => {
    if (ta.current && overlay.current) {
      overlay.current.scrollTop = ta.current.scrollTop;
      overlay.current.scrollLeft = ta.current.scrollLeft;
    }
  };

  const replaceAll = (text: string) => {
    const el = ta.current!;
    const top = el.scrollTop;
    insertText(el, text, 0, el.value.length);
    el.setSelectionRange(0, 0);
    el.scrollTop = top;
    syncScroll();
  };

  const gotoError = () => {
    const el = ta.current;
    if (!el || !result || result.ok || !result.line) return;
    const lines = el.value.split("\n");
    const offset = lines.slice(0, result.line - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, (result.column ?? 1) - 1);
    el.focus();
    el.setSelectionRange(offset, offset);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 19;
    el.scrollTop = Math.max(0, (result.line - 3) * lh);
    syncScroll();
  };

  const format = (indent: number | "") => {
    const r = formatJsonTemplate(value, indent);
    if (r.ok) replaceAll(r.text);
    else gotoError();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const v = el.value;
    const { selectionStart: a, selectionEnd: b } = el;
    if (e.altKey && e.shiftKey && e.code === "KeyF") { e.preventDefault(); format(2); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape") { escaped.current = true; return; }
    if (e.key === "Tab") {
      if (escaped.current) { escaped.current = false; return; }
      e.preventDefault();
      const multi = v.slice(a, b).includes("\n");
      if (!multi && !e.shiftKey) { insertText(el, INDENT); return; }
      // Indent or outdent every selected line.
      const start = lineStart(v, a);
      const end = b;
      const block = v.slice(start, end);
      const out = e.shiftKey
        ? block.split("\n").map((l) => l.replace(/^ {1,2}|^\t/, "")).join("\n")
        : block.split("\n").map((l) => INDENT + l).join("\n");
      insertText(el, out, start, end);
      el.setSelectionRange(start, start + out.length);
      return;
    }
    escaped.current = false;

    if (e.key === "Enter" && !e.shiftKey && a === b) {
      e.preventDefault();
      const indent = v.slice(lineStart(v, a), a).match(/^[ \t]*/)![0];
      const before = v[a - 1];
      const after = v[a];
      if ((before === "{" && after === "}") || (before === "[" && after === "]")) {
        const text = `\n${indent}${INDENT}\n${indent}`;
        insertText(el, text);
        const pos = a + 1 + indent.length + INDENT.length;
        el.setSelectionRange(pos, pos);
      } else insertText(el, `\n${indent}${before === "{" || before === "[" ? INDENT : ""}`);
      return;
    }

    if (e.key === "Backspace" && a === b && a > 0 && PAIRS[v[a - 1]] === v[a] && (v[a - 1] !== '"' || !insideString(v, a - 1))) {
      e.preventDefault();
      insertText(el, "", a - 1, a + 1);
      return;
    }

    if (a === b && e.key.length === 1) {
      const next = v[a];
      // Typing a closer over an existing one just moves past it.
      if (CLOSERS.has(e.key) && next === e.key && (e.key !== '"' || insideString(v, a))) {
        e.preventDefault();
        el.setSelectionRange(a + 1, a + 1);
        return;
      }
      if (PAIRS[e.key] && !insideString(v, a)) {
        if (next === undefined || /[\s)\]},:]/.test(next)) {
          e.preventDefault();
          insertText(el, e.key + PAIRS[e.key]);
          el.setSelectionRange(a + 1, a + 1);
        }
      }
    }
  };

  const track = () => ta.current && onCursor(ta.current.selectionStart ?? value.length);

  return (
    <div className="body-editor">
      {json && (
        <div className="editor-bar">
          <button className="ghost small" onClick={() => format(2)} title="Beautify (⌥⇧F)"><AlignLeft size={13} /> Beautify</button>
          <button className="ghost small" onClick={() => format("")} title="Minify"><Minimize2 size={13} /> Minify</button>
          <span className="spacer" />
          {result && (result.ok ? (
            <span className="validity ok"><Check size={13} /> Valid JSON</span>
          ) : (
            <button className="validity bad" onClick={gotoError} title="Go to the problem">
              <CircleAlert size={13} /> {result.line ? `Line ${result.line}, column ${result.column}: ` : ""}{result.error}
            </button>
          ))}
        </div>
      )}
      <div className="tpl multi code">
        <div className="tpl-overlay" ref={overlay} aria-hidden><Overlay value={value} ws={ws} json={json} /></div>
        <textarea
          ref={ta} value={value} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Body"
          placeholder='{ "key": "value" }'
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onScroll={syncScroll}
          onSelect={track} onBlur={track}
        />
      </div>
    </div>
  );
}
