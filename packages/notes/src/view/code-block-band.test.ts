import { describe, it, expect } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { MemNoteStore } from '../store/memory.js';
import { codeBlockLines } from './code-block-band.js';
import { initialize } from './editor.js';
import { noteMarkdownTags } from './theme.js';

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: markdown({ base: markdownLanguage, extensions: noteMarkdownTags }),
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** 1-based line numbers carrying the code-block line decoration. */
function bandedLines(doc: string): number[] {
  const state = stateOf(doc);
  const lines: number[] = [];
  codeBlockLines(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (from) => {
      lines.push(state.doc.lineAt(from).number);
    },
  );
  return lines;
}

describe('codeBlockLines', () => {
  it('bands every line of a fenced block, fences included', () => {
    expect(bandedLines('intro\n\n```ts\nconst a = 1;\n```\n\nafter')).toEqual([
      3, 4, 5,
    ]);
  });

  it('bands an indented code block', () => {
    expect(bandedLines('para\n\n    code one\n    code two\n\nend')).toEqual([
      3, 4,
    ]);
  });

  it('leaves inline code and prose alone', () => {
    expect(bandedLines('a `b` c\n\n# Heading\n- item')).toEqual([]);
  });

  it('bands only the part of a block inside the given range', () => {
    const doc = '```\none\ntwo\nthree\n```';
    const state = stateOf(doc);
    const lines: number[] = [];
    const from = state.doc.line(3).from;
    const to = state.doc.line(4).to;
    codeBlockLines(state, [{ from, to }]).between(0, doc.length, (pos) => {
      lines.push(state.doc.lineAt(pos).number);
    });
    expect(lines).toEqual([3, 4]);
  });
});

describe('noteMarkdownTags in the theme', () => {
  /** Computed colour of the innermost span whose whole text is `text`. */
  function colorOf(container: HTMLElement, text: string): string {
    const span = [...container.querySelectorAll('.cm-line span')].find(
      (el) => el.childElementCount === 0 && el.textContent === text,
    );
    if (!span) throw new Error(`no span for ${JSON.stringify(text)}`);
    return getComputedStyle(span).color;
  }

  it('paints block marks apart from inline punctuation', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = initialize(
      container,
      new MemNoteStore('# Title\n\n- **bold** item\n\n> quote'),
      'light',
    );
    try {
      const inline = colorOf(container, '**');
      const heading = colorOf(container, '#');
      const list = colorOf(container, '-');
      const quote = colorOf(container, '>');
      expect(new Set([inline, heading, list, quote]).size).toBe(4);
    } finally {
      editor.dispose();
      container.remove();
    }
  });
});
