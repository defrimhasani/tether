import { TOKEN } from "../refs";
import type { RequestDef } from "../model";

export type InputError = { variable: string; reason: string };

const CONTROL = /[\r\n\0]/;

/** Agent values may only fill pre-existing `{{name}}` holes; they must never gain control of the host or headers. */
export function validateInputs(request: RequestDef, values: Record<string, unknown>, allowed: string[]): InputError[] {
  const errors: InputError[] = [];
  for (const [name, raw] of Object.entries(values)) {
    if (!allowed.includes(name)) { errors.push({ variable: name, reason: "is not an input for this request" }); continue; }
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") { errors.push({ variable: name, reason: "must be a string, number or boolean" }); continue; }
    const value = String(raw);
    if (CONTROL.test(value)) { errors.push({ variable: name, reason: "cannot contain a newline or control character" }); continue; }
    for (const text of [request.url, ...request.headers.map((h) => h.value)]) {
      const at = text.indexOf(`{{${name}}}`);
      if (at < 0) continue;
      if (text === request.url) {
        // Value in protocol/host/port/userinfo before the first / after // is forbidden.
        const beforePath = text.search(/\/\//) >= 0 ? text.slice(text.indexOf("//") + 2).search(/[/?#]/) : -1;
        const authorityEnd = beforePath < 0 ? text.length : text.indexOf("//") + 2 + beforePath;
        if (at < authorityEnd) errors.push({ variable: name, reason: "cannot be used in a URL host, protocol or port" });
      }
    }
  }
  return errors;
}

/** Substitution is literal. We intentionally don't URL encode: the saved request defines its encoding and syntax. */
export function applyInputs(text: string, values: Record<string, unknown>) {
  return text.replace(TOKEN, (whole, name: string) => Object.hasOwn(values, name) ? String(values[name]) : whole);
}

export function resolveWithInputs(request: RequestDef, values: Record<string, unknown>): RequestDef {
  return {
    ...request,
    url: applyInputs(request.url, values),
    body: applyInputs(request.body, values),
    headers: request.headers.map((h) => ({ ...h, value: applyInputs(h.value, values) })),
  };
}

const SECRET_NAME = /authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|token|secret|password|session/i;
export function redact(text: string, secrets: string[]) {
  let out = text;
  for (const s of secrets.filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join("[secret]");
  return out;
}
export function redactHeaders(headers: [string, string][], secrets: string[]) {
  return headers.map(([k, v]) => [k, SECRET_NAME.test(k) ? "[secret]" : redact(v, secrets)] as [string, string]);
}
