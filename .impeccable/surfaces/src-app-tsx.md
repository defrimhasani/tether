---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/index.css"]
---

Scope: the whole Tether app window (Operate mode). Audience: API power users on macOS working for long sessions.

## Direction contract

THESIS: Tether should feel like an app Apple shipped on macOS Tahoe, not a web page in a frame. Refuses the dark IDE-with-neon look and the flat Electron sidebar.

OWN-WORLD: Real window vibrancy; a floating Liquid Glass sidebar inset from the window edge (large continuous radius, specular top edge, soft shadow); glass capsule controls floating over an opaque content canvas; SF Pro and SF Mono; system accent color; light and dark follow the system. Color only for HTTP methods, status, references.

STORY: The user picks a request, sees the environment, edits, presses Send and reads status/time/size immediately, then reuses a field in another request.

FIRST VIEWPORT: Traffic lights inside the floating sidebar; toolbar with request title left, environment + command capsules right; a full-width URL capsule with method menu and accent Send; split request/response panes below on the canvas.

FORM: Pinned by the user (macOS Liquid Glass canon, played straight); the concept roll was skipped because the user pinned the world. Seed key: user-pinned.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
