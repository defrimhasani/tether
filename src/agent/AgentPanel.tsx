import { Bot, Check, Copy } from "lucide-react";
import { useState } from "react";
import type { McpStatus } from "./mcp";
import { allRequests, type Workspace } from "../model";
import { allowed, isWrite, setGrant, type AgentPolicy } from "./policy";

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

export function AgentPanel({ agent, ws, policy, setPolicy, activity, onClose }: { agent: AgentController; ws: Workspace; policy: AgentPolicy; setPolicy: (p: AgentPolicy) => void; activity: { at: number; agent: string; request: string; outcome: string }[]; onClose: () => void }) {
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
                <h3>Allowed requests</h3>
                <p className="muted small">Only enabled requests and environments are visible to agents. Read requests run immediately; writes ask in Tether.</p>
                <div className="grants">
                  {allRequests(ws).map(({ request }) => (
                    <div className="grant" key={request.id}>
                      <code className={`m-${request.method}`}>{request.method}</code>
                      <span>{request.name}</span>
                      <select aria-label={`Environment for ${request.name}`} value="" onChange={(e) => { if (e.target.value) setPolicy(setGrant(policy, request.id, e.target.value, true)); e.currentTarget.value = ""; }}>
                        <option value="">+ environment</option>
                        {ws.environments.filter((env) => !allowed(policy, request, env.id)).map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
                      </select>
                      <span className="grant-envs">
                        {policy.grants.find((g) => g.requestId === request.id)?.environments.map((id) => {
                          const env = ws.environments.find((e) => e.id === id);
                          return <button key={id} title={`Revoke ${env?.name ?? id}`} onClick={() => setPolicy(setGrant(policy, request.id, id, false))}>{env?.name ?? id} ×</button>;
                        })}
                      </span>
                      {isWrite(request) && <span className="grant-write">asks first</span>}
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3>Connect an agent</h3>
                <p className="muted small">Agents start Tether's bridge as a command. It talks to this app, so it works only while Tether is open.</p>
                <div className="seg" role="tablist">
                  {list.map((s) => <button key={s.id} role="tab" aria-selected={tab === s.id} onClick={() => setTab(s.id)}>{s.label}</button>)}
                </div>
                <p className="muted small hint">{current.hint}</p>
                <CopyBlock text={current.text} />
              </section>
              <section>
                <h3>Recent activity</h3>
                <div className="activity">
                  {activity.length ? activity.slice(0, 8).map((x, i) => <p key={i}><span className={x.outcome === "allowed" ? "ok" : "why"}>{x.outcome}</span> · {x.agent} · {x.request} <time>{new Date(x.at).toLocaleTimeString()}</time></p>) : <p className="muted small">No agent calls yet.</p>}
                </div>
              </section>
            </>
          )}
        </div>
        <footer className="modal-foot"><button className="primary" onClick={onClose}>Done</button></footer>
      </div>
    </div>
  );
}
