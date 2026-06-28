# Docs Unified Context Menu — Task Tracking

Extends the spell-check branch (`docs-spell-check`). Replaces the separate
in-editor spell popover + `DocsCommentContextMenu` with ONE Google-Docs-style
context menu for body (non-table) text. Table right-click keeps
`DocsTableContextMenu` (tables aren't spell-checked; distinct context).

## Scope (v1, confirmed)

Body-text right-click → one menu, grouped like Google Docs:
- **Spell suggestions** (top, only on a misspelled word) → click replaces; separator.
- **Cut / Copy** (enabled only with a selection).
- **Paste** (best-effort; browser may block programmatic paste).
- separator.
- **Add link** (⌘K) / **Add comment** (⌘⌥M).

Deferred: Select all, Ignore/Add-to-dictionary, Define, Smart chips, Format options.

## Plan

### A. Docs package — expose APIs + remove in-editor popover (`editor.ts`)
- [ ] A1 `getSpellErrorAt(clientX, clientY): SpellError | undefined` (public; = existing `spellErrorAtEvent`)
- [ ] A2 `getSpellSuggestions(word: string): Promise<string[]>` (proxy `spellSession.router.suggest`)
- [ ] A3 `applySpellSuggestion(err: SpellError, replacement: string): void` (proxy `spellSession.replace(doc, err, …)` + repaint + reschedule recheck)
- [ ] A4 `copy(): void` and `cut(): void` (focus textarea + `document.execCommand('copy'|'cut')` → fires existing `handleCopy`/`handleCut`)
- [ ] A5 `paste(): Promise<void>` (best-effort: `navigator.clipboard.read()` → prefer `text/html` else `text/plain` → route through the existing paste parser)
- [ ] A6 Remove `openSpellPopover` / `closeSpellPopover` / `spellPopover`; `handleEditorContextMenu` keeps ONLY `e.preventDefault()` (native-menu suppression). Keep debounced recheck + squiggles.
- [ ] A7 Export `SpellError` type from package index if needed by the frontend.
- [ ] A8 typecheck + build + existing `editor-contextmenu.test.ts` still green; add coverage for new getters where unit-testable.

### B. Frontend — unified `DocsContextMenu`
- [ ] B1 New `packages/frontend/src/app/docs/docs-context-menu.tsx` — positioned overlay (NOT Radix; reuse `DocsCommentContextMenu` clamp/close pattern)
- [ ] B2 contextmenu handler: `if (editor.isInTable()) return;` (table menu handles it). Else `preventDefault` + open at cursor. Gather: `getSpellErrorAt`, `getActiveSelection`.
- [ ] B3 Build grouped items: spell suggestions (async `getSpellSuggestions`) → Cut/Copy (selection-gated) → Paste → Add link (`requestLink`) / Add comment (`onInsertComment`)
- [ ] B4 Wire actions: `applySpellSuggestion`, `copy`/`cut`/`paste`, `requestLink`, `comments.beginCompose`; `editor.focus()` after; close on select/outside/Escape
- [ ] B5 "No suggestions" disabled item when a misspelling has none
- [ ] B6 Replace `DocsCommentContextMenu` usage in `docs-view.tsx` with `DocsContextMenu`; keep `DocsTableContextMenu`. Remove now-unused `DocsCommentContextMenu` (keep `InsertCommentMenuItem` if reused)

### C. Verify + docs
- [ ] C1 `pnpm verify:fast` green; `pnpm --filter @wafflebase/docs build` + frontend build
- [ ] C2 Manual smoke: body right-click shows unified menu; misspelled word shows suggestions at top; Cut/Copy with selection; Add link/comment work; in-table right-click still shows table menu
- [ ] C3 Update `docs/design/docs/docs-spell-check.md` (suggestions now live in the unified menu) + add a short `docs-context-menu` note
- [ ] C4 Self code-review; lessons; archive

## Review

_(filled on completion)_
