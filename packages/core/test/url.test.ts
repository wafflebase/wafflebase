import { describe, it, expect } from 'vitest';
import { isSafeUrl, SAFE_PROTOCOLS } from '../src/url/index.ts';

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
