import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** A line holding nothing but an indent and a `[ ]` / `[x]` box. */
const BARE_BOX_RE = /^(\s*)\[([ xX])\]$/;

/**
 * Turn a line-leading `[ ]` (or `[x]`) into a task-list item as soon as the
 * user types the space after it, by inserting the `- ` the markdown syntax
 * needs: `[ ] ` becomes `- [ ] `.
 *
 * Writing the hyphen into the document — rather than teaching the preview to
 * render bare boxes — keeps the stored markdown canonical GFM, so the note
 * renders as a checklist everywhere else it is read (export, another markdown
 * viewer) and every existing task-list path applies to it unchanged.
 *
 * The rewrite folds the typed space in, so it is one undo unit and one store
 * edit rather than an insert followed by a correction.
 */
export const noteCheckboxInput: Extension = EditorView.inputHandler.of(
  (view, from, to, text) => {
    // A note can be non-writable two ways: the read-only facet, or a
    // non-editable view (what a share-link mount uses).
    if (
      text !== ' ' ||
      view.state.readOnly ||
      !view.state.facet(EditorView.editable)
    ) {
      return false;
    }
    const line = view.state.doc.lineAt(from);
    const match = BARE_BOX_RE.exec(line.text.slice(0, from - line.from));
    if (!match) return false;

    const insert = `${match[1]}- [${match[2].toLowerCase()}] `;
    view.dispatch(
      view.state.update({
        changes: { from: line.from, to, insert },
        selection: EditorSelection.cursor(line.from + insert.length),
        userEvent: 'input.type',
        scrollIntoView: true,
      }),
    );
    return true;
  },
);
