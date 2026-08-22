import { describe, it, expect } from 'vitest';
import { isSafeUrl, SAFE_PROTOCOLS, seg } from '../src/url/index.ts';

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
