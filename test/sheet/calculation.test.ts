import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet.Calcuation', () => {
  it('should calculate cells', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '=A1+20');
    sheet.setData({ row: 1, col: 3 }, '=B1+30');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
    expect(sheet.toDisplayString('C1')).toBe('60');
  });

  it('should calculate cells recursively', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '=A1+20');
    sheet.setData({ row: 1, col: 3 }, '=B1+30');
    sheet.setData({ row: 1, col: 4 }, '=C1+40');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
    expect(sheet.toDisplayString('C1')).toBe('60');
    expect(sheet.toDisplayString('D1')).toBe('100');

    sheet.setData({ row: 1, col: 1 }, '5');
    expect(sheet.toDisplayString('A1')).toBe('5');
    expect(sheet.toDisplayString('B1')).toBe('25');
    expect(sheet.toDisplayString('C1')).toBe('55');
    expect(sheet.toDisplayString('D1')).toBe('95');
  });

  it('should handle circular dependencies', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '=B1+10');
    sheet.setData({ row: 1, col: 2 }, '=A1+20');
    expect(sheet.toDisplayString('A1')).toBe('#REF!');
    expect(sheet.toDisplayString('B1')).toBe('#REF!');

    sheet.setData({ row: 1, col: 1 }, '10');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle lower case references', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '=a1+20');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle string filters in references', () => {
    const sheet = new Sheet();
    sheet.setData({ row: 1, col: 1 }, '10');
    sheet.setData({ row: 1, col: 2 }, '20');
    sheet.setData({ row: 1, col: 3 }, 'hello');
    sheet.setData({ row: 1, col: 4 }, '=SUM(A1:C1)');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('20');
    expect(sheet.toDisplayString('C1')).toBe('hello');
    expect(sheet.toDisplayString('D1')).toBe('30');
  });
});
