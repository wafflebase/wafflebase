import nspell from 'nspell';
import type { Lang, SpellChecker } from './spell-checker.js';

// nspell accepts string | Buffer for aff/dic.
type Dict = { aff: string | Buffer; dic: string | Buffer };
type NSpell = ReturnType<typeof nspell>;

/** Default loader: lazy ?raw imports keep the dictionary files out of the
 *  main bundle (Vite emits them as a separate chunk).
 *  The vendored .aff/.dic files live next to this source so the browser
 *  can fetch them — dictionary-en v4 uses node:fs/promises internally and
 *  cannot be imported in a browser environment. */
async function defaultLoadDict(): Promise<Dict> {
  const [aff, dic] = await Promise.all([
    import('./dict/en_US.aff?raw').then((m) => m.default),
    import('./dict/en_US.dic?raw').then((m) => m.default),
  ]);
  return { aff, dic };
}

/** In-process English spell checker backed by nspell + a Hunspell dict. */
export class LocalSpellProvider implements SpellChecker {
  private speller: Promise<NSpell> | null = null;

  constructor(private loadDict: () => Promise<Dict> = defaultLoadDict) {}

  supports(lang: Lang): boolean {
    return lang === 'en';
  }

  private getSpeller(): Promise<NSpell> {
    if (!this.speller) {
      this.speller = this.loadDict().then((d) => nspell(d.aff, d.dic));
    }
    return this.speller;
  }

  async check(word: string, lang: Lang): Promise<boolean> {
    if (lang !== 'en') return true; // not-checkable → treat as correct
    const s = await this.getSpeller();
    return s.correct(word);
  }

  async suggest(word: string, lang: Lang): Promise<string[]> {
    if (lang !== 'en') return [];
    const s = await this.getSpeller();
    return s.suggest(word);
  }
}
