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

## Workspace files

Choose **Save to folder…** (sidebar or ⌘K) to keep the workspace as plain files you can commit:

```
tether.json                          collection order
collections/<collection>/collection.json
collections/<collection>/<request>.json
environments/<environment>.json      variables only
.tether/                             history + selected environment (added to .gitignore)
```

Secrets are never written to the folder. They stay in the macOS Keychain (service `dev.tether.app`).
Changes made outside the app (e.g. `git pull`) are picked up when the window regains focus.
Run `cargo test -- --ignored` in `src-tauri` to exercise the real Keychain.
