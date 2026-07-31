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
  it('has no peers and no-op presence', () => {
    const s = new MemNoteStore('x');
    expect(s.getPeerSelections()).toEqual([]);
    expect(typeof s.subscribeRemote(() => {})).toBe('function');
    expect(typeof s.subscribePresence(() => {})).toBe('function');
    s.setLocalSelection(0, 1); // no throw
  });
});
