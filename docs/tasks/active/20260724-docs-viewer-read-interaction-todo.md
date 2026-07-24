# Docs viewer: text selection, copy, and link interaction (issue #482)

## Problem

In Docs **viewer / read-only** mode, readers cannot:

- Select text by dragging.
- Copy the selected text.
- Click a hyperlink to open its destination.

Read-only mode should block document *edits* while still permitting these
non-mutating "read the document" interactions (Google-Docs viewer parity).

## Root cause

`initialize(container, store, theme, readOnly)` in
`packages/docs/src/view/editor.ts` constructs the `TextEditor` only when
**not** read-only:

```ts
const textEditor = readOnly ? null : new TextEditor(...);
```

The `TextEditor` owns *all* pointer + clipboard + link machinery (drag
selection, `copy` serialization, `Ctrl/Cmd+Click` link open, the hidden
textarea the browser copy event needs). With it null in read-only mode,
none of those interactions exist. The link popover (`DocsLinkPopover`) is
also driven by cursor-move link detection, which never fires without a
caret.

## Approach

Reuse the existing `TextEditor` machinery instead of duplicating it:
construct the `TextEditor` in read-only mode too, threading a `readOnly`
flag that gates every **mutating** path while leaving selection / copy /
link paths intact.

### `packages/docs/src/view/text-editor.ts`

- Add `readOnly` constructor flag (default `false`) + field.
- `handleInput`: no-op in read-only (clear textarea, return).
- `handleCompositionStart`: no-op in read-only (blocks IME insertion).
- `handleCut` / `handlePaste`: `preventDefault` + return in read-only.
- `handleKeyDown`: in read-only allow only caret navigation
  (Arrows / Home / End), `Cmd/Ctrl+A` select-all, and `Cmd/Ctrl+F` find;
  plain `Cmd/Ctrl+C` falls through to the browser `copy` event
  (`handleCopy`, which stays enabled). Everything else is a no-op.
- `handleMouseDown`: skip table-border-resize + header/footer edit-context
  switching in read-only; keep selection (single/double/triple/shift/drag)
  and link handling. Record the link href under the pointer for a
  plain-click open.
- `handleMouseUp`: in read-only, if the pointer press did not drag
  (selection collapsed) and landed on a safe link href, open it in a new
  tab — Google-Docs viewer behavior (plain click opens links).
- `handleMouseMove`: in read-only, show `pointer` over links / `text`
  elsewhere and keep drag selection; skip the table-border resize cursor.

### `packages/docs/src/view/editor.ts`

- Always construct the `TextEditor`, passing `readOnly`.
- Do not auto-focus the hidden textarea on mount in read-only (focus is
  acquired on first click so `Ctrl+C` works); keep focus/blur wiring so the
  caret + selection paint on click.

### `packages/frontend/src/app/docs/docs-link-popover.tsx`

- Accept a `readOnly` prop; in read-only render only the open-link anchor,
  hiding the Edit / Remove-link buttons (both mutate).
- `docs-view.tsx`: pass `readOnly` to `DocsLinkPopover`.

## Non-goals

- No new editing affordances in viewer mode.
- Comments / context-menu already receive `readOnly` and are unchanged.
- Selecting text that *starts inside* a link opens on a pure click only;
  drag-select still works when started from non-link text.

## Test plan

- Unit: read-only `TextEditor` ignores typing / paste / cut but performs
  drag selection + copy serialization + link open. (add
  `text-editor` read-only spec if a harness exists)
- Manual: open a doc via a viewer share link — drag-select text, `Ctrl+C`
  copies, click a hyperlink opens it; typing / paste do nothing.
- `pnpm verify:fast` (via CI).

## Acceptance criteria (from issue #482)

- [ ] Select text by dragging in viewer mode.
- [ ] Copy selected text.
- [ ] Click a hyperlink to open its destination.
- [ ] Editing remains blocked (no content changes).
