# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop application delivered with Tauri; React renders the interface. Target OS: macOS first. The platform value describes the rendering/design guidance, not browser-only delivery.

## Stack

User-selected: Tauri and React. Supporting libraries and persistence format remain undecided.

## Users

API power users working with large workspaces, repeated requests, and keyboard-driven exploration and debugging.

## Product Purpose

A beautiful desktop API client. The first release is a focused HTTP workbench: collections, environments, request editing, response inspection, and history.

## Positioning

The intended reasons to switch from Insomnia or Bruno are a polished native desktop experience, local-first ownership, connected workflows, and speed and clarity. These are product goals, not measured superiority claims.

## Operating Context

Users organize requests into collections, select environments, send HTTP requests, inspect results, and revisit earlier executions. Connected workflows should support reusing results across requests; v1 supports `{{@request_slug.status|headers.<name>|body.<path>}}` references resolved against each request's latest response.

## Capabilities and Constraints

- Tauri and React are fixed.
- Initial scope is HTTP, not a multi-protocol platform.
- Local-first ownership includes Git-friendly files, no required account, and private secrets as the selected product direction. Storage format, secret handling, and synchronization implementation require technical decisions.
- First-release priorities are collections, environments, request editor, response inspection, and history.
- Decided: product name **Tether**; macOS first; request chaining (response-field references) is in v1 scope.
- Still open: import formats, scripting, testing, and collaboration scope are not yet confirmed.

## Evidence on Hand

The project directory was empty at discovery. No implementation, brand assets, performance measurements, or comparative usability evidence were supplied.

## Product Principles

- Keep the everyday request/inspect loop fast and clear.
- Give users ownership of their workspace and secrets.
- Support expert keyboard workflows without obscuring basic actions.
- Connect related requests without turning a focused workbench into a sprawling platform.
- Treat desktop interaction quality as part of the product, not decorative polish.
