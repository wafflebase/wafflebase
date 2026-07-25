import { describe, it, expect } from 'vitest';
import { cellHyperlink } from '../url-detect';

describe('cellHyperlink', () => {
  it('detects a plain http(s) URL as a link', () => {
    expect(cellHyperlink('https://example.com')).toBe('https://example.com');
    expect(cellHyperlink('http://example.com/path?q=1')).toBe(
      'http://example.com/path?q=1',
    );
  });

  it('trims surrounding whitespace before matching', () => {
    expect(cellHyperlink('  https://example.com  ')).toBe(
      'https://example.com',
    );
  });

  it('returns null for non-URL text', () => {
    expect(cellHyperlink('hello world')).toBeNull();
    expect(cellHyperlink('example.com')).toBeNull(); // bare host, no scheme
    expect(cellHyperlink('42')).toBeNull();
  });

  it('returns null when the value contains interior whitespace', () => {
    expect(cellHyperlink('https://example.com and more')).toBeNull();
  });

  it('returns null for blank / undefined values', () => {
    expect(cellHyperlink(undefined)).toBeNull();
    expect(cellHyperlink('')).toBeNull();
    expect(cellHyperlink('   ')).toBeNull();
  });

  it('rejects unsafe protocols', () => {
    expect(cellHyperlink('javascript:alert(1)')).toBeNull();
    expect(cellHyperlink('data:text/html,<h1>x</h1>')).toBeNull();
  });
});
