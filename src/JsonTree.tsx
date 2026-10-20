import { useState } from "react";

type Props = { value: unknown; selected?: string; onSelect: (path: string[], value: string) => void };

export function JsonTree({ value, selected, onSelect }: Props) {
  return (
    <div className="json" role="tree">
      <Node k={null} value={value} path={[]} depth={0} selected={selected} onSelect={onSelect} last />
    </div>
  );
}

function Node({ k, value, path, depth, selected, onSelect, last }: Props & { k: string | null; path: string[]; depth: number; last: boolean }) {
  const [open, setOpen] = useState(depth < 3);
  const isObj = value !== null && typeof value === "object";
  const key = k !== null && <><span className="j-key">{Array.isArray(value) || !/^\d+$/.test(k) ? `"${k}"` : k}</span>: </>;
  const comma = last ? "" : ",";
  const pathStr = path.join(".");
  const isSel = selected === pathStr && path.length > 0;
  const pick = () => path.length && onSelect(path, typeof value === "string" ? value : JSON.stringify(value));

  if (!isObj) {
    const cls = value === null ? "j-null" : `j-${typeof value}`;
    return (
      <div className={`j-line ${isSel ? "sel" : ""}`} style={{ paddingLeft: depth * 14 }} role="treeitem" tabIndex={0}
        onClick={pick} onKeyDown={(e) => e.key === "Enter" && pick()}>
        {key}<span className={cls}>{JSON.stringify(value)}</span>{comma}
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const [o, c] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div role="treeitem" aria-expanded={open}>
      <div className={`j-line ${isSel ? "sel" : ""}`} style={{ paddingLeft: depth * 14 }} tabIndex={0}
        onClick={pick} onKeyDown={(e) => { if (e.key === "Enter") pick(); if (e.key === "ArrowLeft") setOpen(false); if (e.key === "ArrowRight") setOpen(true); }}>
        <button className="j-tog" aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? "▾" : "▸"}</button>
        {key}{o}{!open && <span className="muted"> {entries.length} {Array.isArray(value) ? "items" : "keys"} </span>}{!open && c + comma}
      </div>
      {open && entries.map(([ck, cv], i) => (
        <Node key={ck} k={ck} value={cv} path={[...path, ck]} depth={depth + 1} selected={selected} onSelect={onSelect} last={i === entries.length - 1} />
      ))}
      {open && <div className="j-line" style={{ paddingLeft: depth * 14 }}>{c}{comma}</div>}
    </div>
  );
}
