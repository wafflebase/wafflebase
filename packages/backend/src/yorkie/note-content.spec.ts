import {
  readNoteRoot,
  writeNoteRoot,
  type NoteYorkieRoot,
} from './note-content';

/**
 * Minimal stand-in for a Yorkie `Text` proxy. `writeNoteRoot` only touches
 * `edit` / `length`, and `readNoteRoot` only `toString`, so a plain object
 * with those members exercises both without a live Yorkie document.
 */
function fakeText(initial: string) {
  let value = initial;
  const edits: Array<[number, number, string]> = [];
  return {
    edits,
    get length() {
      return value.length;
    },
    toString: () => value,
    edit(from: number, to: number, content: string) {
      edits.push([from, to, content]);
      value = value.slice(0, from) + content + value.slice(to);
    },
  };
}

describe('readNoteRoot', () => {
  it('returns empty content for an unwritten root', () => {
    expect(readNoteRoot({} as NoteYorkieRoot)).toEqual({ content: '' });
  });

  it('returns the markdown string held in the content Text', () => {
    const text = fakeText('# Hello\n\nWorld');
    const root = { content: text } as unknown as NoteYorkieRoot;
    expect(readNoteRoot(root)).toEqual({ content: '# Hello\n\nWorld' });
  });

  it('reads empty for a mis-materialized content lacking edit', () => {
    // A plain object still has Object.prototype.toString → "[object Object]".
    // The `.edit` guard must reject it rather than leak that string.
    const root = { content: { text: 'x' } } as unknown as NoteYorkieRoot;
    expect(readNoteRoot(root)).toEqual({ content: '' });
  });
});

describe('writeNoteRoot', () => {
  it('replaces the whole existing Text with the new markdown', () => {
    const text = fakeText('old body');
    const root = { content: text } as unknown as NoteYorkieRoot;

    writeNoteRoot(root, { content: 'brand new markdown' });

    // Wipe-and-rewrite: a single edit spanning the full prior length.
    expect(text.edits).toEqual([[0, 'old body'.length, 'brand new markdown']]);
    expect(text.toString()).toBe('brand new markdown');
  });

  it('clears content when given an empty string', () => {
    const text = fakeText('something');
    const root = { content: text } as unknown as NoteYorkieRoot;

    writeNoteRoot(root, { content: '' });

    expect(text.edits).toEqual([[0, 'something'.length, '']]);
    expect(text.toString()).toBe('');
  });
});
