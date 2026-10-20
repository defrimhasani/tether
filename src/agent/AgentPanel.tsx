import { Bot, Check, Copy } from "lucide-react";
import { useState } from "react";
import type { McpStatus } from "./mcp";

export type AgentController = { available: boolean; enabled: boolean; setEnabled: (on: boolean) => void; status: McpStatus | null; error: string | null };

const quote = (s: string) => (/[\s"'$]/.test(s) ? `"${s.replace(/(["\\$`])/g, "\\$1")}"` : s);

export function snippets(exe: string) {
  return [
    { id: "claude-code", label: "Claude Code", hint: "Run in a terminal", text: `claude mcp add tether -- ${quote(exe)} --mcp` },
    {
      id: "json", label: "Claude Desktop · Cursor", hint: "Add to mcpServers in the client's MCP config",
      text: JSON.stringify({ mcpServers: { tether: { command: exe, args: ["--mcp"] } } }, null, 2),
    },
    {
      id: "opencode", label: "OpenCode", hint: "Add to opencode.json",
      text: JSON.stringify({ mcp: { tether: { type: "local", command: [exe, "--mcp"], enabled: true } } }, null, 2),
    },
  ];
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="snippet">
      <pre>{text}</pre>
      <button className="ghost small" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}>
        {done ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
      </button>
    </div>
  );
}

export function AgentPanel({ agent, onClose }: { agent: AgentController; onClose: () => void }) {
  const [tab, setTab] = useState("claude-code");
  const list = snippets(agent.status?.exe ?? "tether");
  const current = list.find((s) => s.id === tab) ?? list[0];
  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal agent" role="dialog" aria-label="Agent access" onMouseDown={(e) => e.stopPropagation()}>
        <div className="agent-body">
          <header>
            <Bot size={20} aria-hidden />
            <div>
              <h2>Agent access</h2>
              <p className="muted">Let AI agents run your saved requests. They get results, never your credentials.</p>
            </div>
          </header>

          {!agent.available ? (
            <p className="note">Agent access is part of the desktop app. Open Tether on your Mac to use it.</p>
          ) : (
            <>
              <section className="agent-row">
                <div>
                  <strong>Allow agents to connect</strong>
                  <p className="muted small">
                    {agent.enabled
                      ? agent.status?.running ? `Listening on this Mac only (127.0.0.1:${agent.status.port}).` : "Starting…"
                      : "Off. Nothing can connect until you turn this on."}
                  </p>
                </div>
                <Switch checked={agent.enabled} onChange={agent.setEnabled} label="Allow agents to connect" />
              </section>
              {agent.error && <p className="why" role="alert">{agent.error}</p>}

              <section>
                <h3>Connect an agent</h3>
                <p className="muted small">Agents start Tether's bridge as a command. It talks to this app, so it works only while Tether is open.</p>
                <div className="seg" role="tablist">
                  {list.map((s) => <button key={s.id} role="tab" aria-selected={tab === s.id} onClick={() => setTab(s.id)}>{s.label}</button>)}
                </div>
                <p className="muted small hint">{current.hint}</p>
                <CopyBlock text={current.text} />
              </section>
            </>
          )}
        </div>
        <footer className="modal-foot"><button className="primary" onClick={onClose}>Done</button></footer>
      </div>
    </div>
  );
}
