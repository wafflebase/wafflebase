import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet', () => {
  it('should correctly set and get data', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '20');
    sheet.setData({ row: 1, col: 3 }, '30');

    expect(sheet.toInputString({ row: 1, col: 1 })).toBe('10');
    expect(sheet.toInputString({ row: 1, col: 2 })).toBe('20');
    expect(sheet.toInputString({ row: 1, col: 3 })).toBe('30');
  });

  it('should update selection', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.setSelection({ row: 2, col: 2 });
    expect(sheet.getSelection()).toEqual({ row: 2, col: 2 });
  });

  it('should move selection', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });

    sheet.moveSelection(1, 0);
    expect(sheet.getSelection()).toEqual({ row: 2, col: 1 });

    sheet.moveSelection(0, 1);
    expect(sheet.getSelection()).toEqual({ row: 2, col: 2 });

    sheet.moveSelection(-1, 0);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 2 });

    sheet.moveSelection(0, -1);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });
  });

  it('should not move selection beyond sheet dimensions', () => {
    const sheet = new Sheet();
    sheet.setSelection({ row: 1, col: 1 });

    sheet.moveSelection(-1, 0);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.moveSelection(0, -1);
    expect(sheet.getSelection()).toEqual({ row: 1, col: 1 });

    sheet.moveSelection(101, 0);
    expect(sheet.getSelection()).toEqual({ row: 100, col: 1 });

    sheet.moveSelection(0, 27);
    expect(sheet.getSelection()).toEqual({ row: 100, col: 26 });
  });
});

describe('Sheet.Calcuation', () => {
  it('should calculate cells', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '=A1+20');
    sheet.setData({ row: 1, col: 3 }, '=B1+30');
    expect(sheet.toDisplayString({ row: 1, col: 1 })).toBe('10');
    expect(sheet.toDisplayString({ row: 1, col: 2 })).toBe('30');
    expect(sheet.toDisplayString({ row: 1, col: 3 })).toBe('60');
  });

  it('should calculate cells recursively', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '=A1+20');
    sheet.setData({ row: 1, col: 3 }, '=B1+30');
    sheet.setData({ row: 1, col: 4 }, '=C1+40');
    expect(sheet.toDisplayString({ row: 1, col: 1 })).toBe('10');
    expect(sheet.toDisplayString({ row: 1, col: 2 })).toBe('30');
    expect(sheet.toDisplayString({ row: 1, col: 3 })).toBe('60');
    expect(sheet.toDisplayString({ row: 1, col: 4 })).toBe('100');

    sheet.setData({ row: 1, col: 1 }, '5');
    expect(sheet.toDisplayString({ row: 1, col: 1 })).toBe('5');
    expect(sheet.toDisplayString({ row: 1, col: 2 })).toBe('25');
    expect(sheet.toDisplayString({ row: 1, col: 3 })).toBe('55');
    expect(sheet.toDisplayString({ row: 1, col: 4 })).toBe('95');
  });

  it('should handle circular dependencies', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '=B1+20');
    sheet.setData({ row: 1, col: 2 }, '=A1+30');
    // TODO(hackerwins): Propergate circular dependencies.
    // expect(sheet.toDisplayString({ row: 1, col: 1 })).toBe('#REF!');
    expect(sheet.toDisplayString({ row: 1, col: 2 })).toBe('#REF!');
  });
});
