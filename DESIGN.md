# Tether design system

Native macOS, Liquid Glass era (macOS Tahoe). Tether should feel like an app Apple shipped, not a web page in a frame. The world contributes material, type, palette and density; layout, navigation and controls stay standard macOS patterns.

## Window and material

- **Real vibrancy.** The Tauri window is transparent (`transparent`, `macOSPrivateApi`) with the `underWindowBackground` effect, an overlay title bar, a hidden title, and traffic lights at (22, 26) inside the sidebar. The page sets `html.native` and leaves `body` transparent. The browser preview paints a soft backdrop instead.
- **Floating sidebar.** Inset 8px from the window edge, radius 18px, translucent fill (`--sidebar`) with `backdrop-filter: blur(40px) saturate(190%)`, a 0.5px edge, an inner top highlight and a soft drop shadow (`--shadow-pane`).
- **Canvas.** Opaque `--canvas` content area running under the sidebar's rounded edge. Panes sit on it as `--canvas-2` rounded rectangles (radius 14px) with a hairline instead of a border.
- **Glass controls** (`.glass`): `--glass` fill, 24px blur, 0.5px edge, `--shadow-float`. Used for the URL capsule, the environment group, the command button, the Save pill.
- **Floating glass surfaces:** menus (radius 12px), command palette (22px), confirmation dialog (22px), field inspector (16px). These use `--glass-strong` with `--shadow-pop` and enter with `glass-in` (260ms, expo ease-out: rise 4px, scale 0.97, blur 3px → sharp).
- **Sheets that hold editing** (environments) stay opaque `--canvas` for legibility.

## Color

Restrained: neutral system materials plus the user's macOS accent (`-apple-system-control-accent`, falling back to `#0a84ff`). Light and dark follow `prefers-color-scheme`.

| Role | Light | Dark |
|---|---|---|
| Labels `--ink` / `-2` / `-3` / `-4` | Apple label hierarchy on black | on white |
| GET / success | `--green` #1d8a3a | #30d158 |
| POST / warning | `--orange` #b35c00 | #ff9f0a |
| PUT / variable | `--blue` #0062cc | #409cff |
| PATCH / response reference | `--purple` #8944ab | #da8fff |
| DELETE / error | `--red` #d70015 | #ff6961 |

Light-mode system colors are darkened for text contrast. Tints are `color-mix(…, transparent)` at 12–16%. Color always sits next to a text label (method name, status code), never alone.

## Type

SF Pro via `-apple-system`, 13px base, tracking -0.003em. Request title 15px / 650. First-run heading 22px / 700. Section labels 11px / 600 in `--ink-3`. SF Mono (`ui-monospace`) only for code: URLs, headers, bodies, JSON, references, method badges. Numbers in the response summary are tabular.

## Shape and spacing

Capsules (999px) for buttons, segmented controls, search, tabs, status pills and the URL bar. 8px radius for list rows and tool buttons, 9px for text fields. Sidebar rows are 28px. The toolbar is 52px. The URL capsule is 44px with a 34px Send button.

## Selection and focus

- The selected sidebar row is accent-tinted (16%). It becomes a solid accent fill with white text while the sidebar has focus, as in Finder.
- Menus and the palette highlight the hovered or keyboard-active item with a solid accent fill.
- Text fields show a 3.5px accent ring at about 30%. List rows and tabs use a 2px inset ring.
- Text selection and the caret use the accent.

## Icons

Lucide, 13–16px, a single stroke weight. No emoji or Unicode glyphs as icons.

## Motion

One family: `--ease` = `cubic-bezier(0.16, 1, 0.3, 1)`. Floating glass enters with `glass-in`; buttons press to scale 0.96–0.97. Everything collapses to near-instant under `prefers-reduced-motion`.

## Transparency setting

Settings (⌘,) → Appearance → **Transparency** (0–100%, default 45%) scales the opacity of the sidebar, glass controls and floating menus through `--sidebar-a`, `--glass-a` and `--glass-strong-a` (set in `src/settings.ts`). Even at 100% surfaces keep at least 38% (sidebar and controls) or 60% (menus) opacity for legibility. At 0% the page gets an opaque backdrop (`html.solid`) and the native window material is removed. macOS "Reduce transparency" always forces solid and disables the slider.
