export type Seg = { t: "key" | "string" | "number" | "bool" | "null" | "punct" | "ws" | "ref" | "text"; s: string };

const REF = /\{\{[^}]*\}\}/y;

/**
 * Lexes JSON that may contain `{{references}}`, both inside strings and in value position.
 * Lossless: joining every segment reproduces the input exactly, so it can paint an overlay.
 */
export function lexJsonTemplate(src: string): Seg[] {
  const out: Seg[] = [];
  const push = (t: Seg["t"], s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.t === t && t !== "ref") last.s += s;
    else out.push({ t, s });
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    REF.lastIndex = i;
    const ref = REF.exec(src);
    if (ref) { push("ref", ref[0]); i += ref[0].length; continue; }
    if (c === '"') {
      // Scan the string, splitting out references; it is a key if a ':' follows.
      const parts: Seg[] = [];
      let j = i + 1;
      let buf = '"';
      while (j < src.length && src[j] !== '"' && src[j] !== "\n") {
        REF.lastIndex = j;
        const r = REF.exec(src);
        if (r) { parts.push({ t: "string", s: buf }, { t: "ref", s: r[0] }); buf = ""; j += r[0].length; continue; }
        if (src[j] === "\\" && j + 1 < src.length) { buf += src.slice(j, j + 2); j += 2; continue; }
        buf += src[j++];
      }
      if (src[j] === '"') { buf += '"'; j++; }
      parts.push({ t: "string", s: buf });
      const isKey = /^\s*:/.test(src.slice(j, j + 50));
      for (const p of parts) push(p.t === "string" && isKey ? "key" : p.t, p.s);
      i = j;
      continue;
    }
    if (/\s/.test(c)) { const m = src.slice(i).match(/^\s+/)![0]; push("ws", m); i += m.length; continue; }
    if ("{}[]:,".includes(c)) { push("punct", c); i++; continue; }
    const num = src.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (num) { push("number", num[0]); i += num[0].length; continue; }
    const word = src.slice(i).match(/^(true|false|null)\b/);
    if (word) { push(word[0] === "null" ? "null" : "bool", word[0]); i += word[0].length; continue; }
    push("text", c);
    i++;
  }
  return out;
}

export function looksLikeJson(src: string) {
  return /^\s*[[{]/.test(src);
}

export type FormatResult = { ok: true; text: string } | { ok: false; error: string; line?: number; column?: number };

/** Replaces references with placeholders so the text parses as JSON; bare (unquoted) references are quoted. */
function protect(src: string) {
  const refs: string[] = [];
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    REF.lastIndex = i;
    const r = REF.exec(src);
    if (r) {
      const id = refs.push(r[0]) - 1;
      out += inString ? `\uE000R${id}\uE001` : `"\uE000B${id}\uE001"`;
      i += r[0].length - 1;
      continue;
    }
    const c = src[i];
    if (c === "\\" && inString) { out += src.slice(i, i + 2); i++; continue; }
    if (c === '"') inString = !inString;
    out += c;
  }
  return { text: out, refs };
}

function restore(text: string, refs: string[]) {
  return text
    .replace(/"\uE000B(\d+)\uE001"/g, (_, n) => refs[Number(n)])
    .replace(/\uE000R(\d+)\uE001/g, (_, n) => refs[Number(n)]);
}

/** Minimal JSON validator that reports where parsing fails (V8 messages no longer include a position). */
function locateError(src: string): { at: number; message: string } {
  let i = 0;
  const fail = (message: string): never => { throw { at: i, message }; };
  const ws = () => { while (i < src.length && " \t\n\r".includes(src[i])) i++; };
  const value = (): void => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++; ws();
      if (src[i] === "}") { i++; return; }
      for (;;) {
        ws(); if (src[i] !== '"') fail("Expected a property name in double quotes");
        str(); ws(); if (src[i] !== ":") fail("Expected ':' after property name"); i++;
        value(); ws();
        if (src[i] === ",") { i++; ws(); if (src[i] === "}") fail("Trailing comma"); continue; }
        if (src[i] === "}") { i++; return; }
        fail("Expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++; ws();
      if (src[i] === "]") { i++; return; }
      for (;;) {
        value(); ws();
        if (src[i] === ",") { i++; ws(); if (src[i] === "]") fail("Trailing comma"); continue; }
        if (src[i] === "]") { i++; return; }
        fail("Expected ',' or ']'");
      }
    }
    if (c === '"') return str();
    const lit = src.slice(i).match(/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/);
    if (lit) { i += lit[0].length; return; }
    fail(c === undefined ? "Unexpected end of input" : `Unexpected '${c}'`);
  };
  const str = () => {
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\n") fail("Unterminated string");
      i += src[i] === "\\" ? 2 : 1;
    }
    if (src[i] !== '"') fail("Unterminated string");
    i++;
  };
  try {
    value(); ws();
    if (i < src.length) fail(`Unexpected '${src[i]}' after the end of the JSON`);
  } catch (e) {
    if (e && typeof e === "object" && "at" in e) return e as { at: number; message: string };
    throw e;
  }
  return { at: i, message: "Invalid JSON" };
}

export function formatJsonTemplate(src: string, indent: number | "" = 2): FormatResult {
  if (!src.trim()) return { ok: true, text: src };
  const { text, refs } = protect(src);
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, indent);
    return { ok: true, text: restore(formatted, refs) };
  } catch {
    // Placeholders have the same length structure as references only on the same line, so report on the original text.
    const { at, message } = locateError(text);
    const before = text.slice(0, at).replace(/"?\uE000[RB]\d+\uE001"?/g, (m) => refs[Number(m.match(/\d+/)![0])]).split("\n");
    return { ok: false, error: message, line: before.length, column: before[before.length - 1].length + 1 };
  }
}
