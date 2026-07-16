import { describe, it, expect } from 'vitest';
import { Document, Text } from '@yorkie-js/sdk';
import { YorkieNoteStore } from './yorkie-note-store';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

function makeDoc(): Document<YorkieNotesRoot, NotesPresence> {
  const doc = new Document<YorkieNotesRoot, NotesPresence>('note-test');
  doc.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, 'hello');
  });
  return doc;
}

describe('YorkieNoteStore', () => {
  it('reads text from the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getText()).toBe('hello');
  });

  it('applies a local edit into the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    store.editText(5, 5, ' world');
    expect(store.getText()).toBe('hello world');
  });

  it('has no peer selections for a single client', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getPeerSelections()).toEqual([]);
  });
});
