import { describe, it, expect } from 'vitest';
import { detectUrlBeforeCursor } from '../../src/view/url-detect.js';

describe('URL auto-detection', () => {
  it('should detect https URL before space', () => {
    const text = 'visit https://example.com ';
    // cursor is at position 25 (just before the trailing space)
    const match = detectUrlBeforeCursor(text, 25);
    expect(match).toEqual({ start: 6, end: 25, url: 'https://example.com' });
  });

  it('should detect http URL', () => {
    const text = 'go to http://test.org ';
    const match = detectUrlBeforeCursor(text, 21);
    expect(match).toEqual({ start: 6, end: 21, url: 'http://test.org' });
  });

  it('should return null for non-URL text', () => {
    const text = 'hello world ';
    expect(detectUrlBeforeCursor(text, 11)).toBeNull();
  });

  it('should detect URL at start of text', () => {
    const text = 'https://example.com ';
    const match = detectUrlBeforeCursor(text, 19);
    expect(match).toEqual({ start: 0, end: 19, url: 'https://example.com' });
  });

  it('should detect URL with path and query', () => {
    const text = 'see https://example.com/path?q=1&r=2 ';
    const match = detectUrlBeforeCursor(text, 36);
    expect(match).toEqual({
      start: 4,
      end: 36,
      url: 'https://example.com/path?q=1&r=2',
    });
  });

  it('should return null when cursor is at start', () => {
    expect(detectUrlBeforeCursor('hello', 0)).toBeNull();
  });

  it('should detect URL after newline', () => {
    const text = 'first line\nhttps://example.com ';
    const match = detectUrlBeforeCursor(text, 30);
    expect(match).toEqual({ start: 11, end: 30, url: 'https://example.com' });
  });
});
