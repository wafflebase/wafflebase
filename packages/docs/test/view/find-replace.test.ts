import { describe, it, expect } from 'vitest';
import { FindReplaceState } from '../../src/view/find-replace.js';
import { Doc } from '../../src/model/document.js';

describe('FindReplaceState', () => {
  it('should track matches and active index', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'aaa bbb aaa');
    const state = new FindReplaceState(doc);
    state.search('aaa');
    expect(state.matches).toHaveLength(2);
    expect(state.activeIndex).toBe(0);
  });

  it('should navigate next and wrap', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'x x x');
    const state = new FindReplaceState(doc);
    state.search('x');
    expect(state.activeIndex).toBe(0);
    state.next();
    expect(state.activeIndex).toBe(1);
    state.next();
    expect(state.activeIndex).toBe(2);
    state.next();
    expect(state.activeIndex).toBe(0);
  });

  it('should navigate previous and wrap', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'x x');
    const state = new FindReplaceState(doc);
    state.search('x');
    state.previous();
    expect(state.activeIndex).toBe(1);
  });

  it('should replace active match', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'foo bar foo');
    const state = new FindReplaceState(doc);
    state.search('foo');
    state.replaceActive('baz');
    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'baz bar foo',
    );
    expect(state.matches).toHaveLength(1);
  });

  it('should replace all', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'aa bb aa');
    const state = new FindReplaceState(doc);
    state.search('aa');
    state.replaceAll('cc');
    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'cc bb cc',
    );
    expect(state.matches).toHaveLength(0);
  });

  // The document can change while the find bar stays open — the user typing
  // elsewhere, or a remote peer — and the offsets `search()` stored then name
  // text that has moved. Both replace paths refresh before writing (#1083).

  it('should replace the current match after the document changes', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'cat dog');

    const state = new FindReplaceState(doc);
    state.search('dog');

    // Simulate editing the document while Find & Replace is still open.
    doc.insertText({ blockId, offset: 0 }, 'big ');

    state.replaceActive('fox');

    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'big cat fox',
    );
    // The refresh re-ran the search, so the state describes the new document.
    expect(state.matches).toHaveLength(0);
    expect(state.activeIndex).toBe(-1);
  });

  it('should replace every current match after the document changes', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'dog cat dog');

    const state = new FindReplaceState(doc);
    state.search('dog');
    expect(state.matches).toHaveLength(2);

    // Shift both stored offsets, and add a third match the search never saw.
    doc.insertText({ blockId, offset: 0 }, 'dog ');

    state.replaceAll('fox');

    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'fox fox cat fox',
    );
    expect(state.matches).toHaveLength(0);
  });

  it('should keep the active match when one is inserted before it', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'dog cat dog');

    const state = new FindReplaceState(doc);
    state.search('dog');
    state.next();
    // The bar has painted the *second* 'dog' as active.
    expect(state.activeIndex).toBe(1);

    // A new occurrence appears ahead of it, so ordinal 1 now names the one
    // that was inserted rather than the one the user is looking at.
    doc.insertText({ blockId, offset: 0 }, 'dog ');

    state.replaceActive('fox');

    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'dog dog cat fox',
    );
  });

  it('should keep the active match when one is removed before it', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'dog cat dog');

    const state = new FindReplaceState(doc);
    state.search('dog');
    state.next();
    expect(state.activeIndex).toBe(1);

    doc.deleteText({ blockId, offset: 0 }, 4);

    state.replaceActive('fox');

    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'cat fox',
    );
  });

  it('should do nothing when the edit removed the only match', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'cat dog');

    const state = new FindReplaceState(doc);
    state.search('dog');

    // The match itself is gone by the time Replace is clicked.
    doc.deleteText({ blockId, offset: 4 }, 3);

    state.replaceActive('fox');
    state.replaceAll('fox');

    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'cat ',
    );
    expect(state.matches).toHaveLength(0);
    expect(state.activeIndex).toBe(-1);
  });

  it('should handle empty query', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'hello');
    const state = new FindReplaceState(doc);
    state.search('');
    expect(state.matches).toHaveLength(0);
    expect(state.activeIndex).toBe(-1);
  });

  it('should handle no matches', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'hello');
    const state = new FindReplaceState(doc);
    state.search('xyz');
    expect(state.matches).toHaveLength(0);
    expect(state.activeIndex).toBe(-1);
  });

  it('should not crash on next/previous with no matches', () => {
    const doc = Doc.create();
    const state = new FindReplaceState(doc);
    state.search('nope');
    state.next();
    expect(state.activeIndex).toBe(-1);
    state.previous();
    expect(state.activeIndex).toBe(-1);
  });

  it('should not crash on replaceActive with no matches', () => {
    const doc = Doc.create();
    const state = new FindReplaceState(doc);
    state.search('nope');
    state.replaceActive('x');
    expect(state.matches).toHaveLength(0);
  });

  it('should support case-sensitive search', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Foo foo FOO');
    const state = new FindReplaceState(doc);
    state.search('foo', { caseSensitive: true });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].startOffset).toBe(4);
  });

  it('should support regex search', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'cat bat sat');
    const state = new FindReplaceState(doc);
    state.search('[cb]at', { useRegex: true });
    expect(state.matches).toHaveLength(2);
  });

  it('should clamp activeIndex after replace reduces matches', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'aa aa');
    const state = new FindReplaceState(doc);
    state.search('aa');
    expect(state.matches).toHaveLength(2);
    state.next(); // activeIndex = 1
    state.replaceActive('bb'); // now only 1 match, activeIndex should be 0
    expect(state.matches).toHaveLength(1);
    expect(state.activeIndex).toBe(0);
  });
});
