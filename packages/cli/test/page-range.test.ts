import { describe, it, expect } from 'vitest';
import { parsePageRange } from '../src/docs/page-range.js';

describe('parsePageRange', () => {
  it('parses a single page', () => {
    const r = parsePageRange('2', 5);
    expect([...r.pages]).toEqual([2]);
    expect(r.warnings).toEqual([]);
  });

  it('parses a simple range', () => {
    const r = parsePageRange('1-3', 5);
    expect([...r.pages]).toEqual([1, 2, 3]);
    expect(r.warnings).toEqual([]);
  });

  it('parses a comma-mixed list', () => {
    const r = parsePageRange('1,3,5', 5);
    expect([...r.pages]).toEqual([1, 3, 5]);
    expect(r.warnings).toEqual([]);
  });

  it('parses a multi-token range with overlaps deduped', () => {
    const r = parsePageRange('1-3,2-5', 10);
    expect([...r.pages].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(r.warnings).toEqual([]);
  });

  it('parses 1-3,5,7-9 with multiple kinds in one input', () => {
    const r = parsePageRange('1-3,5,7-9', 10);
    expect([...r.pages].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 7, 8, 9]);
    expect(r.warnings).toEqual([]);
  });

  it('clamps an upper bound past totalPages with a warning', () => {
    const r = parsePageRange('1-99', 3);
    expect([...r.pages]).toEqual([1, 2, 3]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/clamped to 1-3/);
  });

  it('drops a single page past the end with a warning', () => {
    const r = parsePageRange('5', 3);
    expect([...r.pages]).toEqual([]);
    expect(r.warnings[0]).toMatch(/Page 5/);
  });

  it('drops a fully out-of-range range with a warning', () => {
    const r = parsePageRange('10-20', 3);
    expect([...r.pages]).toEqual([]);
    expect(r.warnings[0]).toMatch(/beyond document end/);
  });

  it('throws on a 0 page (1-based)', () => {
    expect(() => parsePageRange('0', 5)).toThrow(/1-based/);
  });

  it('throws on a reversed range', () => {
    expect(() => parsePageRange('3-1', 5)).toThrow(/Reversed range/);
  });

  it('throws on non-numeric tokens', () => {
    expect(() => parsePageRange('abc', 5)).toThrow(/Invalid page token/);
    expect(() => parsePageRange('1-2,foo', 5)).toThrow(/Invalid page token/);
  });

  it('throws on empty input', () => {
    expect(() => parsePageRange('', 5)).toThrow(/empty/i);
    expect(() => parsePageRange('   ', 5)).toThrow(/empty/i);
  });

  it('throws on an empty token (trailing comma)', () => {
    expect(() => parsePageRange('1,,3', 5)).toThrow(/Empty token/);
  });

  it('returns empty set with warning when document has no pages', () => {
    const r = parsePageRange('1-3', 0);
    expect([...r.pages]).toEqual([]);
    expect(r.warnings[0]).toMatch(/no pages/);
  });
});
