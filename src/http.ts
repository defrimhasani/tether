import { invoke, isTauri } from "@tauri-apps/api/core";
import { decodeResponse, toBase64, type RawResponse } from "./body";
import type { HttpResponse, SendError } from "./model";

export type Outgoing = { id: string; method: string; url: string; headers: [string, string][]; body?: string; timeoutMs?: number };

const controllers = new Map<string, AbortController>();

export async function send(req: Outgoing): Promise<HttpResponse> {
  if (isTauri()) return decodeResponse(await invoke<RawResponse>("send_request", { req }));

  // Browser preview fallback (subject to CORS); the desktop app uses the Rust client.
  const ctrl = new AbortController();
  controllers.set(req.id, ctrl);
  const timeoutMs = req.timeoutMs ?? 30000;
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal });
    const buf = await res.arrayBuffer();
    return decodeResponse({
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      bodyBase64: toBase64(new Uint8Array(buf)),
      truncated: false,
      size: buf.byteLength,
      durationMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    if (ctrl.signal.aborted)
      throw (ctrl.signal.reason === "timeout" ? { kind: "timeout", afterMs: timeoutMs } : { kind: "cancelled" }) satisfies SendError;
    throw { kind: "connection", message: String((e as Error).message ?? e) } satisfies SendError;
  } finally {
    clearTimeout(timer);
    controllers.delete(req.id);
  }
}

export async function cancel(id: string) {
  if (isTauri()) return invoke("cancel_request", { id });
  controllers.get(id)?.abort("cancel");
}
