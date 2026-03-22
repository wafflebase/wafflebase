import { describe, it, expect } from 'vitest';
import {
  findNextWordBoundary,
  findPrevWordBoundary,
  getWordRange,
} from '../../src/view/word-boundary.js';

describe('findNextWordBoundary', () => {
  it('skips a word and trailing space', () => {
    expect(findNextWordBoundary('hello world', 0)).toBe(6);
  });

  it('moves from mid-word to next word', () => {
    expect(findNextWordBoundary('hello world', 2)).toBe(6);
  });

  it('skips leading whitespace to next word', () => {
    expect(findNextWordBoundary('hello world', 5)).toBe(6);
  });

  it('reaches end of text', () => {
    expect(findNextWordBoundary('hello', 0)).toBe(5);
  });

  it('stays at end', () => {
    expect(findNextWordBoundary('hello', 5)).toBe(5);
  });

  it('handles punctuation as separate boundary', () => {
    expect(findNextWordBoundary('foo.bar', 0)).toBe(3);
    expect(findNextWordBoundary('foo.bar', 3)).toBe(4);
    expect(findNextWordBoundary('foo.bar', 4)).toBe(7);
  });

  it('handles CJK characters individually', () => {
    expect(findNextWordBoundary('한글테스트', 0)).toBe(1);
    expect(findNextWordBoundary('한글테스트', 1)).toBe(2);
  });

  it('handles mixed CJK and latin', () => {
    expect(findNextWordBoundary('hello한글', 0)).toBe(5);
    expect(findNextWordBoundary('hello한글', 5)).toBe(6);
  });

  it('handles multiple spaces', () => {
    expect(findNextWordBoundary('a   b', 1)).toBe(4);
  });
});

describe('findPrevWordBoundary', () => {
  it('skips back over a word', () => {
    expect(findPrevWordBoundary('hello world', 11)).toBe(6);
  });

  it('skips whitespace then word', () => {
    expect(findPrevWordBoundary('hello world', 6)).toBe(0);
  });

  it('moves from mid-word to word start', () => {
    expect(findPrevWordBoundary('hello world', 8)).toBe(6);
  });

  it('stays at start', () => {
    expect(findPrevWordBoundary('hello', 0)).toBe(0);
  });

  it('handles punctuation', () => {
    expect(findPrevWordBoundary('foo.bar', 7)).toBe(4);
    expect(findPrevWordBoundary('foo.bar', 4)).toBe(3);
    expect(findPrevWordBoundary('foo.bar', 3)).toBe(0);
  });

  it('handles CJK characters individually', () => {
    expect(findPrevWordBoundary('한글테스트', 5)).toBe(4);
    expect(findPrevWordBoundary('한글테스트', 2)).toBe(1);
  });

  it('handles multiple spaces', () => {
    expect(findPrevWordBoundary('a   b', 4)).toBe(0);
  });
});

describe('getWordRange', () => {
  it('selects a word', () => {
    expect(getWordRange('hello world', 0)).toEqual([0, 5]);
    expect(getWordRange('hello world', 3)).toEqual([0, 5]);
    expect(getWordRange('hello world', 6)).toEqual([6, 11]);
  });

  it('selects whitespace run', () => {
    expect(getWordRange('hello  world', 5)).toEqual([5, 7]);
  });

  it('selects punctuation run', () => {
    expect(getWordRange('a...b', 2)).toEqual([1, 4]);
  });

  it('selects single CJK character', () => {
    expect(getWordRange('한글', 0)).toEqual([0, 1]);
    expect(getWordRange('한글', 1)).toEqual([1, 2]);
  });

  it('handles empty text', () => {
    expect(getWordRange('', 0)).toEqual([0, 0]);
  });
});
