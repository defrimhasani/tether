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

**Send pulse.** While a request is in flight, the accent is the only thing that moves:

- The URL capsule breathes an accent ring (0 → 9px, 45% → 0, 1.8s `--ease`, looping), while a soft light sweeps across it (a gradient band 40% wide at 16% accent, 1.6s ease-in-out).
- The Send button becomes a neutral `--fill` Cancel button.
- In the sidebar, the request's method label blinks to 35% opacity (1.2s), and a 7px accent dot pings beside it (scales 2.8× and fades, 1.4s). The dot turns white on a solid-accent selected row.
- The empty response pane shows a 12px accent sonar dot. It breathes to 0.82 scale while two 1.5px rings expand 4.5× and fade, 0.9s apart, on a 1.8s cycle.
- Under reduced motion, all of this stops, and the capsule holds a static 3px ring at 35% accent.

## Transparency setting

Settings (⌘,) → Appearance → **Transparency** (0–100%, default 45%) scales the opacity of the sidebar, glass controls and floating menus through `--sidebar-a`, `--glass-a` and `--glass-strong-a` (set in `src/settings.ts`). Even at 100% surfaces keep at least 38% (sidebar and controls) or 60% (menus) opacity for legibility. At 0% the page gets an opaque backdrop (`html.solid`) and the native window material is removed. macOS "Reduce transparency" always forces solid and disables the slider.

## Pixel landscape

Tether's scenery: a pixel-art landscape with a sun by day and a moon and stars by night. A paper plane flies across it. It follows `prefers-color-scheme`. Each layer is a generated SVG mask with `shape-rendering: crispEdges`, filled with a CSS color, so it can change palette without new art. The layers are: stars (dark mode only, `box-shadow` points), sun or moon, clouds, two or three hill ranges, and the plane. The plane is a `box-shadow` sprite with an accent body and a darker accent fold.

- **Stepped motion only.** Every layer moves with `steps()`, never smooth tweening. Clouds and hills pan their full tile width over 7–27 minutes at different speeds, giving a slow parallax. The plane crosses in hard steps with a one-step bob, and the stars twinkle in 3–4 steps. All of it stops under `prefers-reduced-motion`.
- **In the app** (`src/Scenery.tsx`, `.scenery`), it is faint wallpaper behind the main canvas (`z-index: -1`, `aria-hidden`), drawn in 4px pixels. Every layer is a tint: the far range is 10% accent (14% dark), the near range 15–16% teal, clouds are 4.5% black or white, the orb 28% orange by day and 22% label-white by night, and the plane sits at 55% opacity. Panes use 70% `--canvas-2` so the landscape faintly shows through.
- **On the site** (`site/scenery.css`, `.land`), it is the page ground, drawn in 6px pixels with opaque color. The sky is five hard horizontal bands, with no gradient blending.

| Layer | Light (day) | Dark (night) |
|---|---|---|
| Sky bands, top → bottom | #c9dcf2 → #f1f5fa | #070b18 → #16223e |
| Far / mid / near range | #bccbe8 / #9db8db / #6ea9a4 | #213259 / #1a2a4c / #123a48 |
| Orb (108px) | sun #ffb340 | moon #ece8d6 (own mask) |
| Clouds | white 85% | rgb(160 180 220 / 12%) |

**The Same Plane Rule.** The brand mark is the landscape's paper plane, redrawn at 2px pixels (22×14) in the accent color. It is the only logo.

## Marketing site (site/)

The public landing page (`site/index.html`, `styles.css`, `app.js`, `scenery.css`) carries the app's world to the web. The command palette is both the hero and the navigation. The other sections hold working replicas of app windows, menus and sheets, set over the pixel landscape. Surface and label tokens copy the app's names. The values below are where the site deliberately differs.

| Token | Light | Dark | Why |
|---|---|---|---|
| `--page` page ground | #eef2f7 | #0b0f1c | Behind sections, between the landscapes |
| `--accent` fill | #0071e3 | #0071e3 | Fixed, because a web page cannot read the system accent; white text on it passes 4.5:1 |
| `--link` text links | #0062cc | #409cff | Same as `--blue`; underline appears only on hover (1px, offset 3px) |
| `--ink-3` | rgb(60 60 67 / .76) | rgb(235 235 245 / .58) | Light value raised from the app's .6 for contrast at web sizes |
| `--ground` / `--ground-ink` | #6ea9a4 / #0b2622 | #123a48 / rgb(235 245 245 / .86) | Matches the near hill, so the landscape continues into an 18px strip under the hero and into the footer |
| `--shadow-window` | 0.5px edge + 40/90px blue-black drop | same, deeper | App-window replicas only |

`--shadow-pop` on the site uses a blue-tinted drop (`rgb(20 40 80 / .22)`, 24/70px), and fills are slightly denser (`--fill` 14% / 26%). Fonts are the app's stacks, with Segoe UI Variable and Cascadia Mono as fallbacks for Windows.

- **Type.** Body text is 17px / 1.55, tracking -0.011em (16px under 640px). The hero headline is `clamp(2.3rem, 3.9vw, 3.5rem)` / 1.06, tracking -0.036em. Section headings are `clamp(1.95rem, 3.4vw, 2.9rem)` / 1.08. The download heading is `clamp(2.4rem, 5vw, 3.9rem)` / 1.04. All headings are 700 weight with balanced wrapping. Replicas inside sections use the app's 13px scale.
- **Layout.** Content is capped at 1180px. Each section has 168px of top space (120px under 640px). Copy and replica sit in two-column grids with a 64px gap, which stack at 980px. The hero is at least `max(100svh, 780px)` tall and holds a 680px palette. A fixed 56px top bar sits over the page and gains a blurred, page-tinted fill once you scroll.
- **Command palette.** It uses a 22px radius, `--glass-strong`, a 32px blur at 190% saturation, and `--shadow-pop`. The search field is 58px tall with 18px input text. Group labels are 11.5px / 600 in `--ink-3`. Rows are at least 48px tall, with an 11px radius and a 30px icon tile (8px radius). The selected row is a solid accent fill with white text and shows a ↵ key. A scrolling list fades out at its bottom edge. In the hero, the palette rises in (820ms: 14px, 0.975 scale, 6px blur). As the ⌘K dialog, it is 640px wide, sits at 14vh, and enters with `glass-in` over a 28% navy scrim.
- **Replicas.** These are app surfaces rebuilt in HTML:
  - A window (16px radius, `--shadow-window`, inset sidebar with traffic lights). It cycles through the request-chaining story and plays the Send pulse.
  - A Finder-style file tree.
  - A menu bar and menu (12px radius glass). The menu row for a pressed shortcut flashes accent for 260ms.
  - An approval sheet (22px, with a ghost button and a primary capsule).
  - Replicas that hold glass sit on a "desk": a 20px-radius tile of still landscape, so the blur has something behind it.
- **Download.** Installers are grouped in a 20px glass-strong card with 64px rows (14px radius). The detected OS row is tinted 10% accent. Download buttons are 34px capsules: primary in accent with an accent-tinted shadow, secondary in `--fill`. Below the card, install notes sit in a 16px glass disclosure with copyable command rows.
- **Details.** `kbd` keys are 20px tall with a 5px radius, on `--fill-2` with a 0.5px inset edge. Shortcut labels match the visitor's platform and are hidden on touch devices. Focus shows a 2px accent outline offset by 2px. List bullets are 6px accent squares, one pixel of the landscape.

**The Fixed Accent Rule.** The page uses accent #0071e3 for fills and `--link` for text. It never uses the visitor's system accent, and it never puts white text on the lighter #0a84ff.
