// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRun } from '../../src/view/paint-layout';
import { computeLayout } from '../../src/view/layout';
import type { LayoutLine } from '../../src/view/layout';
import { createBlock } from '../../src/model/types';
import { ptToPx, Theme } from '../../src/view/theme';
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

/**
 * Records each stroked line segment so composing-underline geometry can be
 * asserted. Captures the current `strokeStyle` / `lineWidth` at `stroke()`
 * time along with the last `moveTo` → `lineTo` pair.
 */
function makeStrokeCtx(): {
  ctx: CanvasRenderingContext2D;
  strokes: Array<{ x0: number; y0: number; x1: number; y1: number; color: string; width: number }>;
} {
  const strokes: Array<{ x0: number; y0: number; x1: number; y1: number; color: string; width: number }> = [];
  let from = { x: 0, y: 0 };
  let to = { x: 0, y: 0 };
  let strokeStyle = '';
  let lineWidth = 1;
  const noop = () => {};
  const ctx = {
    font: '',
    fillStyle: '',
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v: string) { strokeStyle = v; },
    get lineWidth() { return lineWidth; },
    set lineWidth(v: number) { lineWidth = v; },
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillText: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo(x: number, y: number) {
      from = { x, y };
    },
    lineTo(x: number, y: number) {
      to = { x, y };
    },
    stroke() {
      strokes.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, color: strokeStyle, width: lineWidth });
    },
    setLineDash: noop,
    fillRect: noop,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, strokes };
}

/** Lay out a single composing run (IME preview) and its plain neighbour. */
function composingLine(): LayoutLine {
  const block = createBlock('paragraph');
  block.id = 'a';
  block.inlines = [{ text: 'ABCD', style: {} }];
  const { layout } = computeLayout(
    [block], stubMeasurer(), 600, undefined, undefined,
    { blockId: 'a', offset: 2, text: 'oo' },
  );
  return layout.blocks[0].lines[0];
}

describe('renderRun composing underline', () => {
  it('strokes a 2px solid underline in the text color under a composing run', () => {
    const line = composingLine();
    const run = line.runs.find((r) => r.composing);
    expect(run).toBeDefined();

    const { ctx, strokes } = makeStrokeCtx();
    renderRun(ctx, run!, 0, 0, line.height, line.maxFontSizePx, {});

    // Exactly one underline stroke, spanning the run width, 2px solid.
    expect(strokes.length).toBe(1);
    const s = strokes[0];
    expect(s.width).toBe(2);
    expect(s.y0).toBe(s.y1); // horizontal
    expect(s.x0).toBe(Math.round(run!.x));
    expect(s.x1).toBe(Math.round(run!.x) + run!.width);
    // Default theme text color (no explicit color on the run).
    expect(s.color).toBe(Theme.defaultColor);
  });

  it('does not stroke an underline under a plain (non-composing) run', () => {
    const line = composingLine();
    const plain = line.runs.find((r) => !r.composing && r.text !== '\n');
    expect(plain).toBeDefined();

    const { ctx, strokes } = makeStrokeCtx();
    renderRun(ctx, plain!, 0, 0, line.height, line.maxFontSizePx, {});
    expect(strokes.length).toBe(0);
  });
});

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
