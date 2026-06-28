import nspell from 'nspell';
import type { Lang, SpellChecker } from './spell-checker.js';

// dictionary-en returns Uint8Array; at runtime in Node these are Buffers,
// but the @types/nspell Dictionary type only lists Buffer|string.
type Dict = { aff: Uint8Array | Buffer; dic: Uint8Array | Buffer };
type NSpell = ReturnType<typeof nspell>;

/** Default loader: lazy dynamic import keeps the dictionary out of the
 *  main bundle (Vite emits it as a separate chunk).
 *  dictionary-en v4 exports the dict object directly as default. */
async function defaultLoadDict(): Promise<Dict> {
  const mod = await import('dictionary-en');
  return mod.default;
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
      // Cast to Buffer: at runtime Node's fs returns Buffer (extends Uint8Array).
      this.speller = this.loadDict().then((d) =>
        nspell(d.aff as Buffer, d.dic as Buffer),
      );
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
