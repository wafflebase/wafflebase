import { describe, it, expect } from 'vitest';
import { Sheet } from '../../src/sheet/sheet';

describe('Sheet.Calcuation', () => {
  it('should calculate cells', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');
    await sheet.setData({ r: 1, c: 3 }, '=B1+30');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('60');
  });

  it('should calculate cells recursively', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');
    await sheet.setData({ r: 1, c: 3 }, '=B1+30');
    await sheet.setData({ r: 1, c: 4 }, '=C1+40');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('60');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('100');

    await sheet.setData({ r: 1, c: 1 }, '5');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('25');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('55');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('95');
  });

  it('should handle circular dependencies', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '=B1+10');
    await sheet.setData({ r: 1, c: 2 }, '=A1+20');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('#REF!');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('#REF!');

    await sheet.setData({ r: 1, c: 1 }, '10');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('30');
  });

  it('should handle lower case references', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '=a1+30');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('40');
  });

  it('should handle string filters in references', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 1, c: 3 }, 'hello');
    await sheet.setData({ r: 1, c: 4 }, '=SUM(A1:C1)');

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('hello');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('30');
  });

  it('should handle invalid value: range without array function', async () => {
    const sheet = new Sheet();
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '2');
    await sheet.setData({ r: 1, c: 3 }, '=A1:B1');

    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('#VALUE!');

    await sheet.setData({ r: 1, c: 4 }, '=A1:B1+A1:B1');
    expect(await sheet.toDisplayString({ r: 1, c: 4 })).toBe('#VALUE!');
  });
});
