# Slides Keyboard Shortcuts — Lessons

Shipped as PR #238 (`2c319e59`).

## What shipped

- Cmd+A, Esc, Tab/Shift+Tab, F2/Enter, Cmd+M, Cmd+Shift+D, PageUp/PageDown,
  Cmd+Enter / Cmd+Shift+Enter, Cmd+/ — all wired through the existing
  `interactions/keyboard.ts` keyRule array.
- New module `shortcuts-catalog.ts` as the single source of truth for
  shortcut metadata; the help modal renders directly from it (dual-edit
  convention documented in the head comment).
- `SlidesEditorOptions` extended with three optional host callbacks
  (`onStartPresentation`, `onShowShortcutsHelp`, `onLinkRequest`).
- Cmd+K plumbed end-to-end through docs `text-box-editor` → slides
  text-box → `SlidesEditor`.

## Patterns worth keeping

- **Catalog-driven help UI.** Defining shortcuts once and rendering both
  the binding and the help modal from the same array kept them from
  drifting. Any future shortcut addition mechanically updates the modal.
- **Editable-target gate also bails inside dialogs / focused buttons.**
  Without this, the help modal's own Tab navigation gets hijacked.

## Deferred (tracked as follow-up)

- Real `onLinkRequest` popover. The keyboard plumbing fires through to
  the host, but no popover UI exists yet — currently a no-op while
  editing text inside a text-box. Needs `TextBoxEditorAPI.insertLink` /
  `getLinkAtCursor` to mutate the active text-box.
- Group / Ungroup and Find / Replace — intentionally out of scope.
