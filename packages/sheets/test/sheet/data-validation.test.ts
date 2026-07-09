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
});
