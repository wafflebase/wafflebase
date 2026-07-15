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
  it('has no peers and no-op presence', () => {
    const s = new MemNoteStore('x');
    expect(s.getPeerSelections()).toEqual([]);
    expect(typeof s.subscribeRemote(() => {})).toBe('function');
    expect(typeof s.subscribePresence(() => {})).toBe('function');
    s.setLocalSelection(0, 1); // no throw
  });
});
