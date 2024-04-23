import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet.Calcuation', () => {
  it('should calculate cells', () => {
    const sheet = new Sheet(
      new Map([
        ['A1', { v: '10' }],
        ['B1', { f: '=A1+20' }],
        ['C1', { f: '=B1+30' }],
      ]),
    );
    sheet.recalculate();
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
    expect(sheet.toDisplayString('C1')).toBe('60');
  });

  it('should calculate cells recursively', () => {
    const sheet = new Sheet(
      new Map([
        ['A1', { v: '10' }],
        ['B1', { f: '=A1+20' }],
        ['C1', { f: '=B1+30' }],
        ['D1', { f: '=C1+40' }],
      ]),
    );
    sheet.recalculate();
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
    const sheet = new Sheet(
      new Map([
        ['A1', { f: '=B1+10' }],
        ['B1', { f: '=A1+20' }],
      ]),
    );
    sheet.recalculate();
    expect(sheet.toDisplayString('A1')).toBe('#REF!');
    expect(sheet.toDisplayString('B1')).toBe('#REF!');

    sheet.setData({ row: 1, col: 1 }, '10');
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle lower case references', () => {
    const sheet = new Sheet(
      new Map([
        ['A1', { v: '10' }],
        ['B1', { f: '=a1+20' }],
      ]),
    );
    sheet.recalculate();
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle string filters in references', () => {
    const sheet = new Sheet(
      new Map([
        ['A1', { v: '10' }],
        ['B1', { v: '20' }],
        ['C1', { v: 'hello' }],
        ['D1', { f: '=SUM(A1:C1)' }],
      ]),
    );
    sheet.recalculate();
    expect(sheet.toDisplayString('A1')).toBe('10');
    expect(sheet.toDisplayString('B1')).toBe('20');
    expect(sheet.toDisplayString('C1')).toBe('hello');
    expect(sheet.toDisplayString('D1')).toBe('30');
  });

  it('should handle invalid value: range without array function', () => {
    const sheet = new Sheet(
      new Map([
        ['A1', { v: '1' }],
        ['B1', { v: '2' }],
        ['C1', { f: '=A1:B1' }],
      ]),
    );
    sheet.recalculate();
    expect(sheet.toDisplayString('C1')).toBe('#VALUE!');

    sheet.setData({ row: 1, col: 4 }, '=A1:B1+A1:B1');
    expect(sheet.toDisplayString('D1')).toBe('#VALUE!');
  });
});
