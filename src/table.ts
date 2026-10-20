export type ArrayInfo = { path: string[]; length: number };
export type Sort = { col: string; dir: "asc" | "desc" } | null;
export type Row = { index: number; value: Record<string, unknown> };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Arrays whose items are mostly objects, searched a few levels deep; largest first, root first on ties. */
export function findArrays(value: unknown, maxDepth = 4): ArrayInfo[] {
  const out: ArrayInfo[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (path.length > maxDepth) return;
    if (Array.isArray(v)) {
      const objects = v.filter(isRecord).length;
      if (v.length > 0 && objects / v.length >= 0.8) out.push({ path, length: v.length });
      // Look inside the first item for nested lists such as orders[0].lines.
      if (isRecord(v[0])) for (const [k, child] of Object.entries(v[0])) if (Array.isArray(child)) walk(child, [...path, "0", k]);
      return;
    }
    if (isRecord(v)) for (const [k, child] of Object.entries(v)) walk(child, [...path, k]);
  };
  walk(value, []);
  // Paths through a specific item (".0.") are only useful when nothing better exists.
  return out.sort((a, b) => Number(a.path.includes("0")) - Number(b.path.includes("0")) || b.length - a.length || a.path.length - b.path.length);
}

export function getAt(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const p of path) cur = cur == null ? undefined : (cur as Record<string, unknown>)[p];
  return cur;
}

export function rowsOf(arr: unknown[]): Row[] {
  return arr.map((v, index) => ({ index, value: isRecord(v) ? v : { value: v } }));
}

/** Union of keys in order of first appearance. */
export function columnsOf(rows: Row[], sample = 500): string[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, sample)) for (const k of Object.keys(r.value)) seen.add(k);
  return [...seen];
}

const rank = (v: unknown) => (v === undefined ? 3 : v === null ? 2 : typeof v === "object" ? 1 : 0);

export function sortRows(rows: Row[], sort: Sort): Row[] {
  if (!sort) return rows;
  const { col, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a.value[col];
    const y = b.value[col];
    // Missing and null values always sink to the bottom, whichever direction.
    if (rank(x) || rank(y)) return rank(x) - rank(y) || a.index - b.index;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign || a.index - b.index;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * sign || a.index - b.index;
  });
}

export function cellText(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function toDelimited(rows: Row[], cols: string[], sep: "," | "\t"): string {
  const esc = (s: string) =>
    sep === "\t" ? s.replace(/[\t\n\r]+/g, " ") : /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return [cols.map(esc).join(sep), ...rows.map((r) => cols.map((c) => esc(cellText(r.value[c]))).join(sep))].join("\n");
}

/** Estimated column width in px from header and a sample of values. */
export function columnWidth(rows: Row[], col: string) {
  let chars = col.length + 2;
  // Sample evenly across the array so later, longer values (e.g. "Item 4000") are accounted for.
  const step = Math.max(1, Math.floor(rows.length / 80));
  for (let i = 0; i < rows.length; i += step) chars = Math.max(chars, Math.min(cellText(rows[i].value[col]).length, 48));
  if (rows.length) chars = Math.max(chars, Math.min(cellText(rows[rows.length - 1].value[col]).length, 48));
  return Math.round(Math.min(Math.max(chars * 7.4 + 24, 64), 360));
}
