import { describe, it, expect } from 'vitest';
import { HangulAssembler, isJamo } from '../../src/view/hangul.js';

describe('isJamo', () => {
  it('returns true for Korean consonants and vowels', () => {
    expect(isJamo('ㄱ')).toBe(true);
    expect(isJamo('ㅎ')).toBe(true);
    expect(isJamo('ㅏ')).toBe(true);
    expect(isJamo('ㅣ')).toBe(true);
  });

  it('returns false for non-jamo characters', () => {
    expect(isJamo('a')).toBe(false);
    expect(isJamo('한')).toBe(false);
    expect(isJamo('1')).toBe(false);
  });
});

describe('HangulAssembler', () => {
  function assemble(jamo: string[]): string {
    const asm = new HangulAssembler();
    let result = '';
    for (const ch of jamo) {
      const r = asm.feed(ch);
      if (r.commit) result += r.commit;
    }
    const f = asm.flush();
    if (f?.commit) result += f.commit;
    return result;
  }

  function composingAfter(jamo: string[]): string {
    const asm = new HangulAssembler();
    let composing = '';
    for (const ch of jamo) {
      const r = asm.feed(ch);
      if (r.composing !== undefined) composing = r.composing;
    }
    return composing;
  }

  it('assembles single syllable "한" (ㅎ+ㅏ+ㄴ)', () => {
    expect(assemble(['ㅎ', 'ㅏ', 'ㄴ'])).toBe('한');
  });

  it('assembles two syllables "한글" (ㅎ+ㅏ+ㄴ+ㄱ+ㅡ+ㄹ)', () => {
    expect(assemble(['ㅎ', 'ㅏ', 'ㄴ', 'ㄱ', 'ㅡ', 'ㄹ'])).toBe('한글');
  });

  it('assembles three syllables "가나다"', () => {
    expect(assemble(['ㄱ', 'ㅏ', 'ㄴ', 'ㅏ', 'ㄷ', 'ㅏ'])).toBe('가나다');
  });

  it('assembles batchim "받침" (ㅂ+ㅏ+ㄷ+ㅊ+ㅣ+ㅁ)', () => {
    expect(assemble(['ㅂ', 'ㅏ', 'ㄷ', 'ㅊ', 'ㅣ', 'ㅁ'])).toBe('받침');
  });

  it('assembles compound tail "닭" (ㄷ+ㅏ+ㄹ+ㄱ)', () => {
    expect(assemble(['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ'])).toBe('닭');
  });

  it('splits compound tail when vowel follows: "닭이" → ㄷㅏㄹㄱㅇㅣ', () => {
    // ㄷ+ㅏ+ㄹ+ㄱ = 닭, then ㅇ can't be added as compound tail → commit 닭, start ㅇ
    // Wait: ㅇ+ㅣ = 이, but ㄹ+ㄱ=ㄺ, then ㅇ is consonant not vowel
    // Actually "닭이": ㄷ+ㅏ+ㄹ+ㄱ+ㅇ+ㅣ
    // ㄹ+ㄱ → ㄺ (compound tail), then ㅇ is consonant → can't compound with ㄺ
    // → commit 닭, start ㅇ, then ㅣ → 이
    expect(assemble(['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ', 'ㅇ', 'ㅣ'])).toBe('닭이');
  });

  it('splits simple tail when vowel follows: "하나" → ㅎㅏㄴㅏ', () => {
    // ㅎ+ㅏ+ㄴ = 한 (with ㄴ tail), then ㅏ → split: commit 하, composing 나
    expect(assemble(['ㅎ', 'ㅏ', 'ㄴ', 'ㅏ'])).toBe('하나');
  });

  it('assembles compound vowel "쉬" (ㅅ+ㅟ = ㅅ+ㅜ+ㅣ)', () => {
    expect(assemble(['ㅅ', 'ㅜ', 'ㅣ'])).toBe('쉬');
  });

  it('assembles compound vowel "와" (ㅇ+ㅘ = ㅇ+ㅗ+ㅏ)', () => {
    expect(assemble(['ㅇ', 'ㅗ', 'ㅏ'])).toBe('와');
  });

  it('shows intermediate composing text correctly', () => {
    expect(composingAfter(['ㅎ'])).toBe('ㅎ');
    expect(composingAfter(['ㅎ', 'ㅏ'])).toBe('하');
    expect(composingAfter(['ㅎ', 'ㅏ', 'ㄴ'])).toBe('한');
  });

  it('handles lone consonant then vowel → separate', () => {
    // ㄱ then ㅏ → 가 (combined, not separate)
    expect(assemble(['ㄱ', 'ㅏ'])).toBe('가');
  });

  it('handles two consecutive consonants', () => {
    // ㄱ then ㄴ → commit ㄱ, composing ㄴ
    expect(assemble(['ㄱ', 'ㄴ'])).toBe('ㄱㄴ');
  });

  it('handles lone vowels', () => {
    expect(assemble(['ㅏ'])).toBe('ㅏ');
    expect(assemble(['ㅏ', 'ㅓ'])).toBe('ㅏㅓ');
  });

  it('flushes correctly when not composing', () => {
    const asm = new HangulAssembler();
    expect(asm.flush()).toBeNull();
    expect(asm.isComposing).toBe(false);
  });

  it('handles double consonants (ㅆ) as tail', () => {
    // 있 = ㅇ+ㅣ+ㅆ
    expect(assemble(['ㅇ', 'ㅣ', 'ㅆ'])).toBe('있');
  });

  it('double consonant ㄸ cannot be tail → commit + new lead', () => {
    // ㅎ+ㅏ+ㄸ → 하 committed + ㄸ composing
    const asm = new HangulAssembler();
    asm.feed('ㅎ');
    asm.feed('ㅏ');
    const r = asm.feed('ㄸ');
    expect(r.commit).toBe('하');
    expect(r.composing).toBe('ㄸ');
  });
});
