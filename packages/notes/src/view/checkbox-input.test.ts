import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { noteCheckboxInput } from './checkbox-input.js';

function mount(doc: string, at = doc.length): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [noteCheckboxInput],
    }),
  });
}

/**
 * Feed `text` to the registered input handlers the way the view does when the
 * user types it, and report whether one of them took over.
 */
function type(view: EditorView, text: string): boolean {
  const { from, to } = view.state.selection.main;
  return view.state
    .facet(EditorView.inputHandler)
    .some((handler) =>
      handler(view, from, to, text, () =>
        view.state.update(view.state.replaceSelection(text)),
      ),
    );
}

describe('bare checkbox input', () => {
  it('adds the hyphen a typed `[ ]` is missing', () => {
    const view = mount('[ ]');
    expect(type(view, ' ')).toBe(true);
    expect(view.state.doc.toString()).toBe('- [ ] ');
    // The caret follows the text the user is about to type.
    expect(view.state.selection.main.head).toBe(6);
    view.destroy();
  });

  it('handles a ticked box and keeps the line indent', () => {
    const view = mount('  [x]');
    expect(type(view, ' ')).toBe(true);
    expect(view.state.doc.toString()).toBe('  - [x] ');
    view.destroy();
  });

  it('normalizes an upper-case [X]', () => {
    const view = mount('[X]');
    type(view, ' ');
    expect(view.state.doc.toString()).toBe('- [x] ');
    view.destroy();
  });

  it('leaves a box that already has its hyphen alone', () => {
    const view = mount('- [ ]');
    expect(type(view, ' ')).toBe(false);
    expect(view.state.doc.toString()).toBe('- [ ]');
    view.destroy();
  });

  it('ignores a box that is not at the start of the line', () => {
    const view = mount('see [ ]');
    expect(type(view, ' ')).toBe(false);
    view.destroy();
  });

  it('ignores any other typed character', () => {
    const view = mount('[ ]');
    expect(type(view, 'x')).toBe(false);
    expect(view.state.doc.toString()).toBe('[ ]');
    view.destroy();
  });

  it('does not rewrite a read-only document', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '[ ]',
        selection: EditorSelection.cursor(3),
        extensions: [noteCheckboxInput, EditorState.readOnly.of(true)],
      }),
    });
    expect(type(view, ' ')).toBe(false);
    view.destroy();
  });
});
