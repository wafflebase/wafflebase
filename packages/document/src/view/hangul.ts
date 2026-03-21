/**
 * Software Hangul syllable assembler.
 *
 * Used when the browser does not fire IME composition events
 * (e.g., Mobile Safari with a hidden textarea). Converts a stream of
 * individual jamo (자소) into composed Hangul syllable blocks.
 *
 * Korean syllable = lead consonant (초성) + vowel (중성) + optional tail (종성)
 * Unicode: syllable = 0xAC00 + (lead × 21 + vowel) × 28 + tail
 */

const SYLLABLE_BASE = 0xAC00;
const VOWEL_COUNT = 21;
const TAIL_COUNT = 28;

/** Check if a single character is a Korean compatibility jamo (ㄱ–ㅣ). */
export function isJamo(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0x3131 && c <= 0x3163;
}

function isConsonant(code: number): boolean {
  return code >= 0x3131 && code <= 0x314e;
}

function isVowel(code: number): boolean {
  return code >= 0x314f && code <= 0x3163;
}

// --- Index mappings ---

/** Compatibility jamo code → lead consonant index (초성). */
const LEAD: Record<number, number> = {
  0x3131: 0,  0x3132: 1,  0x3134: 2,  0x3137: 3,  0x3138: 4,
  0x3139: 5,  0x3141: 6,  0x3142: 7,  0x3143: 8,  0x3145: 9,
  0x3146: 10, 0x3147: 11, 0x3148: 12, 0x3149: 13, 0x314a: 14,
  0x314b: 15, 0x314c: 16, 0x314d: 17, 0x314e: 18,
};

/** Compatibility jamo code → tail consonant index (종성). */
const TAIL: Record<number, number> = {
  0x3131: 1,  0x3132: 2,  0x3134: 4,  0x3137: 7,  0x3139: 8,
  0x3141: 16, 0x3142: 17, 0x3145: 19, 0x3146: 20, 0x3147: 21,
  0x3148: 22, 0x314a: 23, 0x314b: 24, 0x314c: 25, 0x314d: 26,
  0x314e: 27,
};

/** Tail index → lead index (when tail moves to next syllable). */
const TAIL_AS_LEAD: Record<number, number> = {
  1: 0, 2: 1, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7, 19: 9, 20: 10,
  21: 11, 22: 12, 23: 14, 24: 15, 25: 16, 26: 17, 27: 18,
};

/** Compound tail formation: COMPOUND_TAILS[currentTail][consonantCode] → newTail. */
const COMPOUND_TAILS = new Map<number, Map<number, number>>([
  [1,  new Map([[0x3145, 3]])],
  [4,  new Map([[0x3148, 5],  [0x314e, 6]])],
  [8,  new Map([[0x3131, 9],  [0x3141, 10], [0x3142, 11], [0x3145, 12],
                [0x314c, 13], [0x314d, 14], [0x314e, 15]])],
  [17, new Map([[0x3145, 18]])],
]);

/** Compound tail split: tailIndex → [remainingTail, newLeadIndex]. */
const TAIL_SPLIT: Record<number, [number, number]> = {
  3: [1, 9], 5: [4, 12], 6: [4, 18], 9: [8, 0], 10: [8, 6],
  11: [8, 7], 12: [8, 9], 13: [8, 16], 14: [8, 17], 15: [8, 18],
  18: [17, 9],
};

/** Compound vowel formation: COMPOUND_VOWELS[currentVowel][vowelCode] → newVowel. */
const COMPOUND_VOWELS = new Map<number, Map<number, number>>([
  [8,  new Map([[0x314f, 9],  [0x3150, 10], [0x3163, 11]])],
  [13, new Map([[0x3153, 14], [0x3154, 15], [0x3163, 16]])],
  [18, new Map([[0x3163, 19]])],
]);

function buildSyllable(lead: number, vowel: number, tail = 0): string {
  return String.fromCharCode(
    SYLLABLE_BASE + (lead * VOWEL_COUNT + vowel) * TAIL_COUNT + tail,
  );
}

// --- Assembler ---

export interface HangulResult {
  /** Completed text to commit at the composition start position. */
  commit?: string;
  /** Current composing preview (replaces previous preview). */
  composing?: string;
}

type State =
  | { type: 'EMPTY' }
  | { type: 'LEAD'; lead: number; code: number }
  | { type: 'VOWEL'; vowel: number; code: number }
  | { type: 'SYLLABLE'; lead: number; vowel: number }
  | { type: 'SYLLABLE_TAIL'; lead: number; vowel: number; tail: number };

export class HangulAssembler {
  private state: State = { type: 'EMPTY' };

  /** Whether there is an active composition. */
  get isComposing(): boolean {
    return this.state.type !== 'EMPTY';
  }

  /** Feed a single character. Returns committed and/or composing text. */
  feed(ch: string): HangulResult {
    const code = ch.charCodeAt(0);
    if (isConsonant(code)) return this.onConsonant(code);
    if (isVowel(code)) return this.onVowel(code);
    const f = this.flush();
    return { commit: (f?.commit ?? '') + ch };
  }

  /** Commit any pending composition. */
  flush(): HangulResult | null {
    const s = this.state;
    this.state = { type: 'EMPTY' };
    switch (s.type) {
      case 'EMPTY':
        return null;
      case 'LEAD':
        return { commit: String.fromCharCode(s.code) };
      case 'VOWEL':
        return { commit: String.fromCharCode(s.code) };
      case 'SYLLABLE':
        return { commit: buildSyllable(s.lead, s.vowel) };
      case 'SYLLABLE_TAIL':
        return { commit: buildSyllable(s.lead, s.vowel, s.tail) };
    }
  }

  private onConsonant(code: number): HangulResult {
    const lead = LEAD[code];
    if (lead === undefined) {
      const f = this.flush();
      return { commit: (f?.commit ?? '') + String.fromCharCode(code) };
    }

    const s = this.state;
    switch (s.type) {
      case 'EMPTY':
        this.state = { type: 'LEAD', lead, code };
        return { composing: String.fromCharCode(code) };

      case 'LEAD': {
        this.state = { type: 'LEAD', lead, code };
        return { commit: String.fromCharCode(s.code), composing: String.fromCharCode(code) };
      }

      case 'VOWEL': {
        this.state = { type: 'LEAD', lead, code };
        return { commit: String.fromCharCode(s.code), composing: String.fromCharCode(code) };
      }

      case 'SYLLABLE': {
        const tail = TAIL[code];
        if (tail !== undefined) {
          this.state = { type: 'SYLLABLE_TAIL', lead: s.lead, vowel: s.vowel, tail };
          return { composing: buildSyllable(s.lead, s.vowel, tail) };
        }
        this.state = { type: 'LEAD', lead, code };
        return { commit: buildSyllable(s.lead, s.vowel), composing: String.fromCharCode(code) };
      }

      case 'SYLLABLE_TAIL': {
        const compound = COMPOUND_TAILS.get(s.tail)?.get(code);
        if (compound !== undefined) {
          this.state = { type: 'SYLLABLE_TAIL', lead: s.lead, vowel: s.vowel, tail: compound };
          return { composing: buildSyllable(s.lead, s.vowel, compound) };
        }
        this.state = { type: 'LEAD', lead, code };
        return {
          commit: buildSyllable(s.lead, s.vowel, s.tail),
          composing: String.fromCharCode(code),
        };
      }
    }
  }

  private onVowel(code: number): HangulResult {
    const vowel = code - 0x314f;
    const s = this.state;

    switch (s.type) {
      case 'EMPTY':
        this.state = { type: 'VOWEL', vowel, code };
        return { composing: String.fromCharCode(code) };

      case 'LEAD':
        this.state = { type: 'SYLLABLE', lead: s.lead, vowel };
        return { composing: buildSyllable(s.lead, vowel) };

      case 'VOWEL': {
        const compound = COMPOUND_VOWELS.get(s.vowel)?.get(code);
        if (compound !== undefined) {
          const compoundCode = 0x314f + compound;
          this.state = { type: 'VOWEL', vowel: compound, code: compoundCode };
          return { composing: String.fromCharCode(compoundCode) };
        }
        this.state = { type: 'VOWEL', vowel, code };
        return { commit: String.fromCharCode(s.code), composing: String.fromCharCode(code) };
      }

      case 'SYLLABLE': {
        const compound = COMPOUND_VOWELS.get(s.vowel)?.get(code);
        if (compound !== undefined) {
          this.state = { type: 'SYLLABLE', lead: s.lead, vowel: compound };
          return { composing: buildSyllable(s.lead, compound) };
        }
        this.state = { type: 'VOWEL', vowel, code };
        return { commit: buildSyllable(s.lead, s.vowel), composing: String.fromCharCode(code) };
      }

      case 'SYLLABLE_TAIL': {
        const split = TAIL_SPLIT[s.tail];
        if (split) {
          const [remainingTail, newLead] = split;
          this.state = { type: 'SYLLABLE', lead: newLead, vowel };
          return {
            commit: buildSyllable(s.lead, s.vowel, remainingTail),
            composing: buildSyllable(newLead, vowel),
          };
        }
        const newLead = TAIL_AS_LEAD[s.tail];
        if (newLead !== undefined) {
          this.state = { type: 'SYLLABLE', lead: newLead, vowel };
          return {
            commit: buildSyllable(s.lead, s.vowel),
            composing: buildSyllable(newLead, vowel),
          };
        }
        this.state = { type: 'VOWEL', vowel, code };
        return {
          commit: buildSyllable(s.lead, s.vowel, s.tail),
          composing: String.fromCharCode(code),
        };
      }
    }
  }
}
