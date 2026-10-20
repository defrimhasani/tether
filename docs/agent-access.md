# Agent access (MCP)

Tether can expose your saved requests to AI agents (Claude, Cursor, OpenCode, anything that speaks MCP) **without giving the agent your credentials**. The agent calls "Fetch profile" by name; Tether resolves auth from your environment and Keychain, runs the request, and returns a size-limited result.

## Principles

1. **The agent fills in blanks; it never rewrites a request.** It may only supply the `{{variables}}` a request leaves undefined. It cannot change the URL, host, method, auth headers or body structure. Agent-supplied values are rejected in the URL authority and in header names, and are escaped for the position they land in (URL path or query, header value, JSON string or value).
2. **Off by default, opt-in per request and per environment.** Grants are local decisions (`.tether/agent.json`, git-ignored), so pulling a teammate's workspace never grants an agent access.
3. **Reads run freely; writes need a human click.** GET, HEAD and OPTIONS run without prompting. POST, PUT, PATCH and DELETE show an approval sheet (allow once, or for this session).
4. **Everything is visible.** Agent runs appear in History with the agent's name, and Settings shows an activity log including denied calls. One switch turns the server off; one button revokes every grant.
5. **Responses are untrusted data.** Results carry a note saying so, are redacted for known secret values, and never skip approvals.

## Architecture

```
agent ── stdio ──▶ `tether --mcp` ── HTTP (127.0.0.1, bearer token) ──▶ MCP server in the app
                                                                   │ Tauri event
                                                                   ▼
                                                            frontend: policy, resolve, run, history
```

- The app runs a small MCP server bound to `127.0.0.1` on a random port. A bearer token is required, and requests with a browser `Origin` header are refused (DNS-rebinding defense). Port and token are written to `mcp.json` in the app data directory (mode 0600) while the server runs.
- `tether --mcp` is a stdio bridge built into the same binary. Clients configure it as a command; it reads `mcp.json` and forwards JSON-RPC to the app. No second binary to bundle or sign.
- The Rust side only speaks MCP framing. `tools/list` and `tools/call` are forwarded to the frontend, which owns the workspace, secrets, reference resolution, history and approval UI.

## Tools

| Tool | Purpose |
|---|---|
| `list_requests` | Enabled requests: name, method, URL template, description, inputs, dependencies |
| `describe_request` | One request in detail (header names, body template, inputs) |
| `run_request` | Run a request with `variables`, optional `environment`, `select`, `max_bytes` |
| `run_<request>` | One typed tool per enabled request; input schema derived from its `{{variables}}` |
| `list_environments` | Environments the agent may use |
| `get_last_response` | Latest stored response for a request, shaped |
| `search_history` | Recent runs, filterable by request and status |
| `create_draft_request` | Adds a request to "Agent drafts"; not runnable until a human enables it |

Inputs are the `{{variables}}` not defined by the active environment and not response references. Response references (`{{@login.body.token}}`) run their source request first when it is enabled and passes policy.

## Shaped responses

`run_request` returns `status`, `durationMs`, `size`, a filtered header subset, and a body that fits `max_bytes` (default 8,000):

- **Shape**: a compact type summary of the JSON (`items: Array<{id:number,name:string,...}> (5000)`).
- **select**: a path such as `data.items[0:5].name` or `users[*].email` returns just that slice.
- **Truncation**: arrays keep their first items and long strings are cut, with `truncated` and a hint to use `select`.

## Out of scope for this release

Monitors on a schedule, a mock server, capture proxy and OpenAPI contract checks (see the project board).
