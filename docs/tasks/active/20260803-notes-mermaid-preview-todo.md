# Notes — Mermaid diagrams in the markdown preview (issue #625)

## Goal

A ` ```mermaid ` fence in a note renders as a diagram in the Notes preview
(Split / Preview modes), the way GitHub / Obsidian / Notion render it. Today
the fence falls through `preview.ts`'s fence rule and stays an escaped code
block.

## Constraints

- **Bundle size.** `mermaid` is ~3 MB with a lazily-loaded diagram-module
  graph. The notes route already carries a `notes-view-` chunk override
  (1400 kB) and the frontend chunk gate caps chunk **count** (147) as well as
  per-chunk KB. Mermaid must therefore load through a `import('mermaid')`
  dynamic import (its own deferred chunks — nothing downloaded until a note
  actually contains a mermaid fence), and `harness.config.json` budgets must
  be adjusted from a **measured** build, not guessed.
- **Security posture.** The preview is `html: false` on purpose (stored-XSS
  from a collaborator's note). Mermaid runs with `securityLevel: 'strict'`
  (DOMPurify-sanitized labels, no click handlers / script), so no raw note
  HTML reaches the DOM.
- **Render churn.** `preview.render()` runs on every keystroke in split mode.
  Diagram output must be cached by (source, theme) so typing next to a
  diagram does not re-run the mermaid layout engine per character.

## Approach

1. `packages/notes/src/view/mermaid.ts` (new)
   - `mermaidFenceHtml(source)` — the placeholder the fence rule emits: a
     `.note-mermaid` wrapper holding the escaped source in a `<pre>`, so an
     unrendered / failed diagram still shows readable source.
   - `renderMermaidBlocks(root, { theme, load })` — applies cached SVG
     synchronously, then lazily loads mermaid for the rest. `load` is
     injectable so tests never import the real engine (jsdom has no
     `getBBox`).
   - Skips detached elements (`isConnected`) so a stale pass from an earlier
     keystroke does no work.
2. `preview.ts` — fence rule branches on `lang === 'mermaid'`; `render()`
   kicks the async pass; `setTheme(mode)` records the palette for mermaid.
3. `editor.ts` — forward `setTheme` to the preview and re-render.
4. `notes-preview.css` — centred diagram block, light/dark source fallback +
   error styling.
5. `harness.config.json` — measured chunk-count bump + a `mermaid` KB
   override.
6. `docs/design/notes/notes.md` — document the preview feature.

## Status

- [x] Task + lessons docs
- [x] `mermaid.ts` (placeholder + lazy render pass + cache)
- [x] `preview.ts` fence branch + async pass + theme
- [x] `editor.ts` theme forwarding
- [x] Preview unit tests (placeholder, stubbed render, cache, failure)
- [x] CSS
- [x] Measure `pnpm frontend build` → chunk budgets
- [x] Design doc update
- [x] Draft PR

## Acceptance criteria (from the issue)

- A ` ```mermaid ` fence renders as a diagram in Split / Preview mode.
- Non-mermaid fences keep their existing highlight + copy-button behavior.
- Invalid mermaid still shows the source (no blank block, no thrown error).
- Mermaid is not downloaded on note routes without a mermaid fence.
