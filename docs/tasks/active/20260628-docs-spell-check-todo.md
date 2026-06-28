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
- [ ] A1 `spell-checker.ts` — `SpellChecker` interface + `Lang` types
- [ ] A2 `tokenize.ts` — paragraph → word ranges + skip rules
- [ ] A3 `local-provider.ts` — nspell + lazy en_US dict; check/suggest
- [ ] A4 `backend-provider.ts` — fetch-based provider (mock-tested)
- [ ] A5 `router.ts` — script → provider routing (word-boundary categories)
- [ ] A6 `session.ts` — view-local range set, debounce, word cache, visible-only

### B. Dependencies
- [ ] B1 Add `nspell` + en_US Hunspell dict to `packages/docs`
- [ ] B2 Lazy-load dict via dynamic import; verify chunk-gate

### C. Rendering
- [ ] C1 `editor.ts` — compute `spellErrorRects` via `computeSelectionRects`
- [ ] C2 `doc-canvas.ts` — `render()` param + red squiggle draw layer
- [ ] C3 Cache spell rects for hit-testing (like `commentMarkerRects`)

### D. Suggestions popover
- [ ] D1 `contextmenu` hit-test against spell rects
- [ ] D2 Popover UI anchored at word with `suggest()` results
- [ ] D3 Replace word range via DocStore (single undoable edit)
- [ ] D4 "No suggestions" disabled state

### E. Tests
- [ ] E1 Unit: router, tokenize skip rules, local provider, session
- [ ] E2 Integration: rect alignment, replace edit + single undo
- [ ] E3 Assert no spell state reaches the CRDT

### F. Wrap-up
- [ ] F1 `pnpm verify:fast` green
- [ ] F2 Self code-review over branch diff
- [ ] F3 Update roadmap doc (6.3 → done) + design README spell-check entry
- [ ] F4 Lessons file + archive + index

## Review

_(filled in on completion)_
