# Docs: refresh the Text style control after a block-type change (#792)

## Problem

`EditorAPI.setBlockType` mutates the block and repaints, but never fires the
cursor-move callbacks. The docs toolbar re-derives all of its
selection-dependent state from those callbacks
(`packages/frontend/src/app/docs/docs-formatting-toolbar.tsx:317`), and
`TextStyleGroup` reads `editor.getBlockType()` during render
(`packages/frontend/src/components/text-formatting/text-style-group.tsx:79`).
With no callback fire there is no re-render, so the **Text style** button keeps
the old label (`Normal text` after applying `Heading 2`) and the re-opened menu
keeps the old checkmark until some other action fires the callbacks.

Every style mutation the toolbar's *displayed* state depends on already ends in
`notifyStyleApplied()`: `applyStyle` / `clearInlineFormatting` (through
`applyStyleImpl`), `stepSelectionFontSize`, `applyBlockStyle`, `setDocStyles`,
`updateStyleToMatch`, `resetNamedStyle`, `resetAllNamedStyles`, `insertLink` /
`removeLink`, `applySpellSuggestion`. `setBlockType` is the outlier.

`toggleList`, `indent` and `outdent` do not notify either — the issue lists
them as if they did, but they do not. That is invisible today because no
control derives its rendered state from list kind or level: the list buttons in
`text-paragraph-group.tsx` are plain actions with no active/checked state, and
`TextStyleGroup` never offers `list-item`. Left alone as out of scope for #792
(a fix would be unobservable), noted here so the next reader does not repeat
the issue's claim.

## Scope

- [x] Fire `notifyStyleApplied()` at the end of `EditorAPI.setBlockType`
      (`packages/docs/src/view/editor.ts`).
- [x] Regression test for the menu path: `setBlockType` fires the
      `onCursorMove` subscribers, and `getBlockType()` reads the new type at
      the moment they fire.
- [x] Regression test for the keyboard path (`⌘⌥2`), which the issue also
      calls stale.

## Note on the keyboard shortcut

The issue asserts `⌘⌥2` is "equally stale" because `text-editor.ts` has no
style-notification path. Reading the wiring, it is not: the docs host passes
`renderWithScroll` as the `TextEditor`'s `requestRender`
(`packages/docs/src/view/editor.ts:2102`), and `renderWithScroll` calls
`afterCursorRender()` → `fireCursorMoveCallbacks()`
(`editor.ts:2063`). The heading shortcut ends in `this.requestRender()`
(`text-editor.ts:1035`), so the toolbar already refreshes. Pinned with a test
rather than changed.

## Non-goals

- Slides text boxes (`text-box-editor.ts` already notifies in its own
  `setBlockType`).
- Any other toolbar control or block-type entry point.
