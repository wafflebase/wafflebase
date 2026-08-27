import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  computeListState,
  indentList,
  outdentList,
  setTaskChecked,
  toggleBulletList,
  toggleOrderedList,
  toggleTaskList,
} from './list-commands.js';

function mount(doc: string, from = 0, to = from): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
    }),
  });
}

/** Select whole lines `a`..`b` (1-based, inclusive). */
function selectLines(view: EditorView, a: number, b: number): void {
  const from = view.state.doc.line(a).from;
  const to = view.state.doc.line(b).to;
  view.dispatch({ selection: EditorSelection.range(from, to) });
}

describe('list toggles', () => {
  it('turns a line into a bullet and back to plain text', () => {
    const view = mount('milk', 2);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- milk');
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('milk');
    view.destroy();
  });

  it('marks up inside a blockquote instead of in front of it', () => {
    // The marker goes after the `> `; writing it in front produced
    // `- > quoted item`, a bullet containing a quote.
    const view = mount('> quoted item', 8);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('> - quoted item');
    view.destroy();
  });

  it('leaves a quote it could not peel off alone', () => {
    // The quote prefix is only recognised within three spaces of the line
    // start, so on these the `>` stays in the content. Marking them up would
    // write the bullet in front of that `>` and turn the quote into text.
    for (const doc of ['\t> quoted', '    > quoted', '>    > quoted']) {
      const view = mount(doc, doc.length);
      toggleBulletList(view);
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    }
  });

  it('marks up the rest of a selection past a quote it cannot peel', () => {
    const view = mount('a\n\t> quoted\nb');
    selectLines(view, 1, 3);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\n\t> quoted\n- b');
    view.destroy();
  });

  it('keeps the quote when a quoted item is turned back into text', () => {
    // The quote says which block the line is in, not how it is marked up
    // inside it — unlisting must not lift the line out of the blockquote.
    const view = mount('> - quoted item', 10);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('> quoted item');
    view.destroy();
  });

  it('restarts ordered numbering inside a blockquote', () => {
    // The quoted list is a list of its own; continuing the outer one would
    // number it 2. even though it renders as a separate first item.
    const view = mount('a\n> b\n> c');
    selectLines(view, 1, 3);
    toggleOrderedList(view);
    expect(view.state.doc.toString()).toBe('1. a\n> 1. b\n> 2. c');
    view.destroy();
  });

  it('reads a quoted task as a task and converts it in place', () => {
    const view = mount('> - [x] a', 9);
    expect(computeListState(view.state).kind).toBe('task');
    toggleOrderedList(view);
    expect(view.state.doc.toString()).toBe('> 1. a');
    view.destroy();
  });

  it('puts the caret after the marker when the line was empty', () => {
    // A caret at a line start maps to the same offset by default, i.e. in
    // front of the marker just written — the next keystroke would then land
    // ahead of it ("x- ") and break the item apart.
    const view = mount('', 0);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- ');
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });

  it('drops the indent when a nested item is turned back into text', () => {
    // Keeping the indent would leave "b" as a lazy continuation of "a" — the
    // line reads as part of the item above instead of as its own paragraph.
    const view = mount('- a\n    - b', 10);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\nb');
    view.destroy();
  });

  it('keeps the caret in the text as the marker is added', () => {
    const view = mount('milk', 2);
    toggleBulletList(view);
    // "mi|lk" is still "mi|lk", now two columns further along.
    expect(view.state.selection.main.head).toBe(4);
    view.destroy();
  });

  it('numbers an ordered list per indent level', () => {
    // The fixture has to be nested, or a single flat counter would satisfy it
    // and the per-level restart would go untested: the child list starts at 1
    // again, and the parent resumes at 2 across it.
    const view = mount('a\n  b\n  c\nd');
    selectLines(view, 1, 4);
    toggleOrderedList(view);
    expect(view.state.doc.toString()).toBe('1. a\n  1. b\n  2. c\n2. d');
    view.destroy();
  });

  it('converts between kinds without stacking markers', () => {
    const view = mount('1. a\n2. b');
    selectLines(view, 1, 2);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b');
    toggleTaskList(view);
    expect(view.state.doc.toString()).toBe('- [ ] a\n- [ ] b');
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b');
    view.destroy();
  });

  it('preserves a ticked box when re-toggling other lines into tasks', () => {
    const view = mount('- [x] a\n- b');
    selectLines(view, 1, 2);
    toggleTaskList(view);
    expect(view.state.doc.toString()).toBe('- [x] a\n- [ ] b');
    view.destroy();
  });

  it('applies to every line of a multi-line selection at once', () => {
    const view = mount('a\nb\nc\nd');
    selectLines(view, 2, 3);
    toggleTaskList(view);
    expect(view.state.doc.toString()).toBe('a\n- [ ] b\n- [ ] c\nd');
    view.destroy();
  });

  it('skips blank lines inside the selection', () => {
    const view = mount('a\n\nb');
    selectLines(view, 1, 3);
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\n\n- b');
    view.destroy();
  });

  it('still marks an empty line the caret sits on', () => {
    const view = mount('', 0);
    toggleTaskList(view);
    expect(view.state.doc.toString()).toBe('- [ ] ');
    view.destroy();
  });

  it('ignores a line the selection only reaches the start of', () => {
    const view = mount('a\nb');
    const from = view.state.doc.line(1).from;
    view.dispatch({
      selection: EditorSelection.range(from, view.state.doc.line(2).from),
    });
    toggleBulletList(view);
    expect(view.state.doc.toString()).toBe('- a\nb');
    view.destroy();
  });
});

describe('list state', () => {
  it('reports the kind shared by every selected line', () => {
    const view = mount('- a\n- b');
    selectLines(view, 1, 2);
    expect(computeListState(view.state).kind).toBe('bullet');

    view.dispatch({ changes: { from: 0, to: 3, insert: '1. a' } });
    selectLines(view, 1, 2);
    // Mixed kinds report none, so no toggle shows as pressed.
    expect(computeListState(view.state).kind).toBe(null);
    view.destroy();
  });

  it('reads a task item as a task, not a bullet', () => {
    const view = mount('- [x] a', 6);
    expect(computeListState(view.state).kind).toBe('task');
    view.destroy();
  });
});

describe('indent and outdent', () => {
  it('cannot indent the first item of a list, or a plain line', () => {
    const first = mount('- a\n- b', 2);
    expect(computeListState(first.state).canIndent).toBe(false);
    expect(computeListState(first.state).canOutdent).toBe(false);
    first.destroy();

    const plain = mount('- a\ntext', 6);
    expect(computeListState(plain.state).canIndent).toBe(false);
    plain.destroy();
  });

  it('nests under the item above and back out again', () => {
    const view = mount('- a\n- b', 6);
    expect(computeListState(view.state).canIndent).toBe(true);
    indentList(view);
    expect(view.state.doc.toString()).toBe('- a\n  - b');
    // Now nested: it can come back out, but not go deeper (no sibling).
    expect(computeListState(view.state).canIndent).toBe(false);
    expect(computeListState(view.state).canOutdent).toBe(true);
    outdentList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b');
    view.destroy();
  });

  it('indents an ordered item past its marker so it nests', () => {
    const view = mount('1. a\n2. b', 6);
    indentList(view);
    // Three columns, not two: `1. ` is what the child has to clear.
    expect(view.state.doc.toString()).toBe('1. a\n   2. b');
    view.destroy();
  });

  it('shifts a whole selected block by one step, keeping its shape', () => {
    const view = mount('- a\n- b\n  - c');
    selectLines(view, 2, 3);
    indentList(view);
    expect(view.state.doc.toString()).toBe('- a\n  - b\n    - c');
    outdentList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b\n  - c');
    view.destroy();
  });

  it('nests inside a blockquote without stripping the quote', () => {
    const view = mount('> - a\n> - b', 10);
    expect(computeListState(view.state).canIndent).toBe(true);
    indentList(view);
    expect(view.state.doc.toString()).toBe('> - a\n>   - b');
    // The `> ` is the floor: one outdent returns to the quote's own column,
    // and there is nothing left to outdent after it.
    expect(computeListState(view.state).canOutdent).toBe(true);
    outdentList(view);
    expect(view.state.doc.toString()).toBe('> - a\n> - b');
    expect(computeListState(view.state).canOutdent).toBe(false);
    outdentList(view);
    expect(view.state.doc.toString()).toBe('> - a\n> - b');
    view.destroy();
  });

  it('leaves a selected line in another blockquote where it is', () => {
    // The step is measured against the top line's own neighbour above. A line
    // in a different container has no such neighbour, so moving it by the same
    // step would nest it under nothing — at four columns markdown reads that
    // as a code block, and the item silently turns into a grey box.
    const view = mount('- a\n- b\n>   - c');
    selectLines(view, 2, 3);
    indentList(view);
    expect(view.state.doc.toString()).toBe('- a\n  - b\n>   - c');
    view.destroy();
  });

  it('nests across the blank separator of a loose quoted list', () => {
    // Pressing Enter twice in a quoted list leaves a bare `>` between the
    // items — the same blockquote, written without its trailing space, so the
    // container has to be compared by depth and not by prefix text.
    const view = mount('> - a\n>\n> - b', 13);
    expect(computeListState(view.state).canIndent).toBe(true);
    indentList(view);
    expect(view.state.doc.toString()).toBe('> - a\n>\n>   - b');
    view.destroy();
  });

  it('does not nest a plain item under a quoted one', () => {
    // Different quote depth, different block container — `- b` is no sibling
    // of the quoted item above it.
    const view = mount('> - a\n- b', 8);
    expect(computeListState(view.state).canIndent).toBe(false);
    view.destroy();
  });

  it('does nothing when the block cannot move', () => {
    const view = mount('- a\n- b', 2);
    indentList(view);
    outdentList(view);
    expect(view.state.doc.toString()).toBe('- a\n- b');
    view.destroy();
  });
});

describe('setTaskChecked', () => {
  it('flips the box on the given line', () => {
    const view = mount('- [ ] a\n- [x] b');
    setTaskChecked(view, 1, true);
    expect(view.state.doc.toString()).toBe('- [x] a\n- [x] b');
    setTaskChecked(view, 2, false);
    expect(view.state.doc.toString()).toBe('- [x] a\n- [ ] b');
    view.destroy();
  });

  it('flips a blockquoted box', () => {
    // The preview renders a quoted task as a normal task item, so a click on
    // it has to reach the source line the same way.
    const view = mount('> - [ ] a');
    setTaskChecked(view, 1, true);
    expect(view.state.doc.toString()).toBe('> - [x] a');
    view.destroy();
  });

  it('leaves a line without a checkbox — and an out-of-range line — alone', () => {
    const view = mount('- a');
    setTaskChecked(view, 1, true);
    setTaskChecked(view, 9, true);
    expect(view.state.doc.toString()).toBe('- a');
    view.destroy();
  });
});
