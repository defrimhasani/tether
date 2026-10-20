import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { listenMcp, mcpAvailable, mcpStart, mcpStop, type McpRequest, type McpStatus } from "./mcp";

const KEY = "tether.agent.enabled";

/** Owns the local MCP server's lifecycle. The server is off unless the user turned it on. */
export function useAgent(handler: (req: McpRequest) => Promise<unknown>) {
  const available = mcpAvailable();
  const [enabled, setEnabledState] = useState(() => available && localStorage.getItem(KEY) === "1");
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Debug builds can start with Agent access on (for automated tests); release builds never do.
  useEffect(() => {
    if (available) invoke<boolean>("agent_autostart").then((on) => on && setEnabledState(true)).catch(() => {});
  }, [available]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        if (enabled) {
          // Listen before starting so no early request is missed.
          unlisten = await listenMcp((r) => handlerRef.current(r));
          if (cancelled) return unlisten();
          setStatus(await mcpStart());
        } else setStatus(await mcpStop());
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [available, enabled]);

  const setEnabled = (on: boolean) => {
    localStorage.setItem(KEY, on ? "1" : "0");
    setEnabledState(on);
  };

  return { available, enabled, setEnabled, status, error };
}
