import { describe, it, expect } from 'vitest';
import {
  hasUrlAlteringChars,
  isSafeUrl,
  SAFE_PROTOCOLS,
  seg,
} from '../src/url/index.ts';

describe('isSafeUrl', () => {
  it('accepts http/https/mailto/tel', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeUrl('tel:+15551234567')).toBe(true);
  });

  it('rejects unsafe protocols', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/plain,x')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects invalid or relative URLs', () => {
    expect(isSafeUrl('not a url')).toBe(false);
    expect(isSafeUrl('example.com')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
  });

  it('exposes the protocol allowlist', () => {
    expect(SAFE_PROTOCOLS).toContain('https:');
    expect(SAFE_PROTOCOLS).not.toContain('javascript:');
  });
});

describe('hasUrlAlteringChars', () => {
  // The characters the WHATWG parser rewrites before it reads the scheme.
  // A gate that validates the parsed form and emits the raw string is
  // judging a different string than the one it ships.
  it('flags what the URL parser deletes or trims', () => {
    expect(hasUrlAlteringChars('https://example.com/a\tb')).toBe(true);
    expect(hasUrlAlteringChars('https://example.com/a\nb')).toBe(true);
    expect(hasUrlAlteringChars('https://example.com/a\rb')).toBe(true);
    expect(hasUrlAlteringChars('  https://example.com')).toBe(true);
    expect(hasUrlAlteringChars('https://example.com  ')).toBe(true);
    // A space is not deleted by the parser, but it is what ends a
    // CommonMark link destination — the second reason this class exists.
    expect(hasUrlAlteringChars('https://example.com/a b')).toBe(true);
    // C1, which the ranges cover beyond the ASCII controls.
    expect(hasUrlAlteringChars('https://example.com/\u0085b')).toBe(true);
  });

  it('leaves ordinary URLs alone, delimiters included', () => {
    expect(hasUrlAlteringChars('https://example.com/a')).toBe(false);
    // `(`, `)` and `" + B + B + "` are an emitter-syntax problem, not a parser one:
    // they are escaped on the way out, not refused.
    expect(hasUrlAlteringChars('https://example.com/a)b')).toBe(false);
    expect(hasUrlAlteringChars('https://example.com/a(b')).toBe(false);
    expect(hasUrlAlteringChars('https://example.com/a\\b')).toBe(false);
    expect(hasUrlAlteringChars('https://example.com/\uD55C\uAE00')).toBe(false);
    expect(hasUrlAlteringChars('')).toBe(false);
  });
});

describe('seg', () => {
  it('pins an id to the segment it was meant to fill', () => {
    expect(seg('doc-1')).toBe('doc-1');
    expect(seg('../../auth/logout')).toBe('..%2F..%2Fauth%2Flogout');
    expect(seg('a b/c#d?e%f')).toBe('a%20b%2Fc%23d%3Fe%25f');
  });

  it('refuses the two segments encoding cannot neutralize', () => {
    // `encodeURIComponent('..') === '..'`, and the URL parser resolves a dot
    // segment however it is spelled — so these are refused, not sent.
    expect(() => seg('.')).toThrow(/Invalid path segment/);
    expect(() => seg('..')).toThrow(/Invalid path segment/);
  });
});
