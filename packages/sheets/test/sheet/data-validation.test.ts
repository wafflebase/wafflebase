import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';
import { Ref } from '../../src/model/core/types';

describe('Sheet data validation', () => {
  it('inserts a checkbox rule over a range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 3, c: 1 },
      ],
      'dv-1',
    );
    const rules = sheet.getDataValidations();
    expect(rules).toHaveLength(1);
    expect(rules[0].kind).toBe('checkbox');
    expect(rules[0].id).toBe('dv-1');
  });

  it('resolves the rule applying to a cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 3, c: 1 },
      ],
      'dv-1',
    );
    expect(sheet.getDataValidationAt({ r: 2, c: 1 })?.id).toBe('dv-1');
    expect(sheet.getDataValidationAt({ r: 9, c: 9 })).toBeUndefined();
  });

  it('toggles a checkbox cell TRUE/FALSE and no-ops off-rule', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      'dv-1',
    );
    // empty cell renders unchecked; first toggle → TRUE
    expect(await sheet.toggleCheckboxAt({ r: 1, c: 1 })).toBe(true);
    expect((await sheet.getCell({ r: 1, c: 1 }))?.v).toBe('TRUE');
    // second toggle → FALSE
    expect(await sheet.toggleCheckboxAt({ r: 1, c: 1 })).toBe(true);
    expect((await sheet.getCell({ r: 1, c: 1 }))?.v).toBe('FALSE');
    // off-rule cell → no toggle
    expect(await sheet.toggleCheckboxAt({ r: 9, c: 9 })).toBe(false);
  });

  it('does not toggle (or overwrite) a formula cell under a checkbox rule', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      'dv-1',
    );
    // A formula drives the checkbox state; the control is read-only (GS parity).
    await sheet.setData({ r: 1, c: 1 }, '=1=1'); // → TRUE
    expect((await sheet.getCell({ r: 1, c: 1 }))?.f).toBe('=1=1');

    // Toggle is a no-op: reports false, keeps the formula, writes no literal.
    expect(await sheet.toggleCheckboxAt({ r: 1, c: 1 })).toBe(false);
    const cell = await sheet.getCell({ r: 1, c: 1 });
    expect(cell?.f).toBe('=1=1');
  });

  it('removes checkbox rules intersecting a range but keeps cell values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 3, c: 1 },
      ],
      'dv-1',
    );
    await sheet.toggleCheckboxAt({ r: 1, c: 1 }); // A1 → TRUE
    expect(sheet.getDataValidations()).toHaveLength(1);

    // removing over any intersecting cell strips the whole rule...
    await sheet.removeCheckbox([
      { r: 2, c: 1 },
      { r: 2, c: 1 },
    ]);
    expect(sheet.getDataValidations()).toHaveLength(0);
    expect(sheet.getDataValidationAt({ r: 1, c: 1 })).toBeUndefined();

    // ...but the underlying value survives (control removed, value revealed).
    expect((await sheet.getCell({ r: 1, c: 1 }))?.v).toBe('TRUE');
  });

  it('removeCheckbox is a no-op when nothing intersects', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      'dv-1',
    );
    await sheet.removeCheckbox([
      { r: 9, c: 9 },
      { r: 9, c: 9 },
    ]);
    expect(sheet.getDataValidations()).toHaveLength(1);
  });

  const col = (): [Ref, Ref] => [
    { r: 1, c: 1 },
    { r: 3, c: 1 },
  ];
  const values = async (sheet: Sheet) =>
    Promise.all(
      [1, 2, 3].map(async (r) => (await sheet.getCell({ r, c: 1 }))?.v),
    );

  it('range Space checks all when none/mixed and unchecks when all checked', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(col(), 'dv-1');

    // none checked → all checked
    expect(await sheet.toggleCheckboxesInRange(col())).toBe(true);
    expect(await values(sheet)).toEqual(['TRUE', 'TRUE', 'TRUE']);

    // all checked → all unchecked
    expect(await sheet.toggleCheckboxesInRange(col())).toBe(true);
    expect(await values(sheet)).toEqual(['FALSE', 'FALSE', 'FALSE']);

    // mixed → all checked
    await sheet.setData({ r: 2, c: 1 }, 'TRUE');
    expect(await values(sheet)).toEqual(['FALSE', 'TRUE', 'FALSE']);
    expect(await sheet.toggleCheckboxesInRange(col())).toBe(true);
    expect(await values(sheet)).toEqual(['TRUE', 'TRUE', 'TRUE']);
  });

  it('range Space skips formula cells and non-checkbox cells', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 2, c: 1 },
      ],
      'dv-1',
    );
    // A2 holds a formula (read-only checkbox); B-column has no rule.
    await sheet.setData({ r: 2, c: 1 }, '=1=1'); // formula → TRUE
    await sheet.setData({ r: 1, c: 2 }, 'plain');

    // Range spans A1:B2 — only A1 is a togglable checkbox cell.
    const changed = await sheet.toggleCheckboxesInRange([
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);
    expect(changed).toBe(true);
    expect((await sheet.getCell({ r: 1, c: 1 }))?.v).toBe('TRUE'); // toggled
    expect((await sheet.getCell({ r: 2, c: 1 }))?.f).toBe('=1=1'); // formula intact
    expect((await sheet.getCell({ r: 1, c: 2 }))?.v).toBe('plain'); // untouched
  });

  it('range Space over cells with no checkbox rule is a no-op', async () => {
    const sheet = new Sheet(new MemStore());
    expect(
      await sheet.toggleCheckboxesInRange([
        { r: 1, c: 1 },
        { r: 3, c: 3 },
      ]),
    ).toBe(false);
  });

  it('range Space bails (no-op) over a checkbox rule larger than the cap', async () => {
    const sheet = new Sheet(new MemStore());
    // 60k-row checkbox rule exceeds MaxCheckboxToggleCells (50k) → must not
    // freeze; it bails to a no-op rather than scanning every cell.
    await sheet.insertCheckbox(
      [
        { r: 1, c: 1 },
        { r: 60000, c: 1 },
      ],
      'dv-big',
    );
    expect(
      await sheet.toggleCheckboxesInRange([
        { r: 1, c: 1 },
        { r: 60000, c: 1 },
      ]),
    ).toBe(false);
    expect((await sheet.getCell({ r: 1, c: 1 }))?.v).toBeUndefined();
  });

  it('range Space skips spill-ghost cells (read-only array output)', async () => {
    const sheet = new Sheet(new MemStore());
    // 2x2 identity-ish matrix; MINVERSE spills into A4:B5.
    await sheet.setData({ r: 1, c: 1 }, '2');
    await sheet.setData({ r: 1, c: 2 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 2 }, '1');
    await sheet.setData({ r: 4, c: 1 }, '=MINVERSE(A1:B2)'); // spills A4:B5
    // Checkbox rule laid over the spill region.
    await sheet.insertCheckbox(
      [
        { r: 4, c: 1 },
        { r: 5, c: 2 },
      ],
      'dv-spill',
    );

    // Anchor is a formula, ghosts carry spillAnchor → all read-only, no-op.
    expect(
      await sheet.toggleCheckboxesInRange([
        { r: 4, c: 1 },
        { r: 5, c: 2 },
      ]),
    ).toBe(false);
    // Spilled array output is intact (not overwritten with TRUE/FALSE).
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 5, c: 2 })).toBe('2');
  });

  it('getMergeRangeForRef resolves a covered cell to its merged range', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    await sheet.mergeSelection(); // merge A1:B2

    // A covered (non-anchor) cell resolves to the full merged range.
    const range = sheet.getMergeRangeForRef({ r: 2, c: 2 });
    expect(range).toEqual([
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ]);
    // A non-merged cell has no merged range.
    expect(sheet.getMergeRangeForRef({ r: 9, c: 9 })).toBeUndefined();
  });

  it('range Space recomputes a formula that depends on a toggled checkbox', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.insertCheckbox(col(), 'dv-1');
    await sheet.setData({ r: 1, c: 2 }, '=IF(A1, 10, 0)'); // B1 depends on A1

    await sheet.toggleCheckboxesInRange(col()); // A1 → TRUE
    expect((await sheet.getCell({ r: 1, c: 2 }))?.v).toBe('10');

    await sheet.toggleCheckboxesInRange(col()); // A1 → FALSE
    expect((await sheet.getCell({ r: 1, c: 2 }))?.v).toBe('0');
  });
});
