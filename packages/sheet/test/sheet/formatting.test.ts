import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/sheet';

describe('Sheet.Formatting', () => {
  it('should get undefined style for empty cell', async () => {
    const sheet = new Sheet(new MemStore());
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should set and get style', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true, tc: '#ff0000' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true, tc: '#ff0000' });
  });

  it('should merge styles', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setStyle({ r: 1, c: 1 }, { i: true });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true, i: true });
  });

  it('should remove falsy style properties', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true, i: true });
    await sheet.setStyle({ r: 1, c: 1 }, { b: false });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ i: true });
  });

  it('should remove style object when all properties are falsy', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setStyle({ r: 1, c: 1 }, { b: false });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should preserve style when setting data', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    await sheet.setData({ r: 1, c: 1 }, 'hello');
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ b: true });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('hello');
  });

  it('should toggle boolean style property', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.toggleRangeStyle('b');
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });

    await sheet.toggleRangeStyle('b');
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toBeUndefined();
  });

  it('should apply style to range', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    await sheet.setRangeStyle({ b: true, tc: '#0000ff' });

    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 1, c: 2 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
    expect(await sheet.getStyle({ r: 2, c: 2 })).toEqual({
      b: true,
      tc: '#0000ff',
    });
  });

  it('should apply number format in display string', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1234.5');
    await sheet.setStyle({ r: 1, c: 1 }, { nf: 'currency' });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('$1,234.50');
  });

  it('should create cell when setting style on empty cell', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 5, c: 5 }, { bg: '#ff0000' });
    const style = await sheet.getStyle({ r: 5, c: 5 });
    expect(style).toEqual({ bg: '#ff0000' });
  });

  it('should set style with existing cell value', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '100');
    await sheet.setStyle({ r: 1, c: 1 }, { b: true });
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('100');
    expect(await sheet.getStyle({ r: 1, c: 1 })).toEqual({ b: true });
  });

  it('should set vertical alignment', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { va: 'middle' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ va: 'middle' });
  });

  it('should set horizontal and vertical alignment together', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setStyle({ r: 1, c: 1 }, { al: 'center', va: 'bottom' });
    const style = await sheet.getStyle({ r: 1, c: 1 });
    expect(style).toEqual({ al: 'center', va: 'bottom' });
  });
});
