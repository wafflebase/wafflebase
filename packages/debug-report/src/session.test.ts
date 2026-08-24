import { describe, expect, it, vi } from 'vitest';
import { createSession, type NewItem } from './session';
import type { Target } from './types';

const target: Target = {
  kind: 'dom',
  selector: 'button.icon',
  tag: 'button',
  rect: { x: 0, y: 0, w: 24, h: 24 },
};

/** Deterministic ids and clock, so assertions are about behaviour not entropy. */
function session() {
  let id = 0;
  let clock = 1_000;
  return createSession({
    newId: () => `i${(id += 1)}`,
    now: () => (clock += 1),
  });
}

const item = (note: string, extra: Partial<NewItem> = {}): NewItem => ({
  note,
  target,
  ...extra,
});

describe('session', () => {
  it('starts off with nothing collected', () => {
    const s = session();
    expect(s.mode()).toBe('off');
    expect(s.count()).toBe(0);
  });

  it('assigns identity and time, and defaults the disposition to verify', () => {
    const s = session();
    const stored = s.add(item('cramped'));
    expect(stored.id).toBe('i1');
    expect(stored.createdAt).toBe(1_001);
    expect(stored.disposition).toBe('verify');
    expect(stored.agentCandidate).toBe(false);
    expect(s.items()).toEqual([stored]);
  });

  it('keeps collection order', () => {
    const s = session();
    s.add(item('first'));
    s.add(item('second'));
    expect(s.items().map((i) => i.note)).toEqual(['first', 'second']);
  });

  it('notifies subscribers on add, update and remove', () => {
    const s = session();
    const seen = vi.fn();
    s.subscribe(seen);
    const stored = s.add(item('a'));
    s.update(stored.id, { note: 'b' });
    s.remove(stored.id);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('does not notify for a mode set to the mode it is already in', () => {
    const s = session();
    const seen = vi.fn();
    s.subscribe(seen);
    s.setMode('pick');
    s.setMode('pick');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not notify for a remove or clear that changes nothing', () => {
    const s = session();
    const seen = vi.fn();
    s.subscribe(seen);
    s.remove('nope');
    s.clear();
    expect(seen).not.toHaveBeenCalled();
  });

  it('toggles into pick from off and back to off from any live mode', () => {
    const s = session();
    s.toggle();
    expect(s.mode()).toBe('pick');
    s.setMode('region');
    s.toggle();
    expect(s.mode()).toBe('off');
  });

  it('merges a patch without touching the other fields', () => {
    const s = session();
    const stored = s.add(item('cramped'));
    s.update(stored.id, { disposition: 'publish', agentCandidate: true });
    const [updated] = s.items();
    expect(updated.note).toBe('cramped');
    expect(updated.disposition).toBe('publish');
    expect(updated.agentCandidate).toBe(true);
    expect(updated.createdAt).toBe(stored.createdAt);
  });

  it('ignores a patch for an id it does not hold', () => {
    const s = session();
    s.add(item('a'));
    const before = s.items();
    s.update('missing', { note: 'b' });
    expect(s.items()).toBe(before);
  });

  it('replaces the whole list when rehydrating from the store', () => {
    const s = session();
    s.add(item('from this session'));
    const restored = { ...s.items()[0], id: 'restored', note: 'from last session' };
    s.replaceAll([restored]);
    expect(s.items()).toEqual([restored]);
  });

  it('stops notifying an unsubscribed listener', () => {
    const s = session();
    const seen = vi.fn();
    const off = s.subscribe(seen);
    off();
    s.add(item('a'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('survives a listener that unsubscribes while being notified', () => {
    const s = session();
    const second = vi.fn();
    const off = s.subscribe(() => off());
    s.subscribe(second);
    expect(() => s.add(item('a'))).not.toThrow();
    // Iterating a snapshot is what makes this hold: mutating the set mid-loop
    // would otherwise skip the listener after the one that unsubscribed.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs every listener even when one throws, then reports the failure', () => {
    const s = session();
    const healthy = vi.fn();
    s.subscribe(() => {
      throw new Error('panel broke');
    });
    s.subscribe(healthy);
    // The panel failing to render is no reason for the store to miss a write,
    // and swallowing the error would make a broken subscriber invisible.
    expect(() => s.add(item('a'))).toThrow('panel broke');
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(s.count()).toBe(1);
  });

  it('holds the added item even when notification throws', () => {
    const s = session();
    s.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => s.add(item('a'))).toThrow();
    expect(s.items()).toHaveLength(1);
  });

  it('clears everything after a handover', () => {
    const s = session();
    s.add(item('a'));
    s.add(item('b'));
    s.clear();
    expect(s.count()).toBe(0);
  });

  it('gives separate instances separate state', () => {
    const a = session();
    const b = session();
    a.add(item('only in a'));
    expect(b.count()).toBe(0);
  });
  it('surfaces a listener that throws `undefined`', () => {
    // `throw undefined` is legal, and testing the captured error against
    // `undefined` made exactly that failure invisible — the one thing the
    // rethrow exists to prevent.
    const s = createSession();
    s.subscribe(() => {
      throw undefined;
    });
    expect(() => s.setMode('idle')).toThrow();
  });

});
