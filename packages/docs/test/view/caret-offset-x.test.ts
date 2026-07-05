import { describe, it, expect } from 'vitest';
import { caretOffsetX } from '../../src/view/layout.js';
import type { LayoutRun } from '../../src/view/layout.js';
import type { TextMeasurer } from '../../src/view/measurer.js';

function run(text: string, charOffsets: number[]): LayoutRun {
  return {
    inline: { text, style: {} },
    text,
    x: 0,
    width: charOffsets[charOffsets.length - 1] ?? 0,
    inlineIndex: 0,
    charStart: 0,
    charEnd: text.length,
    charOffsets,
  };
}

describe('caretOffsetX', () => {
  it('reads the precomputed charOffsets without measuring', () => {
    let calls = 0;
    const measurer: TextMeasurer = {
      measureWidth() {
        calls++;
        return -1;
      },
    };
    const r = run('abcd', [8, 16, 24, 32]);

    expect(caretOffsetX(r, 0, measurer)).toBe(0); // before first char
    expect(caretOffsetX(r, 1, measurer)).toBe(8);
    expect(caretOffsetX(r, 3, measurer)).toBe(24);
    expect(caretOffsetX(r, 4, measurer)).toBe(32); // caret at run end
    expect(calls).toBe(0);
  });

  it('falls back to measuring when offsets are missing/short', () => {
    let calls = 0;
    const measurer: TextMeasurer = {
      measureWidth(text: string) {
        calls++;
        return text.length * 5;
      },
    };
    // charOffsets shorter than the requested offset (should not happen in
    // normal layout, but the fallback preserves correctness if it does).
    const r = run('abcd', [8]);
    expect(caretOffsetX(r, 3, measurer)).toBe(15); // 'abc'.length * 5
    expect(calls).toBe(1);
  });
});
