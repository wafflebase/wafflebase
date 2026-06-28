// packages/docs/test/spell/tokenize.test.ts
import { describe, it, expect } from 'vitest';
import { tokenizeWords } from '../../src/spell/tokenize.js';

const words = (t: string) => tokenizeWords(t).map((w) => w.word);

describe('tokenizeWords', () => {
  it('splits on spaces and punctuation', () => {
    expect(words('hello world, friend')).toEqual(['hello', 'world', 'friend']);
  });
  it('keeps apostrophes inside words', () => {
    expect(words("don't stop")).toEqual(["don't", 'stop']);
  });
  it('reports correct offsets', () => {
    const toks = tokenizeWords('ab cde');
    expect(toks).toEqual([
      { start: 0, end: 2, word: 'ab' },
      { start: 3, end: 6, word: 'cde' },
    ]);
  });
  it('skips pure numbers', () => {
    expect(words('there are 42 cats')).toEqual(['there', 'are', 'cats']);
  });
  it('skips URLs and emails', () => {
    expect(words('see https://a.com or me@x.io now')).toEqual(['see', 'or', 'now']);
  });
  it('skips all-caps acronyms', () => {
    expect(words('the API and HTML')).toEqual(['the', 'and']);
  });
  it('skips tokens shorter than 2 chars', () => {
    expect(words('a big I')).toEqual(['big']);
  });
  it('keeps Hangul and CJK tokens (routing decides later)', () => {
    expect(words('안녕 world 日本')).toEqual(['안녕', 'world', '日本']);
  });
});
