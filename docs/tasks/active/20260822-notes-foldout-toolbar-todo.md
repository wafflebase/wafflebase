# Notes: foldout / code / quote toolbar buttons + flat foldout styling (#756)

## Goal

Make the notes foldout (`<details>`/`<summary>`) feature reachable from the
toolbar alongside code-block and quote inserts, and restyle the rendered
foldout so it reads as part of the document outline instead of as a boxed
callout.

## Acceptance criteria (from the issue)

- [ ] Toolbar gains **Foldout**, **Code**, **Quote** buttons.
- [ ] Foldout inserts the `<details>` / `<summary>` skeleton at the cursor,
      caret between `<summary>` and `</summary>`. Not a toggle (foldouts nest).
- [ ] `.note-details` loses its background colour and borders.
- [ ] Foldout reads as standard text — only the disclosure arrow next to the
      summary; margins/padding match normal text.
- [ ] Content inside `<details>` is rendered indented, showing it is a child
      of the foldout.

## Plan

1. `packages/notes/src/view/commands.ts`
   - `insertFoldout(view)` — insert the skeleton on its own line(s), caret
     inside the empty `<summary>`. One `input` transaction = one undo unit.
   - `insertCodeBlock(view)` — fence the selection (or open an empty fence),
     caret/selection on the content line.
   - `toggleQuote(view)` — prefix every line touched by the selection with
     `> `, or strip the prefix when all of them already have it.
2. `packages/notes/src/view/editor.ts` — expose the three on `NoteEditorAPI`.
3. `packages/frontend/src/app/notes/notes-toolbar.tsx` — three tooltip
   buttons (`IconBlockquote`, `IconCode`, `IconFold`) in the block-insert
   group next to the table picker.
4. `packages/frontend/src/app/notes/notes-preview.css` — flat `.note-details`
   (no border/background, paragraph rhythm), `.note-summary` at normal weight
   with the arrow kept, and `margin-left` indentation on every non-summary
   child.
5. Tests: extend `packages/notes/src/view/commands.test.ts`.
6. Docs: update the collapsible-sections section of
   `docs/design/notes/notes.md`.

## Notes / decisions

- The issue's snippet indents `<summary>` by four spaces. markdown-it's
  indented-code rule runs before the disclosure rule, so a four-space indent
  would render as a code block. The insert is flush-left instead.
- Code and Quote are plain inserts/toggles on the markdown source; no new
  preview-side rendering is needed (markdown-it already handles both).

## Architecture change?

No. No new module, data model, or CRDT schema — commands + CSS only.
