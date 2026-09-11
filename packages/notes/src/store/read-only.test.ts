import { describe, expect, it, vi } from 'vitest';
import { MemNoteStore } from './memory.js';
import { readOnlyNoteStore } from './read-only.js';

/**
 * These pin the write boundary a viewer-role share link relies on. The
 * view-level gates in `view/editor.ts` only see CodeMirror transactions, so
 * what is asserted here is that a *store handle* — the thing the engine, the
 * toolbar's `NoteEditorAPI`, and the frontend mount all hold — cannot write,
 * by any route.
 */
describe('readOnlyNoteStore', () => {
  it('forwards reads and subscriptions', () => {
    const store = new MemNoteStore('hello');
    const view = readOnlyNoteStore(store);

    expect(view.getText()).toBe('hello');
    expect(view.getPeerSelections()).toEqual([]);
    expect(view.getAuthorSpans()).toHaveLength(1);
    expect(view.canUndo()).toBe(false);

    // A viewer still has to receive a peer's edits, so the subscription is a
    // real one — neutering it would freeze the mount, not secure it.
    const listener = vi.fn();
    const unsub = view.subscribeRemote(listener);
    store.editText(5, 5, '!');
    store.undo();
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('neuters every write path', () => {
    const store = new MemNoteStore('hello');
    const view = readOnlyNoteStore(store);

    view.editText(0, 5, 'goodbye');
    view.batch(() => {
      view.editText(0, 0, 'x');
      view.recordSelectionForHistory({ anchor: 0, head: 0 });
    });
    view.setLocalSelection(1, 2);
    expect(view.undo()).toBeNull();
    expect(view.redo()).toBeNull();

    expect(store.getText()).toBe('hello');
    expect(store.canUndo()).toBe(false);
    // `setLocalSelection` and `recordSelectionForHistory` write no text, so
    // the two assertions above cannot see either one forward — and forwarding
    // is exactly what must not happen: on `YorkieNoteStore` both publish the
    // caret through `doc.update`, the write the auth webhook refuses a viewer.
    // `MemNoteStore` lands both in `currentSelection`, which stands in for
    // that presence write the same way `text` stands in for the CRDT above.
    expect(
      (store as unknown as { currentSelection: unknown }).currentSelection,
    ).toBeNull();
  });

  it('still runs a batch body, so batched reads work', () => {
    const view = readOnlyNoteStore(new MemNoteStore('hello'));
    const read = vi.fn();
    view.batch(() => read(view.getText()));
    expect(read).toHaveBeenCalledWith('hello');
  });

  it('hides fields, so the raw store behind the handle is unreachable', () => {
    const store = new MemNoteStore('hello');
    const view = readOnlyNoteStore(store) as unknown as Record<string, unknown>;

    // `YorkieNoteStore.doc` is the CRDT handle, whose `update()` is the
    // documented write path; `MemNoteStore.text` stands in for it here.
    expect(view.text).toBeUndefined();
    expect('text' in view).toBe(false);
    expect(Object.keys(view)).toEqual([]);
    expect({ ...view }).toEqual({});
  });

  it('refuses the ways around a bare property read', () => {
    const store = new MemNoteStore('hello');
    const view = readOnlyNoteStore(store);

    // `Object.getPrototypeOf(view).editText.call(store, …)` would otherwise
    // reach the class prototype's real method.
    expect(Object.getPrototypeOf(view)).toBeNull();
    expect(() => Object.setPrototypeOf(view, { editText: () => {} })).toThrow();
    expect(() => Object.preventExtensions(view)).toThrow();
    expect(() => {
      (view as unknown as Record<string, unknown>).editText = () => {};
    }).toThrow();
    expect(() =>
      Object.defineProperty(view, 'editText', { value: () => {} }),
    ).toThrow();
    expect(() => {
      delete (view as unknown as Record<string, unknown>).getText;
    }).toThrow();

    expect(store.getText()).toBe('hello');
  });

  it('memoizes members and is idempotent', () => {
    const store = new MemNoteStore('hello');
    const view = readOnlyNoteStore(store);

    // Stable identity keeps a member usable as a dependency or a map key.
    expect(view.getText).toBe(view.getText);
    // Both the engine and the frontend mount guard their handle without being
    // able to see whether the other already did.
    expect(readOnlyNoteStore(view)).toBe(view);
  });
});
