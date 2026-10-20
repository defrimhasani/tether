export type BodyKind = "json" | "html" | "xml" | "text" | "binary";

export function contentType(headers: [string, string][]) {
  return headers.find(([k]) => k.toLowerCase() === "content-type")?.[1].split(";")[0].trim().toLowerCase() ?? "";
}

export function detectKind(headers: [string, string][], body: string): BodyKind {
  const ct = contentType(headers);
  if (/^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|gzip)/.test(ct) && !ct.includes("svg")) return "binary";
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml") || ct.includes("svg")) return "xml";
  const head = body.trimStart().slice(0, 64).toLowerCase();
  if (head.startsWith("{") || head.startsWith("[")) {
    try { JSON.parse(body); return "json"; } catch { /* fall through */ }
  }
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "html";
  if (head.startsWith("<?xml") || /^<[a-z][\w:-]*[\s>]/.test(head)) return "xml";
  // Lossy UTF-8 decoding shows up as replacement characters.
  const bad = (body.slice(0, 2000).match(/\uFFFD/g) ?? []).length;
  return bad > 8 ? "binary" : "text";
}

export type Tok = { t: "tag" | "attr" | "val" | "punct" | "comment" | "text" | "doctype"; s: string };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "pre", "textarea"]);

/** Re-indents markup two spaces per level. Leaves script/style/pre contents untouched. */
export function formatMarkup(src: string): string {
  const parts = src.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  const out: string[] = [];
  let depth = 0;
  let raw: string | null = null;
  const pad = () => "  ".repeat(Math.max(depth, 0));
  for (const p of parts) {
    if (raw) {
      if (new RegExp(`^</${raw}\\s*>$`, "i").test(p)) {
        raw = null;
        depth--;
        out.push(pad() + p);
      } else out[out.length - 1] += p;
      continue;
    }
    if (!p.startsWith("<")) {
      const text = p.trim();
      if (text) out.push(pad() + text.replace(/\s+/g, " "));
      continue;
    }
    const name = p.match(/^<\/?([\w:-]+)/)?.[1]?.toLowerCase() ?? "";
    if (p.startsWith("</")) {
      depth--;
      // Keep short elements like <b>hi</b> on one line.
      const prev = out[out.length - 1];
      const open = out[out.length - 2];
      if (prev !== undefined && open !== undefined && !prev.trimStart().startsWith("<") && open.trim().toLowerCase().startsWith(`<${name}`) && !open.trim().endsWith("/>") && prev.length < 80) {
        out.splice(-2, 2, open + prev.trim() + p);
      } else out.push(pad() + p);
    } else if (p.startsWith("<!") || p.startsWith("<?") || p.endsWith("/>") || VOID.has(name)) {
      out.push(pad() + p);
    } else {
      out.push(pad() + p);
      depth++;
      if (RAW_TEXT.has(name)) { raw = name; out.push(""); }
    }
  }
  return out.filter((l, i) => l !== "" || out[i - 1] !== "").join("\n");
}

export function tokenizeMarkup(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<\/?[\w:-]+(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+|</g;
  for (const m of src.matchAll(re)) {
    const s = m[0];
    if (s.startsWith("<!--")) toks.push({ t: "comment", s });
    else if (s.startsWith("<!") || s.startsWith("<?")) toks.push({ t: "doctype", s });
    else if (s.startsWith("<") && s.length > 1) {
      const head = s.match(/^<\/?[\w:-]+/)![0];
      toks.push({ t: "punct", s: head.startsWith("</") ? "</" : "<" }, { t: "tag", s: head.replace(/^<\/?/, "") });
      let rest = s.slice(head.length);
      const end = rest.match(/\s*\/?>$/)?.[0] ?? "";
      rest = rest.slice(0, rest.length - end.length);
      for (const a of rest.matchAll(/(\s+)([^\s=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|\S+))?/g)) {
        toks.push({ t: "text", s: a[1] }, { t: "attr", s: a[2] });
        if (a[3]) toks.push({ t: "punct", s: a[3] }, { t: "val", s: a[4] });
      }
      toks.push({ t: "punct", s: end });
    } else toks.push({ t: "text", s });
  }
  return toks;
}

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$|token|secret|password|session/i;

/** Masks the middle of sensitive header values so history doesn't leak credentials at a glance. */
export function maskHeader(name: string, value: string) {
  if (!SENSITIVE.test(name) || value.length < 8) return value;
  const [scheme, ...rest] = value.split(" ");
  const secret = rest.length && /^(bearer|basic|token|digest)$/i.test(scheme) ? rest.join(" ") : value;
  const prefix = secret === value ? "" : `${scheme} `;
  return secret.length <= 8 ? `${prefix}••••••` : `${prefix}${secret.slice(0, 4)}••••••${secret.slice(-4)}`;
}
