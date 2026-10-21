---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: ["site/styles.css","site/app.js"]
---

Scope: the public landing page for Tether at `site/index.html` (Persuade mode). Audience: API developers, mostly on macOS, comparing against Insomnia, Bruno and Postman. Job: understand what Tether is in seconds and download the installer for their OS. Proof: the product's real behaviour (request chaining, local files, keyboard, agent access) shown as working Tether UI rebuilt in code; demo data is the app's own httpbin demo workspace. Constraints: macOS-first, installers for macOS/Windows/Linux from GitHub Releases, unsigned for now (install notes required), no invented metrics or customers.

## Direction contract

THESIS: The page is driven like the app. A Liquid Glass command palette floating over Tether's pixel landscape is both the hero and the navigation. Refuses the centred headline over a screenshot over a feature-card grid.

OWN-WORLD: Tether's world played on the web: pixel-art landscape ground (day in light, night in dark), glass-strong surfaces at 22px radius with 0.5px edges and soft drop shadows, system accent blue, HTTP method colours as the only other colour, SF Pro for words and SF Mono only for code, URLs and keys.

STORY: The visitor reads one line, sees the palette with their OS's download already selected, presses Enter or clicks. Curious visitors type or pick a tour row; the page scrolls to working replicas: chaining, workspace files, shortcuts, agent access, then a download close.

FIRST VIEWPORT: Full-bleed landscape. Slim top bar: plane mark + Tether left, GitHub right. One headline line above a 640px palette centred at about 45% height; its first row is the OS-detected download, highlighted, with ↵ hint; Download and Explore groups below. The paper plane glides overhead.

FORM: "Press ⌘K", dealt lead (index 6 of my ordered list of 7). Seed key 2054c629.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
