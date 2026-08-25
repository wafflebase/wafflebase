# Notes: bare `[ ]` checkboxes + list controls in the toolbar

Issue: [#754](https://github.com/wafflebase/wafflebase/issues/754)

## Problem

The notes editor renders `- [ ] task` as a checkbox, but typing `[ ]` without
the leading hyphen stays plain text. The preview's checkboxes are rendered
`disabled` (read-only), so a task can only be ticked by editing the source.
The toolbar has inline formatting (bold / italic / strikethrough / link /
table / image) but no list controls at all — no bullet, numbered, or checkbox
toggle, and no indent / outdent.

## Acceptance criteria

- [x] Typing `[ ]` (or `[x]`) at the start of a line converts to a checkbox
      item without the user typing the `-`.
- [x] In preview mode, clicking anywhere on a task item — the checkbox or its
      adjacent text — toggles checked/unchecked, writing back to the source.
- [x] Toolbar gains Checkbox, Numbered list and Bullet list toggle buttons.
- [x] Toolbar gains Indent / Outdent buttons, disabled when the line cannot be
      indented / outdented any further.
- [x] All four list actions apply to every line of a multi-line selection.
- [x] A read-only note (share viewer) stays read-only: preview checkboxes are
      not clickable and the toolbar controls are hidden as today.

## Plan

1. `packages/notes/src/view/list-commands.ts` (new) — pure line-level markdown
   list model: parse `indent / marker / checkbox / content`, compute the
   selected line range, and expose `toggleBulletList`, `toggleOrderedList`,
   `toggleTaskList`, `indentList`, `outdentList` plus a `listState()` reader
   for the toolbar (active kind + canIndent / canOutdent). Indent width comes
   from the previous sibling item's content offset so `1. ` nests correctly.
2. `packages/notes/src/view/checkbox-input.ts` (new) — a CodeMirror
   `inputHandler` that rewrites a line-leading `[ ]` / `[x]` into `- [ ] ` when
   the user types the following space. Keeps the stored markdown canonical, so
   the existing preview/task-list rendering covers it.
3. `commands.ts` — extend `NoteInlineFormats` with the block-level list state
   (`list`, `canIndent`, `canOutdent`) so the one `onSelectionChange`
   subscription still drives the whole toolbar.
4. `preview.ts` — render task checkboxes enabled and tag each task
   `<li>` with its source line (`data-line`, from the token map); a delegated
   click on the item (checkbox or text, but not links/buttons) calls an
   optional `onToggleTask(line, checked)`. Without that callback the
   checkboxes are re-disabled, so read-only previews behave as today.
5. `editor.ts` — wire the preview callback to a doc transaction flipping
   `[ ]` ↔ `[x]` on that line (skipped when `readOnly`), register the
   checkbox input handler, and expose the five list commands on
   `NoteEditorAPI`.
6. `notes-toolbar.tsx` — a list group (bullet / numbered / checkbox toggles,
   indent / outdent buttons with disabled state) after the link group.
7. Tests — `list-commands.test.ts`, `checkbox-input.test.ts`, and preview
   tests for the enabled checkbox + click-to-toggle mapping.

## Non-goals

- No preview rendering of bare `[ ]` lines that were pasted rather than typed
  (the input rule normalizes the source instead of forking the markdown
  parser).
- No Tab/Shift-Tab rebinding: `indentWithTab` already owns those keys.
- No renumbering of surrounding ordered lists beyond the selection.
