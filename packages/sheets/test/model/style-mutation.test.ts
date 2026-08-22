import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';
import { compactCell } from '../../src/model/worksheet/style-mutation';

describe('compactCell', () => {
  it('should drop undefined fields', () => {
    expect(compactCell({ v: '1' })).toEqual({ v: '1' });
    expect(compactCell({}, { b: true })).toEqual({ s: { b: true } });
    expect(compactCell({}, {})).toEqual({});
  });

  it('should carry the spill fields through a style rewrite', () => {
    const anchor = compactCell(
      { v: '19', f: '=MMULT(A1:B2,C1:D2)', spillRows: 2, spillCols: 2 },
      { b: true },
    );
    expect(anchor).toEqual({
      v: '19',
      f: '=MMULT(A1:B2,C1:D2)',
      spillRows: 2,
      spillCols: 2,
      s: { b: true },
    });

    const ghost = compactCell({ v: '22', spillAnchor: 'A4' }, { b: true });
    expect(ghost).toEqual({ v: '22', spillAnchor: 'A4', s: { b: true } });

    const blocked = compactCell({ f: '=MMULT(A1:B2,C1:D2)', spillBlocked: true });
    expect(blocked).toEqual({
      f: '=MMULT(A1:B2,C1:D2)',
      spillBlocked: true,
    });
  });
});

describe('Sheet spill metadata', () => {
  it('should keep an anchor spilling after a style-only write', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 2, c: 1 }, '3');
    await sheet.setData({ r: 2, c: 2 }, '4');
    await sheet.setData({ r: 1, c: 3 }, '5');
    await sheet.setData({ r: 1, c: 4 }, '6');
    await sheet.setData({ r: 2, c: 3 }, '7');
    await sheet.setData({ r: 2, c: 4 }, '8');
    await sheet.setData({ r: 4, c: 1 }, '=MMULT(A1:B2,C1:D2)');

    const anchorBefore = await store.get({ r: 4, c: 1 });
    expect(anchorBefore?.spillRows).toBe(2);
    expect(anchorBefore?.spillCols).toBe(2);
    const ghostBefore = await store.get({ r: 4, c: 2 });
    expect(ghostBefore?.spillAnchor).toBeDefined();

    // A style-only rewrite must not detach the anchor from its ghosts.
    await sheet.setStyle({ r: 4, c: 1 }, { b: true });
    await sheet.setStyle({ r: 4, c: 2 }, { b: true });

    const anchorAfter = await store.get({ r: 4, c: 1 });
    expect(anchorAfter?.spillRows).toBe(2);
    expect(anchorAfter?.spillCols).toBe(2);
    expect(anchorAfter?.s).toEqual({ b: true });

    const ghostAfter = await store.get({ r: 4, c: 2 });
    expect(ghostAfter?.spillAnchor).toBe(ghostBefore?.spillAnchor);
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('22');

    // The ghosts still clear with the anchor, so the metadata is live and not
    // just carried along.
    await sheet.setData({ r: 4, c: 1 }, '=SUM(A1:B2)');
    expect(await sheet.toDisplayString({ r: 4, c: 2 })).toBe('');
  });
});
