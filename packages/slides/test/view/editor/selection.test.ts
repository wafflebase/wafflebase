import { describe, it, expect, vi } from 'vitest';
import { Selection } from '../../../src/view/editor/selection';

describe('Selection', () => {
  it('starts empty', () => {
    const sel = new Selection();
    expect(sel.get()).toEqual([]);
  });

  it('set replaces the selection and notifies subscribers', () => {
    const sel = new Selection();
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.set(['a', 'b']);
    expect(sel.get()).toEqual(['a', 'b']);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('toggle adds an unselected id', () => {
    const sel = new Selection();
    sel.set(['a']);
    sel.toggle('b');
    expect(sel.get()).toEqual(['a', 'b']);
  });

  it('toggle removes an already-selected id', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    sel.toggle('a');
    expect(sel.get()).toEqual(['b']);
  });

  it('clear empties and notifies', () => {
    const sel = new Selection();
    sel.set(['a']);
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.clear();
    expect(sel.get()).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not notify when set is called with the same selection', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.set(['a', 'b']);
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function', () => {
    const sel = new Selection();
    const cb = vi.fn();
    const off = sel.subscribe(cb);
    off();
    sel.set(['a']);
    expect(cb).not.toHaveBeenCalled();
  });

  it('has() reports membership', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    expect(sel.has('a')).toBe(true);
    expect(sel.has('c')).toBe(false);
  });
});
