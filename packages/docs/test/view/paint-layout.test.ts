// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRun } from '../../src/view/paint-layout';
import { computeLayout } from '../../src/view/layout';
import type { LayoutLine } from '../../src/view/layout';
import { createBlock } from '../../src/model/types';
import { ptToPx } from '../../src/view/theme';
import { stubMeasurer } from './_stub-measurer';

/**
 * Stand-in for `CanvasRenderingContext2D` that records the y-coordinate
 * (the alphabetic baseline) each `fillText` lands on. Avoids jsdom's
 * partial Canvas (no `fillText`) and keeps the surface to just the
 * baseline we assert on. Includes the no-op stroke/path/save methods
 * `renderRun` may touch for underline / strikethrough / background so
 * the function runs end-to-end regardless of style.
 */
function makeBaselineCtx(): {
  ctx: CanvasRenderingContext2D;
  baselines: number[];
} {
  const baselines: number[] = [];
  const noop = () => {};
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillText(_text: string, _x: number, y: number) {
      baselines.push(y);
    },
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    setLineDash: noop,
    fillRect: noop,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, baselines };
}

/** Render one line's runs and return the baseline y for each run. */
function baselinesForLine(line: LayoutLine): number[] {
  const out: number[] = [];
  for (const run of line.runs) {
    const { ctx, baselines } = makeBaselineCtx();
    renderRun(ctx, run, 0, 0, line.height, line.maxFontSizePx, {});
    // A plain text run emits exactly one fillText (the glyphs).
    out.push(baselines[0]);
  }
  return out;
}

function singleLine(inlines: Array<{ text: string; fontSize: number }>): LayoutLine {
  const block = createBlock('paragraph');
  block.inlines = inlines.map((i) => ({ text: i.text, style: { fontSize: i.fontSize } }));
  const { layout } = computeLayout([block], stubMeasurer(), 600);
  return layout.blocks[0].lines[0];
}

describe('renderRun shared baseline', () => {
  it('places different-size runs on one common baseline', () => {
    const line = singleLine([
      { text: 'Big', fontSize: 36 },
      { text: 'small', fontSize: 11 },
    ]);
    expect(line.runs.length).toBe(2);
    const [bigY, smallY] = baselinesForLine(line);
    expect(smallY).toBe(bigY);
  });

  it('does not move the tallest run when a smaller run joins the line', () => {
    const tallOnly = singleLine([{ text: 'Big', fontSize: 36 }]);
    const mixed = singleLine([
      { text: 'Big', fontSize: 36 },
      { text: 'small', fontSize: 11 },
    ]);
    const tallBaseline = baselinesForLine(tallOnly)[0];
    const mixedBigBaseline = baselinesForLine(mixed)[0];
    expect(mixedBigBaseline).toBe(tallBaseline);
  });

  it('drops the smaller run down to the shared baseline (vs. floating on its own)', () => {
    const mixed = singleLine([
      { text: 'Big', fontSize: 36 },
      { text: 'small', fontSize: 11 },
    ]);
    const smallOnly = singleLine([{ text: 'small', fontSize: 11 }]);
    const smallMixedBaseline = baselinesForLine(mixed)[1];
    const smallAloneBaseline = baselinesForLine(smallOnly)[0];
    // On the mixed line the small run sits lower (larger y) than it would
    // on a line of its own size — i.e. it dropped to the shared baseline.
    expect(smallMixedBaseline).toBeGreaterThan(smallAloneBaseline);
  });

  it('is a no-op for a uniform-size line (regression guard)', () => {
    const line = singleLine([
      { text: 'Hello ', fontSize: 16 },
      { text: 'world', fontSize: 16 },
    ]);
    const [a, b] = baselinesForLine(line);
    expect(a).toBe(b);
  });

  it('falls back to the run\'s own size when the line max is undefined', () => {
    const mixed = singleLine([
      { text: 'Big', fontSize: 36 },
      { text: 'small', fontSize: 11 },
    ]);
    const smallRun = mixed.runs[1];

    // Line max supplied → shared (lower) baseline.
    const withMax = makeBaselineCtx();
    renderRun(withMax.ctx, smallRun, 0, 0, mixed.height, mixed.maxFontSizePx, {});
    const shared = withMax.baselines[0];

    // undefined → fallback uses the run's OWN font size, reproducing the
    // pre-fix per-run baseline (floats up above the shared one).
    const withoutMax = makeBaselineCtx();
    renderRun(withoutMax.ctx, smallRun, 0, 0, mixed.height, undefined, {});
    const fallback = withoutMax.baselines[0];

    // lineY = 0, no super/subscript → baseline = round((height + ownAscent) / 2).
    const expectedOwn = Math.round((mixed.height + ptToPx(11) * 0.8) / 2);
    expect(fallback).toBe(expectedOwn);
    expect(fallback).toBeLessThan(shared);
  });
});
