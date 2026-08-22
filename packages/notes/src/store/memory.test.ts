import { describe, it, expect } from 'vitest';
import { MemNoteStore } from './memory.js';

describe('MemNoteStore', () => {
  it('returns initial text', () => {
    expect(new MemNoteStore('hello').getText()).toBe('hello');
    expect(new MemNoteStore().getText()).toBe('');
  });
  it('applies an insert edit', () => {
    const s = new MemNoteStore('hello');
    s.editText(5, 5, ' world');
    expect(s.getText()).toBe('hello world');
  });
  it('applies a replace-range edit', () => {
    const s = new MemNoteStore('hello world');
    s.editText(0, 5, 'goodbye');
    expect(s.getText()).toBe('goodbye world');
  });
  it('undoes and redoes a single edit', () => {
    const s = new MemNoteStore('hello');
    expect(s.canUndo()).toBe(false);
    s.editText(5, 5, ' world');
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.getText()).toBe('hello');
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.getText()).toBe('hello world');
  });
  it('collapses a batch into one undo unit', () => {
    const s = new MemNoteStore('hello');
    s.batch(() => {
      s.editText(5, 5, ' world');
      s.editText(11, 11, '!');
    });
    expect(s.getText()).toBe('hello world!');
    s.undo();
    expect(s.getText()).toBe('hello');
    expect(s.canUndo()).toBe(false);
  });
  it('records nothing for a batch that edits nothing', () => {
    const s = new MemNoteStore('hello');
    s.batch(() => {});
    expect(s.canUndo()).toBe(false);
  });
  it('folds a nested batch into the outer undo unit', () => {
    const s = new MemNoteStore('a');
    s.batch(() => {
      s.editText(1, 1, 'b');
      s.batch(() => {
        s.editText(2, 2, 'c');
      });
    });
    expect(s.getText()).toBe('abc');
    s.undo();
    expect(s.getText()).toBe('a');
  });
  it('drops the redo branch once a new edit lands', () => {
    const s = new MemNoteStore('a');
    s.editText(1, 1, 'b');
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.editText(1, 1, 'c');
    expect(s.canRedo()).toBe(false);
  });
  it('emits the reverted text to remote subscribers', () => {
    const s = new MemNoteStore('hello');
    const seen: string[] = [];
    s.subscribeRemote((c) => {
      if (c.type === 'replace') seen.push(c.content);
    });
    s.editText(5, 5, '!');
    expect(seen).toEqual([]); // local edits are not echoed back
    s.undo();
    s.redo();
    expect(seen).toEqual(['hello', 'hello!']);
  });
  it('restores the pre-edit selection on undo and the post-edit on redo', () => {
    const s = new MemNoteStore('hello');
    // Mirror the editor flow: the live caret publishes before the edit, the
    // batch records the post-edit caret.
    s.setLocalSelection(5, 5);
    s.batch(() => {
      s.editText(5, 5, ' world');
      s.recordSelectionForHistory({ anchor: 11, head: 11 });
    });
    expect(s.undo()).toEqual({ anchor: 5, head: 5 });
    expect(s.getText()).toBe('hello');
    expect(s.redo()).toEqual({ anchor: 11, head: 11 });
    expect(s.getText()).toBe('hello world');
  });
  it('restores a ranged selection, not just a caret', () => {
    const s = new MemNoteStore('hello world');
    s.setLocalSelection(0, 5); // "hello" selected
    s.batch(() => {
      s.editText(0, 5, 'hi');
      s.recordSelectionForHistory({ anchor: 2, head: 2 });
    });
    expect(s.undo()).toEqual({ anchor: 0, head: 5 });
  });
  it('pins the post-edit selection for redo through a later caret move', () => {
    // The recorded post-edit caret is the redo restore point; a caret move
    // between the edit and the undo must not drift it (matches the Yorkie
    // store, which pins it into the change).
    const s = new MemNoteStore('hello');
    s.setLocalSelection(5, 5);
    s.batch(() => {
      s.editText(5, 5, '!');
      s.recordSelectionForHistory({ anchor: 6, head: 6 });
    });
    s.setLocalSelection(0, 0); // move the caret after the edit, before undo
    s.undo();
    expect(s.redo()).toEqual({ anchor: 6, head: 6 });
  });
  it('returns null when no selection was recorded for the unit', () => {
    const s = new MemNoteStore('hi');
    s.editText(2, 2, '!'); // no caret tracked before the edit
    expect(s.undo()).toBeNull();
  });
  it('returns null when there is nothing to undo or redo', () => {
    expect(new MemNoteStore('x').undo()).toBeNull();
    expect(new MemNoteStore('x').redo()).toBeNull();
  });
  describe('authorship', () => {
    /** The author of every character of the store's text, in order. */
    const perChar = (s: MemNoteStore): (string | null)[] => {
      const out: (string | null)[] = [];
      for (const span of s.getAuthorSpans()) {
        for (let i = span.from; i < span.to; i++) out.push(span.author);
      }
      return out;
    };

    it('records nothing until a local author is set', () => {
      const s = new MemNoteStore('hi');
      s.editText(2, 2, '!');
      expect(perChar(s)).toEqual([null, null, null]);
    });

    it('attributes inserted text to the current local author', () => {
      const s = new MemNoteStore('hi');
      s.setLocalAuthor('ann');
      s.editText(2, 2, 'A');
      s.setLocalAuthor('bob');
      s.editText(3, 3, 'B');
      expect(perChar(s)).toEqual([null, null, 'ann', 'bob']);
    });

    it('restores authorship on undo and redo, not just text', () => {
      // The gutter reads authorship, not text, so a restore that only puts the
      // characters back leaves every label after an undo attributed to whoever
      // happened to occupy that offset before.
      const s = new MemNoteStore('hi');
      s.setLocalAuthor('ann');
      s.editText(2, 2, 'A');
      s.setLocalAuthor('bob');
      s.editText(3, 3, 'B');

      s.undo();
      expect(s.getText()).toBe('hiA');
      expect(perChar(s)).toEqual([null, null, 'ann']);

      s.redo();
      expect(s.getText()).toBe('hiAB');
      expect(perChar(s)).toEqual([null, null, 'ann', 'bob']);
    });

    it('restores the authorship a batch replaced', () => {
      const s = new MemNoteStore('hi');
      s.setLocalAuthor('ann');
      s.editText(0, 2, 'AA');
      s.setLocalAuthor('bob');
      s.batch(() => {
        s.editText(0, 1, 'B');
        s.editText(1, 2, 'B');
      });
      expect(perChar(s)).toEqual(['bob', 'bob']);
      s.undo();
      expect(perChar(s)).toEqual(['ann', 'ann']);
      s.redo();
      expect(perChar(s)).toEqual(['bob', 'bob']);
    });

    it('attributes an edit made after an undo to the current author', () => {
      // The restored state is the base the next edit splices into, so the
      // authorship it carries has to be the restored one, not the live array
      // that was current before the undo.
      const s = new MemNoteStore('');
      s.setLocalAuthor('ann');
      s.editText(0, 0, 'a');
      s.setLocalAuthor('bob');
      s.editText(1, 1, 'b');
      s.undo(); // back to 'a' by ann
      s.setLocalAuthor('cid');
      s.editText(1, 1, 'c'); // a fresh edit onto the restored state
      expect(perChar(s)).toEqual(['ann', 'cid']);
      s.undo();
      expect(perChar(s)).toEqual(['ann']);
    });

    it('leaves a pure deletion unattributed', () => {
      const s = new MemNoteStore('hi');
      s.setLocalAuthor('ann');
      s.editText(0, 1, '');
      expect(perChar(s)).toEqual([null]);
    });
  });

  it('has no peers and no-op presence', () => {
    const s = new MemNoteStore('x');
    expect(s.getPeerSelections()).toEqual([]);
    expect(typeof s.subscribeRemote(() => {})).toBe('function');
    expect(typeof s.subscribePresence(() => {})).toBe('function');
    s.setLocalSelection(0, 1); // no throw
  });
});
