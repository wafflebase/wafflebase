import {
  langForScript,
  scriptOf,
  type Lang,
  type SpellChecker,
} from './spell-checker.js';

/** Routes each word to a provider by its detected language/script. */
export class SpellRouter {
  constructor(private providers: SpellChecker[]) {}

  private providerFor(lang: Lang): SpellChecker | undefined {
    if (lang === 'skip') return undefined;
    return this.providers.find((p) => p.supports(lang));
  }

  async check(word: string): Promise<boolean> {
    const lang = langForScript(scriptOf(word));
    const p = this.providerFor(lang);
    if (!p) return true; // no checker → treat as correct
    return p.check(word, lang);
  }

  async suggest(word: string): Promise<string[]> {
    const lang = langForScript(scriptOf(word));
    const p = this.providerFor(lang);
    if (!p) return [];
    return p.suggest(word, lang);
  }
}
