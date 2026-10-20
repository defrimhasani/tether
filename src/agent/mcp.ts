import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type McpStatus = { running: boolean; port: number | null; exe: string; configPath: string };
export type McpRequest = { id: number; method: string; params: unknown; client: string | null };

/** A JSON-RPC error returned to the agent. */
export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export const INVALID_PARAMS = -32602;
export const METHOD_NOT_FOUND = -32601;

export const mcpAvailable = () => isTauri();
export const mcpStart = () => invoke<McpStatus>("mcp_start");
export const mcpStop = () => invoke<McpStatus>("mcp_stop");
export const mcpStatus = () => invoke<McpStatus>("mcp_status");

const toRpc = (e: unknown) =>
  e instanceof RpcError ? { code: e.code, message: e.message } : { code: -32603, message: e instanceof Error ? e.message : String(e) };

/** Answers each MCP request from the local server with the handler's result or error. */
export function listenMcp(handler: (req: McpRequest) => Promise<unknown>) {
  return listen<McpRequest>("mcp://request", async ({ payload }) => {
    try {
      const result = await handler(payload);
      await invoke("mcp_respond", { id: payload.id, result });
    } catch (e) {
      await invoke("mcp_respond", { id: payload.id, error: toRpc(e) });
    }
  });
}
