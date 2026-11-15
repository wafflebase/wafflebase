import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleLink,
  toggleQuote,
  insertCodeBlock,
  insertFoldout,
  insertTable,
  computeActiveFormats,
  setHeading,
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

  it('inserts a foldout skeleton with the caret inside the summary', () => {
    const view = mount('', 0);
    insertFoldout(view);
    expect(view.state.doc.toString()).toBe(
      '<details>\n<summary></summary>\n\n</details>\n',
    );
    // Caret between `<summary>` and `</summary>`.
    const head = view.state.selection.main.head;
    expect(head).toBe('<details>\n<summary>'.length);
    expect(view.state.sliceDoc(head, head + 10)).toBe('</summary>');
    view.destroy();
  });

  it('breaks out of the current line before inserting a foldout', () => {
    const view = mount('text', 4);
    insertFoldout(view);
    expect(view.state.doc.toString().split('\n')[0]).toBe('text');
    expect(view.state.doc.toString().split('\n')[1]).toBe('<details>');
    view.destroy();
  });

  it('inserts foldout tags flush left so they are not indented code', () => {
    const view = mount('', 0);
    insertFoldout(view);
    for (const line of view.state.doc.toString().split('\n')) {
      expect(line).toBe(line.trimStart());
    }
    view.destroy();
  });

  it('fences the selection as a code block and keeps it selected', () => {
    const view = mount('code', 0, 4);
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe('```\ncode\n```\n');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('code');
    view.destroy();
  });

  it('opens an empty fence with the caret inside it', () => {
    const view = mount('', 0);
    insertCodeBlock(view);
    expect(view.state.doc.toString()).toBe('```\n\n```\n');
    expect(view.state.selection.main.head).toBe(4);
    view.destroy();
  });

  it('quotes every line the selection touches, and unquotes them', () => {
    const view = mount('one\ntwo', 1, 5);
    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('> one\n> two');
    // All lines are quoted now, so toggling strips the markers.
    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('one\ntwo');
    view.destroy();
  });

  it('keeps the caret after the marker when quoting from a line start', () => {
    const view = mount('', 0);
    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('> ');
    // Not 0: typing next must land inside the quote, not ahead of the marker.
    expect(view.state.selection.main.head).toBe(2);
    // And unquoting brings it back to the start of the now-plain line.
    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('');
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  it('quotes a partly quoted selection rather than unquoting it', () => {
    const view = mount('> one\ntwo', 0, 9);
    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('> > one\n> two');
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

describe('setHeading', () => {
  const apply = (doc: string, from: number, to: number, level: 0 | 1 | 2 | 3) => {
    const view = mount(doc, from, to);
    setHeading(view, level);
    const out = { text: view.state.doc.toString(), sel: view.state.selection.main };
    view.destroy();
    return out;
  };

  it('turns a paragraph line into a heading and back', () => {
    expect(apply('Title', 2, 2, 2).text).toBe('## Title');
    expect(apply('## Title', 4, 4, 0).text).toBe('Title');
  });

  it('replaces one level with another instead of stacking markers', () => {
    expect(apply('### Title', 5, 5, 1).text).toBe('# Title');
  });

  it('is a set, not a toggle: the same level changes nothing', () => {
    const view = mount('## Title', 4);
    const before = view.state;
    setHeading(view, 2);
    expect(view.state).toBe(before);
    view.destroy();
  });

  it('keeps the line in its quote or list', () => {
    expect(apply('> Quote', 3, 3, 2).text).toBe('> ## Quote');
    expect(apply('- item', 3, 3, 3).text).toBe('- ### item');
    expect(apply('  1. step', 6, 6, 1).text).toBe('  1. # step');
    expect(apply('- [ ] task', 7, 7, 2).text).toBe('- [ ] ## task');
    expect(apply('- ## item', 5, 5, 0).text).toBe('- item');
  });

  it('puts the caret after the marker on an empty line', () => {
    const { text, sel } = apply('', 0, 0, 2);
    expect(text).toBe('## ');
    expect(sel.head).toBe(3);
  });

  it('applies to every selected line but leaves blank ones blank', () => {
    expect(apply('one\n\ntwo', 0, 8, 2).text).toBe('## one\n\n## two');
  });

  it('does not read emphasis or a rule as a container', () => {
    expect(apply('*em*', 1, 1, 1).text).toBe('# *em*');
    expect(apply('#tag', 1, 1, 1).text).toBe('# #tag');
  });
});

describe('heading state', () => {
  const headingAt = (doc: string, pos: number) => {
    const view = mount(doc, pos);
    const level = computeActiveFormats(view.state).heading;
    view.destroy();
    return level;
  };

  it('reads the caret line', () => {
    expect(headingAt('# One\ntext', 2)).toBe(1);
    expect(headingAt('# One\ntext', 8)).toBe(0);
    expect(headingAt('> ### Three', 8)).toBe(3);
    expect(headingAt('###### Six', 3)).toBe(6);
  });

  it('does not count a hash without a space', () => {
    expect(headingAt('#tag', 2)).toBe(0);
    expect(headingAt('####### seven', 2)).toBe(0);
  });
});

describe('headings and code blocks', () => {
  const FENCE = 'Intro\n```bash\n# install deps\nnpm ci\n```\nOutro';
  const mountMd = (doc: string, from: number, to = from) =>
    new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.range(from, to),
        extensions: [markdown({ base: markdownLanguage })],
      }),
    });

  it('does not read a comment in a fence as a heading', () => {
    const view = mountMd(FENCE, FENCE.indexOf('install'));
    expect(computeActiveFormats(view.state).heading).toBe(0);
    view.destroy();
  });

  it('leaves code lines untouched, even when Normal text is picked on one', () => {
    const view = mountMd(FENCE, FENCE.indexOf('install'));
    setHeading(view, 0);
    expect(view.state.doc.toString()).toBe(FENCE);
    view.destroy();
  });

  it('restyles prose around a fence a selection crosses, not the code', () => {
    const view = mountMd(FENCE, 0, FENCE.length);
    setHeading(view, 2);
    expect(view.state.doc.toString()).toBe(
      '## Intro\n```bash\n# install deps\nnpm ci\n```\n## Outro',
    );
    view.destroy();
  });
});
