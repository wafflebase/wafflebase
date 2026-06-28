import { describe, it, expect } from 'vitest';
import { SpellRouter } from '../../src/spell/router.js';
import type { Lang, SpellChecker } from '../../src/spell/spell-checker.js';

class FakeEn implements SpellChecker {
  supports(l: Lang) { return l === 'en'; }
  async check(w: string) { return w === 'good'; }
  async suggest() { return ['good']; }
}

describe('SpellRouter', () => {
  it('routes latin words to the en provider', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('good')).toBe(true);
    expect(await r.check('baad')).toBe(false);
    expect(await r.suggest('baad')).toEqual(['good']);
  });
  it('leaves hangul un-flagged when no ko provider exists', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('안녕')).toBe(true);
    expect(await r.suggest('안녕')).toEqual([]);
  });
  it('skips CJK words', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('日本')).toBe(true);
  });
});
