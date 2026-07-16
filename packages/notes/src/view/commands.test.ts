import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleLink,
  insertTable,
  computeActiveFormats,
} from './commands.js';

function mount(doc: string, from: number, to = from): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
    }),
  });
}

describe('markdown commands', () => {
  it('wraps and unwraps bold', () => {
    const view = mount('hello', 0, 5);
    toggleBold(view);
    expect(view.state.doc.toString()).toBe('**hello**');
    // Selection now covers "hello" between the markers; toggling unwraps.
    toggleBold(view);
    expect(view.state.doc.toString()).toBe('hello');
    view.destroy();
  });

  it('wraps italic and strikethrough', () => {
    const i = mount('word', 0, 4);
    toggleItalic(i);
    expect(i.state.doc.toString()).toBe('*word*');
    i.destroy();

    const s = mount('word', 0, 4);
    toggleStrikethrough(s);
    expect(s.state.doc.toString()).toBe('~~word~~');
    s.destroy();
  });

  it('places the cursor between markers for an empty selection', () => {
    const view = mount('', 0);
    toggleBold(view);
    expect(view.state.doc.toString()).toBe('****');
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });

  it('reports active formats from the syntax around the selection', () => {
    const bold = mount('**hi**', 2, 4);
    expect(computeActiveFormats(bold.state).bold).toBe(true);
    // Not misreported as italic despite the inner `*`.
    expect(computeActiveFormats(bold.state).italic).toBe(false);
    bold.destroy();

    const italic = mount('*hi*', 1, 3);
    expect(computeActiveFormats(italic.state).italic).toBe(true);
    expect(computeActiveFormats(italic.state).bold).toBe(false);
    italic.destroy();
  });

  it('wraps a selection as a link and unwraps the link at cursor', () => {
    const view = mount('site', 0, 4);
    toggleLink(view);
    expect(view.state.doc.toString()).toBe('[site](url)');
    expect(computeActiveFormats(view.state).link).toBe(true);
    // Cursor is inside the link → toggling unwraps back to the label text.
    toggleLink(view);
    expect(view.state.doc.toString()).toBe('site');
    view.destroy();
  });

  it('inserts a rows x cols table skeleton (header + body rows)', () => {
    const view = mount('', 0);
    insertTable(view, 3, 2);
    const lines = view.state.doc.toString().trimEnd().split('\n');
    // 3 rows total = 1 header + separator + 2 body rows.
    expect(lines).toHaveLength(4);
    // 2 columns => 3 pipes per line.
    for (const l of lines) {
      expect((l.match(/\|/g) ?? []).length).toBe(3);
    }
    // Separator row has one '---' per column.
    expect((lines[1].match(/---/g) ?? []).length).toBe(2);
    view.destroy();
  });
});
