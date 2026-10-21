import { METHODS, type KV, type Method, type RequestDef } from "./model";

export type Parsed = { request: Omit<RequestDef, "id">; warnings: string[] };

/** Splits a shell command line into words: quotes, backslash escapes, $'…' and line continuations. */
export function shellWords(input: string): string[] {
  const words: string[] = [];
  let cur = "";
  let started = false;
  const s = input.replace(/\\\r?\n/g, " ");
  const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (started) { words.push(cur); cur = ""; started = false; }
    } else if (c === "'") {
      started = true;
      const end = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end;
    } else if (c === "$" && s[i + 1] === "'") {
      started = true;
      i += 2;
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] === "\\" && i + 1 < s.length) { i++; cur += esc[s[i]] ?? `\\${s[i]}`; } else cur += s[i];
      }
    } else if (c === '"') {
      started = true;
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === "\\" && /["\\$`]/.test(s[i + 1] ?? "")) { i++; cur += s[i]; } else cur += s[i];
      }
    } else if (c === "\\" && i + 1 < s.length) {
      started = true;
      cur += s[++i];
    } else {
      started = true;
      cur += c;
    }
  }
  if (started) words.push(cur);
  return words;
}

const WITH_ARG = new Set([
  "-o", "--output", "-m", "--max-time", "--connect-timeout", "-w", "--write-out", "-x", "--proxy", "--cacert", "--cert", "--key",
  "-c", "--cookie-jar", "-T", "--upload-file", "--retry", "--retry-delay", "--resolve", "-K", "--config", "-D", "--dump-header", "--limit-rate",
  "--max-redirs", "--interface", "-E", "--proxy-user", "--noproxy", "-Y", "-y", "--http-version-arg",
]);

export const looksLikeCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text);

function isJson(text: string) {
  try { JSON.parse(text); return true; } catch { return false; }
}

function nameFor(method: string, url: string) {
  let path = url;
  try { path = new URL(url.replace(/\{\{[^}]+\}\}/g, "x")).pathname; } catch { /* keep as is */ }
  path = path.replace(/^https?:\/\/[^/]+/, "") || "/";
  return `${method} ${path.length > 40 ? `${path.slice(0, 40)}…` : path}`;
}

export function parseCurl(text: string): Parsed | { error: string } {
  const words = shellWords(text.trim());
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) return { error: "That doesn’t start with curl." };
  const warnings: string[] = [];
  const headers: KV[] = [];
  const data: string[] = [];
  let method: string | undefined;
  let url = "";
  let head = false;
  let get = false;
  let user: string | undefined;
  let jsonShortcut = false;

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const flag = eq > 0 ? w.slice(0, eq) : w;
    const inline = eq > 0 ? w.slice(eq + 1) : undefined;
    const arg = () => inline ?? words[++i] ?? "";

    if (flag === "-X" || flag === "--request") method = arg().toUpperCase();
    else if (flag === "-H" || flag === "--header") {
      const h = arg();
      const c = h.indexOf(":");
      if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim(), enabled: true });
    } else if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(flag)) {
      const v = arg();
      if (v.startsWith("@")) warnings.push(`Reading the body from a file (${v}) isn’t supported; the body was left empty.`);
      else data.push(v);
    } else if (flag === "--data-urlencode") data.push(arg());
    else if (flag === "--json") { data.push(arg()); jsonShortcut = true; }
    else if (flag === "-F" || flag === "--form") { arg(); warnings.push("Multipart form fields (-F) aren’t supported yet and were skipped."); }
    else if (flag === "-u" || flag === "--user") user = arg();
    else if (flag === "-b" || flag === "--cookie") headers.push({ key: "Cookie", value: arg(), enabled: true });
    else if (flag === "-A" || flag === "--user-agent") headers.push({ key: "User-Agent", value: arg(), enabled: true });
    else if (flag === "-e" || flag === "--referer") headers.push({ key: "Referer", value: arg(), enabled: true });
    else if (flag === "--url") url = arg();
    else if (flag === "-I" || flag === "--head") head = true;
    else if (flag === "-G" || flag === "--get") get = true;
    else if (flag === "--compressed") headers.push({ key: "Accept-Encoding", value: "gzip, deflate, br", enabled: false });
    else if (WITH_ARG.has(flag)) arg();
    else if (w.startsWith("-") && w !== "-") continue;
    else if (!url) url = w;
  }

  if (!url) return { error: "No URL found in that command." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("{{")) url = `http://${url}`;

  if (user) {
    const [name, ...rest] = user.split(":");
    if (!user.includes("{{") && typeof btoa === "function") headers.push({ key: "Authorization", value: `Basic ${btoa(`${name}:${rest.join(":")}`)}`, enabled: true });
    else warnings.push("Basic auth credentials contain variables; add the Authorization header yourself.");
  }
  if (jsonShortcut) {
    if (!headers.some((h) => h.key.toLowerCase() === "content-type")) headers.push({ key: "Content-Type", value: "application/json", enabled: true });
    if (!headers.some((h) => h.key.toLowerCase() === "accept")) headers.push({ key: "Accept", value: "application/json", enabled: true });
  }

  let body = data.join("&");
  if (get && body) {
    url += (url.includes("?") ? "&" : "?") + body;
    body = "";
  }
  const m = (method ?? (head ? "HEAD" : body ? "POST" : "GET")) as Method;
  if (!METHODS.includes(m)) { warnings.push(`Method ${m} isn’t supported; it was imported as GET.`); }
  const finalMethod = METHODS.includes(m) ? m : "GET";

  if (body && isJson(body)) body = JSON.stringify(JSON.parse(body), null, 2);
  const hasType = headers.some((h) => h.key.toLowerCase() === "content-type");
  if (body && !hasType && !isJson(body)) {
    headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
  }

  return { request: { name: nameFor(finalMethod, url), method: finalMethod, url, headers, body }, warnings };
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A runnable curl command. `resolve` fills in {{variables}} (pass identity to keep them as written). */
export function toCurl(req: Pick<RequestDef, "method" | "url" | "headers" | "body">, resolve: (s: string) => string = (s) => s): string {
  const hasBody = req.body.trim() !== "" && !["GET", "HEAD"].includes(req.method);
  const first = ["curl"];
  if (req.method === "HEAD") first.push("--head");
  else if (req.method !== "GET") first.push("-X", req.method);
  first.push(q(resolve(req.url)));
  const lines = [first.join(" ")];
  for (const h of req.headers) if (h.enabled && h.key.trim()) lines.push(`  -H ${q(`${resolve(h.key)}: ${resolve(h.value)}`)}`);
  if (hasBody) lines.push(`  --data-raw ${q(resolve(req.body))}`);
  return lines.join(" \\\n");
}
