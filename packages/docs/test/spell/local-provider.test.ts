import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LocalSpellProvider } from '../../src/spell/local-provider.js';

// Resolve the dictionary-en data files directly for the Node test.
// dictionary-en v4 ships index.aff and index.dic alongside index.js.
const require = createRequire(import.meta.url);
function loadDict() {
  const dir = require.resolve('dictionary-en').replace(/index\.[a-z]+$/, '');
  return Promise.resolve({
    aff: readFileSync(dir + 'index.aff'),
    dic: readFileSync(dir + 'index.dic'),
  });
}

describe('LocalSpellProvider', () => {
  it('supports only en', () => {
    const p = new LocalSpellProvider(loadDict);
    expect(p.supports('en')).toBe(true);
    expect(p.supports('ko')).toBe(false);
  });
  it('accepts correctly spelled words', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('hello', 'en')).toBe(true);
  });
  it('flags misspellings and suggests corrections', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('helllo', 'en')).toBe(false);
    const s = await p.suggest('helllo', 'en');
    expect(s).toContain('hello');
  });
  it('returns true (not-checkable) for non-en langs', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('안녕', 'ko')).toBe(true);
  });
});
