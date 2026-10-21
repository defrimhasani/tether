# Tether

A local-first HTTP workbench for macOS, Windows and Linux (Tauri 2 + React).

```sh
pnpm install
pnpm tauri dev      # desktop app
pnpm dev            # browser preview (requests subject to CORS)
pnpm tauri build    # installers for the current OS (.app/.dmg, .exe/.msi, .AppImage/.deb)
```

## Install

Download the installer for your system from [GitHub Releases](https://github.com/defrimhasani/tether/releases/latest). The builds are not code-signed yet, so each OS warns the first time:

- **macOS** (`Tether-macOS-universal.dmg`, Apple silicon and Intel): drag Tether to Applications, then right-click it → **Open** → **Open** the first time. Or run `xattr -dr com.apple.quarantine /Applications/Tether.app`.
- **Windows** (`Tether-Windows-x64-setup.exe` or `.msi`): if SmartScreen appears, choose **More info** → **Run anyway**.
- **Linux**: `chmod +x Tether-Linux-x86_64.AppImage && ./Tether-Linux-x86_64.AppImage`, or `sudo apt install ./Tether-Linux-amd64.deb`. Secrets need a Secret Service provider (GNOME Keyring or KWallet).

## Releasing

1. Bump the version in `src-tauri/tauri.conf.json`, `package.json` and `src-tauri/Cargo.toml`.
2. Commit, then `git tag vX.Y.Z && git push --tags`.

The [Release workflow](.github/workflows/release.yml) builds macOS (universal), Windows and Linux installers and publishes them to a GitHub Release, plus copies under fixed names (e.g. `Tether-macOS-universal.dmg`) so `https://github.com/defrimhasani/tether/releases/latest/download/<name>` always points at the newest build. The tag must match the version in `tauri.conf.json`.

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

Secrets are never written to the folder. They stay in the OS credential store (service `dev.tether.app`): the macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
Changes made outside the app (e.g. `git pull`) are picked up when the window regains focus.
Run `cargo test -- --ignored` in `src-tauri` to exercise the real credential store.
