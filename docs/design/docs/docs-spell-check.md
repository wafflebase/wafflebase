---
title: docs-spell-check
target-version: 0.2.0
---

# Docs Spell Check (v1)

Roadmap item **6.3 Spell Check** in
[docs-wordprocessor-roadmap.md](docs-wordprocessor-roadmap.md).
Task tracking: `docs/tasks/active/20260628-docs-spell-check-todo.md`.

## Summary

Add red squiggly underlines under misspelled words in the Docs (word
processor) editor, with a right-click popover offering correction
suggestions that replace the word through the store. Detection runs
in-process against a lazy-loaded Hunspell dictionary, with a pluggable
provider interface so backend / additional-language providers slot in
later. Language is auto-detected per word by script.

The misspelled-range set is view-local session state (like
`FindReplaceState`) — it is **never** written to the CRDT document.

## Goals / Non-Goals

### Goals

- Red squiggle decoration under misspelled English words, reusing the
  existing search/comment highlight rendering path.
- Right-click a flagged word → popover of suggestions; click to replace
  (one undoable store edit).
- Pluggable `SpellChecker` interface with a fully-working local English
  provider (nspell + en_US, lazy-loaded) and a `BackendSpellProvider`
  wired to the same interface for languages not bundled locally.
- Per-word language auto-detection via script classification, reusing
  `word-boundary.ts` categories.
- Performance-safe: debounced (~300ms), IME-aware, per-word result
  cache. (v1 re-tokenizes all body blocks per recheck; visible-only
  scoping is a deferred optimization.)

### Non-Goals (v1 — deferred)

- **Server-side Korean dictionary.** The `BackendSpellProvider` +
  endpoint contract are designed and wired; Hangul words are left
  un-flagged until the server lands. Real Korean spell checking is a
  follow-up project.
- **Ignore / Ignore all.**
- **Add to personal dictionary (persisted).**
- **Toggle spell check on/off** (UI control).
- **Tables and headers/footers.** Only top-level body blocks are scanned;
  `getBlockText` returns empty for table blocks, so misspellings inside
  table cells and header/footer regions are not flagged in v1.
- A general docs context-menu framework. The suggestions menu is a small
  purpose-built popover, not a reusable context menu.

## Proposal Details

### Module layout

New `packages/docs/src/spell/` module, decoupled from rendering:

```
src/spell/
  spell-checker.ts     # SpellChecker interface + types
  local-provider.ts    # LocalSpellProvider (nspell + en_US, lazy dict load)
  backend-provider.ts  # BackendSpellProvider (same interface, fetch)
  router.ts            # SpellRouter — script → provider routing
  session.ts           # SpellSession — view-local range set + debounce + cache
  tokenize.ts          # paragraph → checkable word ranges + skip rules
```

### SpellChecker interface

```ts
type Lang = 'en' | 'ko' | string;

interface SpellChecker {
  /** true = spelled correctly / not checkable; false = misspelled. */
  check(word: string, lang: Lang): Promise<boolean>;
  /** ordered correction suggestions, best first. */
  suggest(word: string, lang: Lang): Promise<string[]>;
  /** languages this provider can handle. */
  supports(lang: Lang): boolean;
}
```

Async signatures so backend providers share the shape. The local
provider resolves synchronously-fast but still returns promises.

### Providers

- **`LocalSpellProvider`** — wraps `nspell`. The en_US `.aff`/`.dic`
  payload is **vendored** into `src/spell/dict/` and **lazy-loaded** on
  first check via `import('./dict/en_US.dic?raw')` so it stays out of the
  initial bundle (Vite emits it as a separate dynamic-import chunk). The
  npm `dictionary-en` package can't be imported at runtime in the
  browser — it is Node-only (top-level-await `node:fs`) and its `exports`
  map blocks subpath access — so the raw files are vendored instead.
  `nspell` accepts the dict as a string. Caches the nspell instance.
  `supports('en')`.
- **`BackendSpellProvider`** — POSTs unknown words to a backend endpoint
  (`/api/v1/spell/check`, `/suggest` — contract documented, server
  deferred). Batches and caches. `supports('ko')` etc. The class is
  implemented and unit-tested against a mock fetch, but in v1 it is
  **constructed only when an endpoint is configured**; with no endpoint
  it is not registered in the default router, so Hangul words route to
  no provider and are never flagged.

### SpellRouter

Classifies each word's dominant script via its own `scriptOf` helper in
`spell-checker.ts` (a Unicode-range classifier; `word-boundary.ts` does
not separate Hangul from other "word" characters, so spell check needs
its own):

- **Latin** → local English provider.
- **Hangul** → backend Korean provider (absent in v1 → un-flagged).
- **CJK (Han/Kana)** → skipped entirely (no spelling concept).

Paragraph dominant-script chooses the default provider for the block;
per-word script overrides it (mixed-language paragraphs check correctly).

### Tokenization & skip rules (`tokenize.ts`)

Walk a paragraph's text, emit `{start, end, word}` for each candidate.
**Skip** (never flag):

- words while `editor.isComposing()` (IME mid-composition),
- the word currently under the caret until the caret leaves it or a
  word-boundary char is typed (don't flag a word as you type it),
- pure numbers, URLs, emails,
- all-caps tokens length ≥ 2 (acronyms),
- tokens shorter than 2 chars,
- CJK words.

### SpellSession

Per editor view, analogous to `FindReplaceState`:

- Owns `errors: SpellError[]` ({blockId, start, end, word}) of misspelled
  ranges.
- `recheckBlocks()` is **debounced ~300ms** after edits / cursor moves;
  v1 walks all body blocks (visible-only scoping deferred). A monotonic
  generation guard discards a stale recheck whose result would otherwise
  clobber a newer one.
- Per-word result cache (`Map<word, boolean>`) avoids re-querying
  providers for repeated words.
- Pure state — never serialized to Yorkie.

### Rendering

Mirror the search/comment highlight path exactly:

1. In `editor.ts` (alongside `searchHighlightRects` / `commentMarkers`,
   ~line 1440), convert each session range to rects via
   `computeSelectionRects(...)`.
2. Pass a new trailing positional `spellErrorRects` param to
   `canvas.render(...)` (consistent with the existing positional list).
3. In `doc-canvas.ts` (~line 374, same z-order pass as search/comment),
   draw a red squiggle — a low-amplitude zigzag/sine stroke along the
   bottom edge of each rect. Inherits pagination, wrap, and zoom for
   free.

### Suggestions popover

- Hook `contextmenu` on the editor element. Hit-test the cursor point
  against the session's misspelled rects (cached like
  `commentMarkerRects`).
- If hit: `preventDefault()`, open a small popover anchored at the word
  showing `provider.suggest(word, lang)` results.
- Click a suggestion → replace the word range through `DocStore` as a
  single undoable edit (same path find-&-replace uses for replace).
- Empty suggestions → disabled "No suggestions" item.
- No hit → let the native menu through (or nothing); v1 adds no other
  items.

### Dependencies

Add `nspell` to `packages/docs` dependencies; keep `dictionary-en` as a
dev dependency (provenance for the vendored files). The en_US `.aff`/
`.dic` are vendored into `src/spell/dict/` and loaded via `?raw` dynamic
import so they form a lazy chunk, not part of the main bundle. The two
dict chunks bump the frontend chunk count 108 → 110 in
`harness.config.json` (with a reason entry); the main docs entry stays
~346 KB with no dict inlined.

## Testing

- **Unit**
  - `SpellRouter`: Latin→en, Hangul→backend(absent→pass), CJK→skip;
    mixed-script paragraph routing.
  - `tokenize`: skip rules (numbers, URLs, acronyms, <2 chars, caret
    word, IME).
  - `LocalSpellProvider`: check/suggest against fixtures (known good +
    known misspelling → expected suggestions).
  - `SpellSession`: range set updates on mutation; caret-word & IME
    skips; hit-test; generation guard (stale recheck discarded); replace
    calls only `snapshot`+`deleteText`+`insertText` (view-local invariant).
  - `squigglePoints` geometry (zigzag alternation).
- **Deferred / manual**
  - Squiggle-rect-vs-`computeSelectionRects` equivalence and the editor
    glue (contextmenu hit-test, popover, debounce, teardown) are DOM/
    canvas-bound; covered by manual smoke, not unit tests, in v1.

## Risks and Mitigation

- **Bundle size** — en_US dict is hundreds of KB. *Mitigation:* dynamic
  import → lazy chunk; verify chunk-gate.
- **Perf on large docs** — *Mitigation:* debounce + per-word cache (v1
  re-tokenizes all body blocks; visible-only scoping is a deferred
  optimization).
- **False positives (proper nouns, code)** — accepted in v1; ignore /
  add-to-dictionary deferred. Skip rules reduce noise (acronyms, URLs,
  numbers).
- **Docs has no context-menu system** — *Mitigation:* purpose-built
  popover scoped to suggestions only; not a framework.
- **CRDT contamination** — session state is strictly view-local; a test
  asserts no spell data reaches the document.
