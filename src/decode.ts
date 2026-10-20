export type Decoded =
  | { kind: "jwt"; header: Record<string, unknown>; payload: Record<string, unknown>; expiresAt?: Date; issuedAt?: Date }
  | { kind: "time"; date: Date; source: "seconds" | "milliseconds" | "iso" }
  | { kind: "base64"; text: string; json?: unknown }
  | { kind: "color"; css: string }
  | { kind: "url"; url: string };

const MIN_TS = Date.UTC(2000, 0, 1) / 1000;
const MAX_TS = Date.UTC(2100, 0, 1) / 1000;
/** Numbers are only treated as timestamps when the key says so; otherwise every large ID would get a badge. */
const TIME_KEY = /(^|_|-|[a-z])(at|time|date|ts|timestamp|exp|expires|expiry|iat|nbf|created|updated|modified|deleted|since|until|start|end|last[_-]?seen)$/i;
const COLOR_KEY = /colou?r|^(bg|fg)$|background|foreground|fill|stroke|tint|accent/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$|^[A-Za-z0-9_-]+$/;

function b64decode(s: string): string | null {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const parseJson = (s: string) => { try { return JSON.parse(s) as unknown; } catch { return undefined; } };

function printableRatio(s: string) {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) if (/[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n\r\t]/u.test(ch)) ok++;
  return ok / [...s].length;
}

export function decodeJwt(s: string): Extract<Decoded, { kind: "jwt" }> | null {
  if (!JWT.test(s)) return null;
  const [h, p] = s.split(".");
  const header = parseJson(b64decode(h) ?? "");
  const payload = parseJson(b64decode(p) ?? "");
  if (!isRecord(header) || typeof header.alg !== "string" || !isRecord(payload)) return null;
  const at = (v: unknown) => (typeof v === "number" ? new Date(v * 1000) : undefined);
  return { kind: "jwt", header, payload, expiresAt: at(payload.exp), issuedAt: at(payload.iat) };
}

export function decodeValue(value: unknown, key = ""): Decoded | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !TIME_KEY.test(key)) return null;
    if (value >= MIN_TS && value <= MAX_TS) return { kind: "time", date: new Date(value * 1000), source: "seconds" };
    if (value >= MIN_TS * 1000 && value <= MAX_TS * 1000) return { kind: "time", date: new Date(value), source: "milliseconds" };
    return null;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  const jwt = decodeJwt(s);
  if (jwt) return jwt;

  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s)) {
    try { return { kind: "url", url: new URL(s).toString() }; } catch { /* not a URL */ }
  }

  if (ISO_DATE.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    if (!Number.isNaN(d.getTime())) return { kind: "time", date: d, source: "iso" };
  }
  if (/^\d{10}(\d{3})?$/.test(s) && TIME_KEY.test(key)) return decodeValue(Number(s), key);

  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || (/^#[0-9a-f]{3}$/i.test(s) && COLOR_KEY.test(key)) || /^(?:rgba?|hsla?)\(\s*[\d.]+%?(?:\s*[, ]\s*[\d.]+%?){2}(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.test(s)) {
    return { kind: "color", css: s };
  }

  // Base64: long enough, not a plain word or number, and decodes to readable text.
  if (s.length >= 16 && B64.test(s) && /[0-9+/=_-]/.test(s) && /[A-Za-z]/.test(s) && !/^[0-9a-f]+$/i.test(s)) {
    const text = b64decode(s);
    if (text && text.length >= 4 && printableRatio(text) > 0.95) {
      const json = parseJson(text);
      return { kind: "base64", text, ...(json !== undefined && typeof json === "object" ? { json } : {}) };
    }
  }
  return null;
}

/** "in 14 min", "2 h ago", "3 days ago". */
export function relativeTime(date: Date, now = new Date()) {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [[365 * 864e5, "y"], [30 * 864e5, "mo"], [864e5, "day"], [36e5, "h"], [6e4, "min"], [1e3, "s"]];
  for (const [ms, unit] of units) {
    if (abs >= ms || unit === "s") {
      const n = Math.max(1, Math.round(abs / ms));
      const label = unit === "day" ? (n === 1 ? "day" : "days") : unit;
      return abs < 5000 ? "just now" : diff > 0 ? `in ${n} ${label}` : `${n} ${label} ago`;
    }
  }
  return "";
}
