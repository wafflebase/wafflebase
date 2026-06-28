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

  // Regression: PRESCAN_RE must not swallow a real word that follows
  // an email/URL when separated only by a comma or semicolon.
  it('does not suppress a word following an email+comma', () => {
    const ws = words('email me@x.io,nextword now');
    expect(ws).toContain('nextword');
    expect(ws).toContain('now');
    expect(ws).toContain('email');
    // Constituents of me@x.io must remain suppressed
    expect(ws).not.toContain('io');
    expect(ws).not.toContain('me');
  });

  it('does not suppress words following a URL+comma', () => {
    const ws = words('visit https://a.com, then leave');
    expect(ws).toContain('visit');
    expect(ws).toContain('then');
    expect(ws).toContain('leave');
  });

  it('does not emit URL fragments from a trailing-period URL', () => {
    const ws = words('go to https://a.com.');
    expect(ws).toContain('go');
    expect(ws).toContain('to');
    expect(ws).not.toContain('com');
  });
});
