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

  it('skips Hangul word as a unit', () => {
    expect(findNextWordBoundary('안녕하세요 반갑습니다', 0)).toBe(6);
    expect(findNextWordBoundary('안녕하세요 반갑습니다', 6)).toBe(11);
  });

  it('handles mixed Hangul and latin without space as one word', () => {
    expect(findNextWordBoundary('hello안녕', 0)).toBe(7);
  });

  it('handles mixed Hangul and latin with space', () => {
    expect(findNextWordBoundary('hello 안녕', 0)).toBe(6);
    expect(findNextWordBoundary('hello 안녕', 6)).toBe(8);
  });

  it('handles CJK ideographs individually', () => {
    expect(findNextWordBoundary('漢字テスト', 0)).toBe(1);
    expect(findNextWordBoundary('漢字テスト', 1)).toBe(2);
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

  it('skips Hangul word as a unit', () => {
    expect(findPrevWordBoundary('안녕하세요 반갑습니다', 11)).toBe(6);
    expect(findPrevWordBoundary('안녕하세요 반갑습니다', 6)).toBe(0);
  });

  it('handles CJK ideographs individually', () => {
    expect(findPrevWordBoundary('漢字テスト', 5)).toBe(4);
    expect(findPrevWordBoundary('漢字テスト', 2)).toBe(1);
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

  it('selects Hangul word', () => {
    expect(getWordRange('안녕 세계', 0)).toEqual([0, 2]);
    expect(getWordRange('안녕 세계', 1)).toEqual([0, 2]);
    expect(getWordRange('안녕 세계', 3)).toEqual([3, 5]);
  });

  it('selects single CJK ideograph', () => {
    expect(getWordRange('漢字', 0)).toEqual([0, 1]);
    expect(getWordRange('漢字', 1)).toEqual([1, 2]);
  });

  it('handles empty text', () => {
    expect(getWordRange('', 0)).toEqual([0, 0]);
  });

  it('treats accented letters as word characters', () => {
    expect(getWordRange('café latte', 2)).toEqual([0, 4]);
  });

  it('treats Cyrillic as word characters', () => {
    expect(getWordRange('Привет мир', 3)).toEqual([0, 6]);
  });
});
