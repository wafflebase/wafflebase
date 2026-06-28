/** Language tag a provider handles. 'skip' means "do not check". */
export type Lang = 'en' | 'ko' | 'skip';

/** Writing system of a word, used to route to a provider. */
export type Script = 'latin' | 'hangul' | 'cjk' | 'other';

function classifyCode(code: number): Script {
  // Hangul syllables + Jamo
  if (
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f)
  ) {
    return 'hangul';
  }
  // Han + Kana + fullwidth
  if (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return 'cjk';
  }
  // Latin: Basic Latin letters + Latin-1/Extended letters
  if (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x00c0 && code <= 0x024f)
  ) {
    return 'latin';
  }
  return 'other';
}

/** Dominant script of a word (ties resolve latin > hangul > cjk > other). */
export function scriptOf(word: string): Script {
  const counts: Record<Script, number> = { latin: 0, hangul: 0, cjk: 0, other: 0 };
  for (const ch of word) counts[classifyCode(ch.codePointAt(0)!)]++;
  const order: Script[] = ['latin', 'hangul', 'cjk', 'other'];
  let best: Script = 'other';
  let bestN = -1;
  for (const s of order) {
    if (counts[s] > bestN) {
      bestN = counts[s];
      best = s;
    }
  }
  return best;
}

export function langForScript(script: Script): Lang {
  if (script === 'latin') return 'en';
  if (script === 'hangul') return 'ko';
  return 'skip';
}

/** A pluggable spell-checking backend. All methods are async. */
export interface SpellChecker {
  /** true = correct or not-checkable; false = misspelled. */
  check(word: string, lang: Lang): Promise<boolean>;
  /** Ordered correction suggestions, best first. */
  suggest(word: string, lang: Lang): Promise<string[]>;
  /** Whether this provider handles the given language. */
  supports(lang: Lang): boolean;
}
