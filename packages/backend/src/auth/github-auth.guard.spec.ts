import { parseCliNonce } from './github-auth.guard';

describe('parseCliNonce', () => {
  it('accepts a hex nonce of a sane length', () => {
    const nonce = 'a1b2c3d4'.repeat(8); // 64 chars
    expect(parseCliNonce(nonce)).toBe(nonce);
    expect(parseCliNonce('f'.repeat(32))).toBe('f'.repeat(32));
  });

  it('rejects anything that could smuggle a query param into the redirect', () => {
    expect(parseCliNonce('f'.repeat(32) + '&code=evil')).toBeUndefined();
    expect(parseCliNonce('../callback')).toBeUndefined();
    expect(parseCliNonce('F'.repeat(32))).toBeUndefined(); // uppercase
    expect(parseCliNonce('f'.repeat(31))).toBeUndefined(); // too short
    expect(parseCliNonce('f'.repeat(129))).toBeUndefined(); // too long
  });

  it('rejects non-string input', () => {
    expect(parseCliNonce(undefined)).toBeUndefined();
    expect(parseCliNonce(['f'.repeat(32)])).toBeUndefined();
    expect(parseCliNonce(42)).toBeUndefined();
  });
});
