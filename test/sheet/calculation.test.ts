import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet.Calcuation', () => {
  it('should calculate cells', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { v: '10' }],
          ['B1', { f: '=A1+20' }],
          ['C1', { f: '=B1+30' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('A1')).toBe('10');
    expect(await sheet.toDisplayString('B1')).toBe('30');
    expect(await sheet.toDisplayString('C1')).toBe('60');
  });

  it('should calculate cells recursively', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { v: '10' }],
          ['B1', { f: '=A1+20' }],
          ['C1', { f: '=B1+30' }],
          ['D1', { f: '=C1+40' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('A1')).toBe('10');
    expect(await sheet.toDisplayString('B1')).toBe('30');
    expect(await sheet.toDisplayString('C1')).toBe('60');
    expect(await sheet.toDisplayString('D1')).toBe('100');

    await sheet.setData({ row: 1, col: 1 }, '5');
    expect(await sheet.toDisplayString('A1')).toBe('5');
    expect(await sheet.toDisplayString('B1')).toBe('25');
    expect(await sheet.toDisplayString('C1')).toBe('55');
    expect(await sheet.toDisplayString('D1')).toBe('95');
  });

  it('should handle circular dependencies', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { f: '=B1+10' }],
          ['B1', { f: '=A1+20' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('A1')).toBe('#REF!');
    expect(await sheet.toDisplayString('B1')).toBe('#REF!');

    await sheet.setData({ row: 1, col: 1 }, '10');
    expect(await sheet.toDisplayString('A1')).toBe('10');
    expect(await sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle lower case references', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { v: '10' }],
          ['B1', { f: '=a1+20' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('A1')).toBe('10');
    expect(await sheet.toDisplayString('B1')).toBe('30');
  });

  it('should handle string filters in references', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { v: '10' }],
          ['B1', { v: '20' }],
          ['C1', { v: 'hello' }],
          ['D1', { f: '=SUM(A1:C1)' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('A1')).toBe('10');
    expect(await sheet.toDisplayString('B1')).toBe('20');
    expect(await sheet.toDisplayString('C1')).toBe('hello');
    expect(await sheet.toDisplayString('D1')).toBe('30');
  });

  it('should handle invalid value: range without array function', async () => {
    const sheet = new Sheet(
      new MemStore(
        new Map([
          ['A1', { v: '1' }],
          ['B1', { v: '2' }],
          ['C1', { f: '=A1:B1' }],
        ]),
      ),
    );
    await sheet.recalculate();
    expect(await sheet.toDisplayString('C1')).toBe('#VALUE!');

    await sheet.setData({ row: 1, col: 4 }, '=A1:B1+A1:B1');
    expect(await sheet.toDisplayString('D1')).toBe('#VALUE!');
  });
});
