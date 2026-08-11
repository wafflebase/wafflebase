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

## Human takeover (2026-08-07)

The autonomous loop stalled on 2026-08-05: `#653` landed on `main` on 08-04
and made the PR conflict, so GitHub could no longer build the
`refs/pull/632/merge` ref and stopped scheduling `pull_request` CI. With no CI
run on the head SHA, the review panel — which rides on a CI run — never
engaged again, and `@claude rerun` (which re-runs `ci.yml` **for the head
SHA**) had nothing to re-run. Picked up by hand from there.

- [x] Rebase onto `main` (only `pnpm-lock.yaml` conflicted; regenerated)
- [x] Verify in a real browser — the gap every prior round left open
- [x] Fix the light-mode source fallback (contrast 1.16:1 → 13.78:1)
- [x] Fix diagram centring (`text-align` cannot centre a block `svg`)
- [x] Re-measure the chunk budget against the rebased tree

### Browser verification (headless Chrome, both themes)

Every prior round stubbed the engine, so nothing had ever proved mermaid
loads and lays out in a browser. Driven through a throwaway Vite page
mounting the real `NotePreview` (removed afterwards):

| Check | Result |
| --- | --- |
| `flowchart` + `sequenceDiagram` (two per-type lazy chunks) | both rendered |
| Unparseable fence | source kept, error line shown, nothing thrown |
| `<img onerror>` / `<script>` in a label | no execution, 0 `<script>`, 0 `on*` |
| `%%{init: {"themeCSS": …}}%%` restyling the page | blocked — page unchanged |
| Non-mermaid ` ```js ` fence | still highlighted |
| Dark theme | palette repainted (node fill `#1f2020`) |

This also settles the disputed blast-radius finding — mermaid's Node-only
`@iconify/utils` transitive deps never execute in the browser path, since two
diagram types rendered without a polyfill.
