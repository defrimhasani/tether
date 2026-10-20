# Tether

A local-first HTTP workbench for macOS (Tauri 2 + React).

```sh
pnpm install
pnpm tauri dev      # desktop app
pnpm dev            # browser preview (requests subject to CORS)
pnpm tauri build    # .app / .dmg
```

## References

| Syntax | Resolves to |
| --- | --- |
| `{{name}}` | Active environment variable or secret |
| `{{@create_session.status}}` | Latest response status of "Create session" |
| `{{@create_session.headers.etag}}` | Response header |
| `{{@create_session.body.data.token}}` | JSON path into the response body |

Click any response field → **Use in request** or **Copy reference**. Unresolved references block sending and offer a fix.

## Shortcuts

⌘↵ send · ⌘. cancel · ⌘S save · ⌘K command palette · ⌘N new request · ⌘E environments

## Status

Persistence is currently `localStorage`, with secrets stored separately. Next: Git-friendly collection files on disk and macOS Keychain for secrets.
