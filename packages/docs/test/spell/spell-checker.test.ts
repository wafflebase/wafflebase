// packages/docs/test/spell/spell-checker.test.ts
import { describe, it, expect } from 'vitest';
import { scriptOf, langForScript } from '../../src/spell/spell-checker.js';

describe('scriptOf', () => {
  it('classifies plain ASCII as latin', () => {
    expect(scriptOf('hello')).toBe('latin');
  });
  it('classifies accented Latin as latin', () => {
    expect(scriptOf('café')).toBe('latin');
  });
  it('classifies Hangul syllables as hangul', () => {
    expect(scriptOf('안녕')).toBe('hangul');
  });
  it('classifies Han/Kana as cjk', () => {
    expect(scriptOf('日本')).toBe('cjk');
    expect(scriptOf('こんにちは')).toBe('cjk');
  });
  it('uses the dominant script for mixed words', () => {
    expect(scriptOf('test안녕')).toBe('latin'); // 4 latin vs 2 hangul
  });
});

describe('langForScript', () => {
  it('maps scripts to langs', () => {
    expect(langForScript('latin')).toBe('en');
    expect(langForScript('hangul')).toBe('ko');
    expect(langForScript('cjk')).toBe('skip');
    expect(langForScript('other')).toBe('skip');
  });
});
