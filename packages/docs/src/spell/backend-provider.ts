import type { Lang, SpellChecker } from './spell-checker.js';

interface BackendOpts {
  endpoint: string;
  langs?: Lang[];
  fetchImpl?: typeof fetch;
}

/** Spell checker that delegates to a backend service. Fails open on error
 *  (a network problem must never paint false squiggles). Server-side
 *  dictionary (e.g. Korean) is deferred; this class is the wired contract. */
export class BackendSpellProvider implements SpellChecker {
  private langs: Lang[];
  private fetchImpl: typeof fetch;

  constructor(private opts: BackendOpts) {
    this.langs = opts.langs ?? ['ko'];
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  supports(lang: Lang): boolean {
    return this.langs.includes(lang);
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await this.fetchImpl(`${this.opts.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async check(word: string, lang: Lang): Promise<boolean> {
    const r = await this.post<{ correct: boolean }>('/check', { word, lang });
    return r ? r.correct : true; // fail open
  }

  async suggest(word: string, lang: Lang): Promise<string[]> {
    const r = await this.post<{ suggestions: string[] }>('/suggest', { word, lang });
    return r?.suggestions ?? [];
  }
}
