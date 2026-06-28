# Docs Keyboard Shortcuts Catalog Drift Fix — Task Tracking

Parent roadmap item: [6.6 Full Keyboard Shortcuts mapping](20260325-docs-wordprocessor-todo.md)
Design doc: [docs-font-controls.md] / [docs-wordprocessor-roadmap.md](../../design/docs/docs-wordprocessor-roadmap.md)

## Problem

The docs editor already has the full keyboard-shortcuts infrastructure:
single source-of-truth catalog (`packages/docs/src/view/shortcuts-catalog.ts`),
a shared help modal (`ShortcutsHelpDialog`, opened by ⌘/Ctrl+/), and runtime
bindings in `text-editor.ts`. But several **implemented** shortcuts are missing
from the catalog, so the help modal silently omits them (catalog drift).

### Missing from catalog (but implemented in `text-editor.ts`)

- [x] Heading 1–6 — `Mod+Alt+1` … `Mod+Alt+6` (text-editor.ts ~L956)
- [x] Paste formatting / apply format painter — `Mod+Alt+V` (text-editor.ts ~L934)
- [x] Move caret by word — `WordMod+Arrow ←/→` (Alt on Mac, Ctrl elsewhere) (L743/751)
- [x] Delete previous / next word — `WordMod+Backspace` / `WordMod+Delete` (L711/719)

Intentionally NOT added (Mac-only / would mislead Windows users):
- `Cmd+Backspace` line-delete (Mac only, `isMac && metaKey`)

## Plan

- [x] Add a `WordMod` token to `formatCombo` (⌥ on Mac, Ctrl elsewhere) — word nav/delete
- [x] Add the missing entries to `SHORTCUTS` in the right categories
- [x] Add a sync-convention note to the catalog header comment (mirror Slides)
- [x] Add `packages/docs/test/view/shortcuts-catalog.test.ts` (TDD: write failing first)
- [x] `pnpm verify:fast` green
- [x] Tick 6.6 in the parent roadmap todo

## Review

**Outcome:** 6.6 was ~80% done — infra (single catalog, shared `ShortcutsHelpDialog`,
⌘/Ctrl+/ entry) already shipped. The gap was catalog drift: bindings live in a
non-symbolic `switch` in `text-editor.ts`, so five real shortcuts never reached
the help modal. Audited the whole `handleKeyDown` and added the missing entries.

**Changed files**
- `packages/docs/src/view/shortcuts-catalog.ts` — `WordMod` token in `formatCombo`;
  6 new entries (heading 1–6 collapsed into one multi-chip row, paste-formatting,
  move-by-word, delete prev/next word); header comment now documents the dual-edit
  convention.
- `packages/docs/test/view/shortcuts-catalog.test.ts` — new; structure checks,
  `formatCombo` (incl. `WordMod`), and an anti-drift assertion that every binding
  shown above has a catalog combo.

**Verification:** `pnpm --filter @wafflebase/docs test` → 995 passed / 1 skipped;
`pnpm verify:fast` → EXIT 0.

**Deliberately excluded:** `Cmd+Backspace` line-delete is Mac-only in the handler
(`isMac && metaKey`); listing it cross-platform would mislead Windows/Linux users.

**Known limitation:** no automated assertion binds the `switch` to the catalog
(same as Slides). The new anti-drift test pins the *known* set but a brand-new
binding still needs a manual catalog entry — the header comment flags this.
