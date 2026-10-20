import { Columns3, Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { highlight } from "./JsonTree";
import { cellText, columnsOf, columnWidth, getAt, rowsOf, sortRows, toDelimited, type ArrayInfo, type Sort } from "./table";

const ROW = 28;
const OVERSCAN = 8;
const DEFAULT_COLS = 20;
const INDEX_COL = 52;

export type TableSettings = { path?: string; sort?: Sort; hidden?: string[]; shown?: string[] };

function Cell({ v, query }: { v: unknown; query: string }) {
  if (v === undefined) return <span className="t-missing" aria-label="missing" />;
  if (v === null) return <span className="j-null">null</span>;
  if (Array.isArray(v)) return <span className="t-chip">[{v.length}]</span>;
  if (typeof v === "object") return <span className="t-chip">{"{"}{Object.keys(v as object).length}{"}"}</span>;
  if (typeof v === "boolean") return <span className="j-boolean">{String(v)}</span>;
  if (typeof v === "number") return <span className="j-number">{highlight(String(v), query)}</span>;
  return <>{highlight(String(v), query)}</>;
}

export function TableView({ root, arrays, settings, onSettings, onSelect, selectedPath, query }: {
  root: unknown; arrays: ArrayInfo[]; settings: TableSettings; onSettings: (s: TableSettings) => void;
  onSelect: (path: string[], value: string) => void; selectedPath?: string; query: string;
}) {
  const info = arrays.find((a) => a.path.join(".") === settings.path) ?? arrays[0];
  const arr = (getAt(root, info.path) as unknown[]) ?? [];
  const all = useMemo(() => rowsOf(arr), [arr]);
  const cols = useMemo(() => columnsOf(all), [all]);
  const visibleCols = useMemo(() => {
    const hidden = new Set(settings.hidden ?? []);
    const shown = new Set(settings.shown ?? []);
    return cols.filter((c, i) => !hidden.has(c) && (i < DEFAULT_COLS || shown.has(c)));
  }, [cols, settings.hidden, settings.shown]);
  const widths = useMemo(() => visibleCols.map((c) => columnWidth(all, c)), [all, visibleCols]);
  const filtered = useMemo(() => {
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((r) => visibleCols.some((c) => cellText(r.value[c]).toLowerCase().includes(q)));
  }, [all, query, visibleCols]);
  const rows = useMemo(() => sortRows(filtered, settings.sort ?? null), [filtered, settings.sort]);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [info.path.join("."), query]);

  const [picker, setPicker] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (sep: "," | "\t") => {
    navigator.clipboard.writeText(toDelimited(rows, visibleCols, sep));
    setCopied(sep === "," ? "CSV" : "TSV");
    setTimeout(() => setCopied(null), 1200);
  };

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  const template = `${INDEX_COL}px ${widths.map((w) => `${w}px`).join(" ")}`;
  const totalWidth = INDEX_COL + widths.reduce((a, b) => a + b, 0);
  const base = info.path.join(".");

  const toggleSort = (col: string) => {
    const s = settings.sort;
    const next: Sort = !s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null;
    onSettings({ ...settings, sort: next });
  };
  const toggleCol = (col: string, on: boolean, defaultOn: boolean) => {
    const hidden = new Set(settings.hidden ?? []);
    const shown = new Set(settings.shown ?? []);
    if (on) { hidden.delete(col); if (!defaultOn) shown.add(col); }
    else { shown.delete(col); if (defaultOn) hidden.add(col); }
    onSettings({ ...settings, hidden: [...hidden], shown: [...shown] });
  };

  return (
    <div className="table-view">
      <div className="table-bar">
        {arrays.length > 1 ? (
          <select className="t-path" value={base} aria-label="Array to show" onChange={(e) => onSettings({ ...settings, path: e.target.value, sort: null })}>
            {arrays.map((a) => <option key={a.path.join(".")} value={a.path.join(".")}>{a.path.length ? a.path.join(".") : "(root)"} · {a.length}</option>)}
          </select>
        ) : <code className="t-path-label">{base || "(root)"}</code>}
        <span className="muted small">
          {query ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} rows` : `${all.length.toLocaleString()} rows`} · {visibleCols.length} of {cols.length} columns
        </span>
        <span className="spacer" />
        <div className="t-picker-wrap">
          <button className="ghost small" aria-expanded={picker} onClick={() => setPicker(!picker)}><Columns3 size={13} /> Columns</button>
          {picker && (
            <div className="menu t-picker" role="dialog" aria-label="Columns" onMouseLeave={() => setPicker(false)}>
              {cols.map((c, i) => {
                const on = visibleCols.includes(c);
                return (
                  <label key={c}>
                    <input type="checkbox" checked={on} onChange={(e) => toggleCol(c, e.target.checked, i < DEFAULT_COLS)} />
                    <span>{c}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <button className="ghost small" onClick={() => copy(",")}><Copy size={12} /> {copied === "CSV" ? "Copied" : "CSV"}</button>
        <button className="ghost small" onClick={() => copy("\t")}><Copy size={12} /> {copied === "TSV" ? "Copied" : "TSV"}</button>
      </div>

      <div className="t-scroll" ref={scroller} onScroll={(e) => { const top = e.currentTarget.scrollTop; setView((v) => ({ ...v, top })); }} role="grid" aria-rowcount={rows.length + 1} aria-colcount={visibleCols.length + 1}>
        <div className="t-head" style={{ gridTemplateColumns: template, width: totalWidth }} role="row">
          <span className="t-idx" role="columnheader">#</span>
          {visibleCols.map((c) => {
            const s = settings.sort?.col === c ? settings.sort.dir : null;
            const numeric = typeof all.find((r) => r.value[c] != null)?.value[c] === "number";
            return (
              <button key={c} role="columnheader" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"}
                className={`t-th ${numeric ? "num" : ""} ${s ? "sorted" : ""}`} onClick={() => toggleSort(c)} title={`Sort by ${c}`}>
                <span>{c}</span><span className="t-sort" aria-hidden>{s === "asc" ? "↑" : s === "desc" ? "↓" : ""}</span>
              </button>
            );
          })}
        </div>
        <div className="t-body" style={{ height: rows.length * ROW, width: totalWidth }}>
          {rows.slice(first, last).map((r, i) => {
            const y = (first + i) * ROW;
            return (
              <div key={r.index} className="t-row" role="row" style={{ transform: `translateY(${y}px)`, gridTemplateColumns: template }}>
                <span className="t-idx" role="rowheader">{r.index}</span>
                {visibleCols.map((c) => {
                  const v = r.value[c];
                  const path = [...info.path, String(r.index), c];
                  const sel = selectedPath === path.join(".");
                  return (
                    <span key={c} role="gridcell" tabIndex={-1} className={`t-td ${typeof v === "number" ? "num" : ""} ${sel ? "sel" : ""}`}
                      title={typeof v === "string" && v.length > 40 ? v : undefined}
                      onClick={() => v !== undefined && onSelect(path, typeof v === "string" ? v : JSON.stringify(v))}>
                      <Cell v={v} query={query} />
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <p className="muted pad">No rows match “{query}”.</p>}
      </div>
    </div>
  );
}
