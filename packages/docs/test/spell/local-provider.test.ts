import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { LocalSpellProvider } from '../../src/spell/local-provider.js';

// Use the vendored dictionary files so tests exercise what we actually ship.
const dictDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/spell/dict');
function loadDict() {
  return Promise.resolve({
    aff: readFileSync(join(dictDir, 'en_US.aff'), 'utf-8'),
    dic: readFileSync(join(dictDir, 'en_US.dic'), 'utf-8'),
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
