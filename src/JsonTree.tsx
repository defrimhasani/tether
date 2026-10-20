import { Check, ChevronRight, Copy } from "lucide-react";
import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";

type Ctx = {
  selected?: string;
  onSelect: (path: string[], value: string) => void;
  /** Paths (joined by ".") to show while filtering; undefined shows everything. */
  visible?: Set<string>;
  query: string;
  /** Bumped to expand (positive) or collapse (negative) every node. */
  fold: number;
};
const TreeCtx = createContext<Ctx>({ onSelect: () => {}, query: "", fold: 0 });

const LONG = 280;
const INDENT = 16;

export function highlight(text: string, query: string) {
  if (!query) return text;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  for (let j = lower.indexOf(q); j >= 0; j = lower.indexOf(q, i)) {
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark className="hit" key={j}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  out.push(text.slice(i));
  return out;
}

/** Paths of every node whose key or primitive value contains `query`, plus their ancestors. */
export function matchingPaths(value: unknown, query: string): Set<string> {
  const q = query.toLowerCase();
  const hits = new Set<string>();
  const walk = (v: unknown, path: string[]): boolean => {
    const key = path[path.length - 1] ?? "";
    let hit = key.toLowerCase().includes(q);
    if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) if (walk(child, [...path, k])) hit = true;
    } else if (String(v).toLowerCase().includes(q)) hit = true;
    if (hit) hits.add(path.join("."));
    return hit;
  };
  walk(value, []);
  return hits;
}

export function JsonTree({ value, selected, onSelect, query = "", fold = 0 }: { value: unknown; selected?: string; onSelect: Ctx["onSelect"]; query?: string; fold?: number }) {
  const visible = useMemo(() => (query ? matchingPaths(value, query) : undefined), [value, query]);
  if (visible && !visible.has("")) return <p className="muted pad">No fields match “{query}”.</p>;
  return (
    <TreeCtx.Provider value={{ selected, onSelect, visible, query, fold }}>
      <div className="json" role="tree">
        <Node k={null} value={value} path={[]} depth={0} last />
      </div>
    </TreeCtx.Provider>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="j-copy" aria-label="Copy value" title="Copy value"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function Key({ k, isIndex }: { k: string; isIndex: boolean }) {
  const { query } = useContext(TreeCtx);
  return <><span className={isIndex ? "j-index" : "j-key"}>{isIndex ? k : <>"{highlight(k, query)}"</>}</span><span className="j-punct">: </span></>;
}

function StringValue({ s }: { s: string }) {
  const { query } = useContext(TreeCtx);
  const [all, setAll] = useState(false);
  const long = s.length > LONG && !all && !(query && s.toLowerCase().includes(query.toLowerCase()));
  const shown = JSON.stringify(long ? s.slice(0, LONG) : s);
  return (
    <span className="j-string">
      {highlight(long ? shown.slice(0, -1) : shown, query)}
      {long && (
        <>
          <button className="j-more" onClick={(e) => { e.stopPropagation(); setAll(true); }}>
            … {(s.length - LONG).toLocaleString()} more
          </button>"
        </>
      )}
    </span>
  );
}

const Node = memo(function Node({ k, value, path, depth, last, inArray }: { k: string | null; value: unknown; path: string[]; depth: number; last: boolean; inArray?: boolean }) {
  const { selected, onSelect, visible, query, fold } = useContext(TreeCtx);
  const [open, setOpen] = useState(depth < 2);
  useEffect(() => { if (fold) setOpen(fold > 0); }, [fold]);
  const pathStr = path.join(".");
  if (visible && !visible.has(pathStr)) return null;

  const isObj = value !== null && typeof value === "object";
  const isSel = selected === pathStr && path.length > 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const pick = () => path.length && onSelect(path, text);
  const comma = last ? null : <span className="j-punct">,</span>;
  const key = k !== null && <Key k={k} isIndex={!!inArray} />;
  const line = (children: React.ReactNode, extra?: React.ReactNode) => (
    <div
      className={`j-line ${isSel ? "sel" : ""}`} style={{ ["--d" as string]: depth, paddingLeft: depth * INDENT + 18 }}
      role="treeitem" aria-selected={isSel} tabIndex={0} title={path.length ? pathStr : undefined}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter") pick();
        if (e.key === "ArrowLeft" && isObj) setOpen(false);
        if (e.key === "ArrowRight" && isObj) setOpen(true);
      }}
    >
      {extra}{children}
      {path.length > 0 && <CopyButton text={text} />}
    </div>
  );

  if (!isObj) {
    const v = typeof value === "string" ? <StringValue s={value} />
      : <span className={value === null ? "j-null" : `j-${typeof value}`}>{highlight(String(value), query)}</span>;
    return line(<>{key}{v}{comma}</>);
  }

  const arr = Array.isArray(value);
  const entries = arr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const [o, c] = arr ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return line(<>{key}<span className="j-punct">{o}{c}</span>{comma}</>);

  const expanded = open || !!query;
  const toggle = (
    <button className="j-tog" aria-label={expanded ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setOpen(!expanded); }}>
      <ChevronRight size={11} className={expanded ? "open" : ""} />
    </button>
  );
  return (
    <div role="group">
      {line(
        <>
          {key}<span className="j-punct">{o}</span>
          {!expanded && <><button className="j-fold" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{entries.length} {arr ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"}</button><span className="j-punct">{c}</span>{comma}</>}
        </>,
        toggle,
      )}
      {expanded && entries.map(([ck, cv], i) => (
        <Node key={ck} k={ck} value={cv} path={[...path, ck]} depth={depth + 1} last={i === entries.length - 1} inArray={arr} />
      ))}
      {expanded && <div className="j-line close" style={{ ["--d" as string]: depth, paddingLeft: depth * INDENT + 18 }}><span className="j-punct">{c}</span>{comma}</div>}
    </div>
  );
});
