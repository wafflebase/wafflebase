import { describe, it, expect } from 'vitest';
import { boardInitialRootForRole, initialBoardRoot } from './board-document';

describe('boardInitialRootForRole', () => {
  // The SDK writes every absent `initialRoot` key on each attach, so seeding
  // from a viewer's client means a viewer creates `meta` and `elements` on a
  // never-edited board just by opening the share link.
  it('seeds nothing for a viewer', () => {
    expect(boardInitialRootForRole('viewer')).toEqual({});
  });

  it('still seeds for anyone who can write', () => {
    expect(boardInitialRootForRole('editor')).toEqual(initialBoardRoot());
    expect(boardInitialRootForRole('owner').elements).toEqual([]);
  });
});

describe('initialBoardRoot', () => {
  // `initialBoardRoot` is shared by the react provider and, via
  // `apply-imported-content`, a plain `@yorkie-js/sdk` client. A CRDT value
  // here would be recognized by only one of them — the trap docs walked into.
  // Plain values are realm-free, which is what keeps that sharing safe.
  it('seeds no value whose class identity matters', () => {
    for (const value of Object.values(initialBoardRoot())) {
      expect(
        Array.isArray(value) || value?.constructor === Object,
      ).toBe(true);
    }
  });
});
