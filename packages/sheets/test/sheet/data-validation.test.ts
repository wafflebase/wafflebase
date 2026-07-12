import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';

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
});
