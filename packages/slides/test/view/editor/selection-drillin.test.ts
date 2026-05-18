import { describe, expect, it } from 'vitest';
import { Selection } from '../../../src/view/editor/selection';

describe('Selection drill-in', () => {
  // -------------------------------------------------------------------------
  // Basic transitions (no drill-in active)
  // -------------------------------------------------------------------------

  it('click on empty canvas clears selection', () => {
    const sel = new Selection();
    sel.click(null, {});
    expect(sel.get()).toEqual([]);
    expect(sel.getScope()).toEqual([]);
  });

  it('click on slide-root element selects it', () => {
    const sel = new Selection();
    sel.click({ elementId: 'a', ancestorPath: ['a'] }, {});
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['a']);
  });

  it('click on group child selects the outermost group', () => {
    const sel = new Selection();
    sel.click({ elementId: 'leaf', ancestorPath: ['g', 'leaf'] }, {});
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['g']);
  });

  it('click on deeply nested element selects outermost ancestor', () => {
    const sel = new Selection();
    sel.click({ elementId: 'leaf', ancestorPath: ['outer', 'inner', 'leaf'] }, {});
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['outer']);
  });

  // -------------------------------------------------------------------------
  // Double-click drill-in
  // -------------------------------------------------------------------------

  it('double-click on group child drills in one level', () => {
    const sel = new Selection();
    sel.doubleClick({ elementId: 'leaf', ancestorPath: ['g', 'leaf'] });
    expect(sel.getScope()).toEqual(['g']);
    expect(sel.get()).toEqual(['leaf']);
  });

  it('double-click on deeply nested element drills ONE level only', () => {
    const sel = new Selection();
    sel.doubleClick({ elementId: 'leaf', ancestorPath: ['outer', 'inner', 'leaf'] });
    expect(sel.getScope()).toEqual(['outer']);
    expect(sel.get()).toEqual(['inner']);
  });

  it('double-click again drills another level', () => {
    const sel = new Selection();
    sel.setScope(['outer']);
    sel.doubleClick({ elementId: 'leaf', ancestorPath: ['outer', 'inner', 'leaf'] });
    expect(sel.getScope()).toEqual(['outer', 'inner']);
    expect(sel.get()).toEqual(['leaf']);
  });

  it('double-click on a leaf (no deeper nesting) is a no-op on scope', () => {
    // ancestorPath has exactly scope.length + 1 entries — already at leaf.
    const sel = new Selection();
    sel.setScope(['g']);
    sel.doubleClick({ elementId: 'leaf', ancestorPath: ['g', 'leaf'] });
    // scope stays ['g'], but the element is selected
    expect(sel.getScope()).toEqual(['g']);
    expect(sel.get()).toEqual(['leaf']);
  });

  it('double-click on empty canvas clears selection', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    sel.set(['leaf']);
    sel.doubleClick(null);
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Clicking within a drilled-in scope
  // -------------------------------------------------------------------------

  it('click on sibling within scope updates ids but not scope', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    sel.set(['a']);
    sel.click({ elementId: 'b', ancestorPath: ['g', 'b'] }, {});
    expect(sel.getScope()).toEqual(['g']);
    expect(sel.get()).toEqual(['b']);
  });

  // -------------------------------------------------------------------------
  // Click outside the drilled-in scope
  // -------------------------------------------------------------------------

  it('click outside scope resets scope then evaluates the click', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    // 'sibling' is a slide-root element, not under 'g'
    sel.click({ elementId: 'sibling', ancestorPath: ['sibling'] }, {});
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['sibling']);
  });

  it('click outside scope when hit is a root-level group selects that group', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    // 'other' is a group at root, not under 'g'
    sel.click({ elementId: 'leaf2', ancestorPath: ['other', 'leaf2'] }, {});
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['other']);
  });

  // -------------------------------------------------------------------------
  // Shift-click
  // -------------------------------------------------------------------------

  it('shift-click within scope toggles ids', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    sel.set(['a']);
    sel.click({ elementId: 'b', ancestorPath: ['g', 'b'] }, { shift: true });
    expect(sel.getScope()).toEqual(['g']);
    expect(sel.get()).toEqual(['a', 'b']);
  });

  it('shift-click on already-selected element deselects it', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    sel.set(['a', 'b']);
    sel.click({ elementId: 'a', ancestorPath: ['g', 'a'] }, { shift: true });
    expect(sel.getScope()).toEqual(['g']);
    expect(sel.get()).toEqual(['b']);
  });

  it('shift-click on root-level element adds to selection', () => {
    const sel = new Selection();
    sel.set(['a']);
    sel.click({ elementId: 'b', ancestorPath: ['b'] }, { shift: true });
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual(['a', 'b']);
  });

  // -------------------------------------------------------------------------
  // Escape
  // -------------------------------------------------------------------------

  it('escape pops scope and clears ids', () => {
    const sel = new Selection();
    sel.setScope(['outer', 'inner']);
    sel.set(['leaf']);
    sel.escape();
    expect(sel.getScope()).toEqual(['outer']);
    expect(sel.get()).toEqual([]);
  });

  it('escape from single-level scope returns to root', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    sel.set(['child']);
    sel.escape();
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual([]);
  });

  it('escape on empty scope is a no-op', () => {
    const sel = new Selection();
    sel.escape();
    expect(sel.getScope()).toEqual([]);
    expect(sel.get()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Subscriber notifications
  // -------------------------------------------------------------------------

  it('subscribers notified on scope changes', () => {
    const sel = new Selection();
    let count = 0;
    sel.subscribe(() => count++);
    sel.setScope(['g']);
    expect(count).toBe(1);
    sel.escape();
    expect(count).toBe(2);
  });

  it('subscribers notified on click (scope + ids change together counts as one)', () => {
    const sel = new Selection();
    let count = 0;
    sel.subscribe(() => count++);
    // click on root element — scope stays [], ids change
    sel.click({ elementId: 'a', ancestorPath: ['a'] }, {});
    expect(count).toBe(1);
  });

  it('setScope does not notify when value is unchanged', () => {
    const sel = new Selection();
    sel.setScope(['g']);
    let count = 0;
    sel.subscribe(() => count++);
    sel.setScope(['g']); // same value
    expect(count).toBe(0);
  });

  it('no notification when click yields no state change', () => {
    const sel = new Selection();
    sel.set(['a']);
    let count = 0;
    sel.subscribe(() => count++);
    // clicking the same root element again — no change
    sel.click({ elementId: 'a', ancestorPath: ['a'] }, {});
    expect(count).toBe(0);
  });
});
