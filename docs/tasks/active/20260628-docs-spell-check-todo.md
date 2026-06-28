# Docs Spell Check (6.3) — Task Tracking

Design: [docs-spell-check.md](../../design/docs/docs-spell-check.md)
Roadmap: [docs-wordprocessor-roadmap.md](../../design/docs/docs-wordprocessor-roadmap.md) item 6.3

## Scope (v1)

Red squiggle under misspelled English words + right-click suggestions
popover (click to replace). Pluggable provider interface, per-word
script-based language routing. Korean server, ignore, add-to-dictionary,
toggle — deferred.

## Plan

### A. Spell module (`src/spell/`)
- [x] A1 `spell-checker.ts` — `SpellChecker` interface + `Lang` types
- [x] A2 `tokenize.ts` — paragraph → word ranges + skip rules
- [x] A3 `local-provider.ts` — nspell + lazy en_US dict; check/suggest
- [x] A4 `backend-provider.ts` — fetch-based provider (mock-tested)
- [x] A5 `router.ts` — script → provider routing (word-boundary categories)
- [x] A6 `session.ts` — view-local range set, debounce, word cache, visible-only

### B. Dependencies
- [x] B1 Add `nspell` + en_US Hunspell dict to `packages/docs`
- [x] B2 Lazy-load dict via dynamic import; verify chunk-gate

### C. Rendering
- [x] C1 `editor.ts` — compute `spellErrorRects` via `computeSelectionRects`
- [x] C2 `doc-canvas.ts` — `render()` param + red squiggle draw layer
- [x] C3 Cache spell rects for hit-testing (like `commentMarkerRects`)

### D. Suggestions popover
- [x] D1 `contextmenu` hit-test against spell rects
- [x] D2 Popover UI anchored at word with `suggest()` results
- [x] D3 Replace word range via DocStore (single undoable edit)
- [x] D4 "No suggestions" disabled state

### E. Tests
- [x] E1 Unit: router, tokenize skip rules, local provider, session
- [x] E2 Integration: rect alignment, replace edit + single undo
- [x] E3 Assert no spell state reaches the CRDT

### F. Wrap-up
- [x] F1 `pnpm verify:fast` green
- [ ] F2 Self code-review over branch diff
- [x] F3 Update roadmap doc (6.3 → done) + design README spell-check entry
- [ ] F4 Lessons file + archive + index

## Review

**What shipped (Phase 6.3):** English spell-check is live in the Docs
editor — red wavy squiggles under misspelled words, right-click
suggestions popover with one-click replacement (single undoable edit).
The session debounces and restricts checking to the visible viewport.
Per-word script detection routes words to the appropriate provider
(English → LocalSpellProvider; non-Latin → backend stub).

**Dictionary strategy:** `dictionary-en` (npm) is Node-only and its
`exports` map blocks subpath access in bundlers. The solution was to
vendor the en_US Hunspell `.aff` + `.dic` files directly into
`packages/docs/src/spell/dict/` and load them via
`import('./dict/en_US.dic?raw')` — Vite splits these into separate lazy
chunks (~552 kB for `.dic`, ~3 kB for `.aff`) downloaded only when
spell check initialises in the browser.

**Chunk-gate concern:** The two new dictionary chunks raise the frontend
chunk count from 108 to 110, failing `verify:frontend:chunks` (limit
108). `harness.config.json` `maxChunkCount` must be bumped to 110 before
`verify:self` is green.

**Deferred items:**
- Korean spell check via backend provider (wired but provider is a stub)
- Ignore word / Add to dictionary
- On/off toggle in the toolbar
- Any non-English languages beyond the routing skeleton
