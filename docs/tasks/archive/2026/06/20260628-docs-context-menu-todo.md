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
- [x] A1 `getSpellErrorAt(clientX, clientY): SpellError | undefined` (public; = existing `spellErrorAtEvent`)
- [x] A2 `getSpellSuggestions(word: string): Promise<string[]>` (proxy `spellSession.router.suggest`)
- [x] A3 `applySpellSuggestion(err: SpellError, replacement: string): void` (proxy `spellSession.replace(doc, err, …)` + repaint + reschedule recheck)
- [x] A4 `copy(): void` and `cut(): void` (focus textarea + `document.execCommand('copy'|'cut')` → fires existing `handleCopy`/`handleCut`)
- [x] A5 `paste(): Promise<void>` (best-effort: `navigator.clipboard.read()` → prefer `text/html` else `text/plain` → route through the existing paste parser)
- [x] A6 Remove `openSpellPopover` / `closeSpellPopover` / `spellPopover`; `handleEditorContextMenu` keeps ONLY `e.preventDefault()` (native-menu suppression). Keep debounced recheck + squiggles.
- [x] A7 Export `SpellError` type from package index if needed by the frontend.
- [x] A8 typecheck + build + existing `editor-contextmenu.test.ts` still green; add coverage for new getters where unit-testable.

### B. Frontend — unified `DocsContextMenu`
- [x] B1 New `packages/frontend/src/app/docs/docs-context-menu.tsx` — positioned overlay (NOT Radix; reuse `DocsCommentContextMenu` clamp/close pattern)
- [x] B2 contextmenu handler: `if (editor.isInTable()) return;` (table menu handles it). Else `preventDefault` + open at cursor. Gather: `getSpellErrorAt`, `getActiveSelection`.
- [x] B3 Build grouped items: spell suggestions (async `getSpellSuggestions`) → Cut/Copy (selection-gated) → Paste → Add link (`requestLink`) / Add comment (`onInsertComment`)
- [x] B4 Wire actions: `applySpellSuggestion`, `copy`/`cut`/`paste`, `requestLink`, `comments.beginCompose`; `editor.focus()` after; close on select/outside/Escape
- [x] B5 "No suggestions" disabled item when a misspelling has none
- [x] B6 Replace `DocsCommentContextMenu` usage in `docs-view.tsx` with `DocsContextMenu`; keep `DocsTableContextMenu`. Remove now-unused `DocsCommentContextMenu` (keep `InsertCommentMenuItem` if reused)

### C. Verify + docs
- [x] C1 `pnpm verify:fast` green; `pnpm --filter @wafflebase/docs build` + frontend build
- [x] C2 Manual smoke: body right-click shows unified menu; misspelled word shows suggestions at top; Cut/Copy with selection; Add link/comment work; in-table right-click still shows table menu (satisfied at merge — PR #427)
- [x] C3 Update `docs/design/docs/docs-spell-check.md` (suggestions now live in the unified menu) + add a short `docs-context-menu` note
- [x] C4 Self code-review (final whole-branch, opus) + lessons; archive at merge

## Review

_(filled on completion)_

**What shipped:** One Google-Docs-style body right-click menu
(`DocsContextMenu`, frontend) replacing the standalone spell popover and
`DocsCommentContextMenu`: spell suggestions (top, async) + Cut/Copy
(selection-gated, editable-only) + Paste (best-effort) + Add link / Add
comment. The docs package exposes `getSpellErrorAt` /
`getSpellSuggestions` / `applySpellSuggestion` / `copy` / `cut` / `paste`
on `EditorAPI` and always suppresses the native menu; `DocsTableContextMenu`
still owns in-table right-click.

**Notable fix:** removed the SpellSession caret-word skip — clicking into
a misspelling no longer erased its squiggle, which broke right-click-to-fix.

**Known limitations / deferred:** menu Paste is best-effort (browser blocks
programmatic rich paste; ⌘V is full-fidelity); read-only Copy is hidden
(textarea is null in read-only — pre-existing gap); Select all,
Ignore/Add-to-dictionary, Define, Smart chips, Format options deferred;
mid-word typing pause can briefly flash a squiggle on the incomplete prefix.
