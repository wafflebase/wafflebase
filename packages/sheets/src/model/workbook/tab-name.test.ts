import { describe, it, expect, vi } from 'vitest';
import { generateTabId } from './tab-name';

describe('generateTabId', () => {
  it('keeps the tab- prefix and a millisecond timestamp', () => {
    // The shape is depended on by nothing, but it is what makes an id
    // readable in a Yorkie root dump — keep it deliberate, not accidental.
    const [prefix, ts, suffix] = generateTabId().split('-');
    expect(prefix).toBe('tab');
    expect(Number(ts)).toBeGreaterThan(0);
    expect(suffix).toMatch(/^[a-z0-9]{12}$/);
  });

  it('does not collide across a burst inside one millisecond', () => {
    // THE REGRESSION THIS EXISTS FOR. The suffix used to be four base36 chars
    // from Math.random (~1.7M values), and the timestamp gives no help at all
    // in the case that matters: two creates race precisely when they land in
    // the same millisecond, which is when the timestamp is identical. A
    // collision is not a cosmetic id clash — `root.tabs[id]`, `root.sheets[id]`
    // and `tabOrder` are all keyed by it, so two tabs merge into one and a
    // worksheet's cells are lost.
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i++) ids.add(generateTabId());
    expect(ids.size).toBe(20_000);
  });

  it('draws the suffix from the CSPRNG, not Math.random', () => {
    // `crypto.randomUUID` is deliberately NOT used: this package runs in the
    // browser and that API is absent outside secure contexts, whereas
    // `getRandomValues` has no such restriction.
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const random = vi.spyOn(Math, 'random');

    generateTabId();

    expect(spy).toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();

    spy.mockRestore();
    random.mockRestore();
  });
});
