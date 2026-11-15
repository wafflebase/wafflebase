import { describe, it, expect } from 'vitest';
import { resolveActiveTabId } from '../../../src/app/documents/active-tab.ts';

const tabs = { a: { id: 'a' }, b: { id: 'b' } };

describe('resolveActiveTabId', () => {
  it('keeps a tab that still exists', () => {
    expect(resolveActiveTabId(['a', 'b'], tabs, 'b')).toBe('b');
  });

  it('picks the first tab when none is selected', () => {
    expect(resolveActiveTabId(['b', 'a'], tabs, null)).toBe('b');
  });

  // A peer's delete or a revision restore can remove the tab being viewed;
  // left alone the editor keeps a tab id that no longer resolves.
  it('re-picks when the selected tab is gone', () => {
    expect(resolveActiveTabId(['a', 'b'], tabs, 'gone')).toBe('a');
  });

  it('skips order entries with no tab meta', () => {
    expect(resolveActiveTabId(['ghost', 'b'], tabs, 'gone')).toBe('b');
  });

  it('is null when there is no tab at all', () => {
    expect(resolveActiveTabId([], {}, 'gone')).toBeNull();
    expect(resolveActiveTabId(undefined, undefined, null)).toBeNull();
  });
});
