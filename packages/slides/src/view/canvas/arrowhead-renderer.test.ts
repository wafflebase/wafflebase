import { describe, expect, it } from 'vitest';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawArrowhead } from './arrowhead-renderer';

describe('drawArrowhead', () => {
  it('triangle md: draws a filled triangle pointing along angle=0', () => {
    const spy = createCtxSpy();
    drawArrowhead(
      asCtx(spy),
      { x: 100, y: 100, angle: 0 },
      { kind: 'triangle', size: 'md' },
      'red',
    );

    // Path is opened, three vertices are visited, path closed and filled.
    expect(spy.beginPath).toHaveBeenCalledTimes(1);
    expect(spy.moveTo).toHaveBeenCalledTimes(1);
    expect(spy.lineTo).toHaveBeenCalledTimes(2);
    expect(spy.closePath).toHaveBeenCalledTimes(1);
    expect(spy.fill).toHaveBeenCalledTimes(1);

    // Triangle tip lands on the endpoint.
    expect(spy.moveTo).toHaveBeenCalledWith(100, 100);

    // Fill colour propagated.
    expect(spy.fillStyle).toBe('red');
  });

  it('triangle md angle=0: base extends backward along -x with symmetric half-width', () => {
    const spy = createCtxSpy();
    drawArrowhead(
      asCtx(spy),
      { x: 100, y: 100, angle: 0 },
      { kind: 'triangle', size: 'md' },
      'black',
    );

    // For angle=0, base sits at x = 100 - 12 = 88 with y offset ±5
    // (TRIANGLE_LEN.md = 12, TRIANGLE_WIDTH.md = 10, halfW = 5).
    const lineToCalls = (spy.lineTo as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(lineToCalls).toHaveLength(2);

    const [first, second] = lineToCalls;
    expect(first[0]).toBeCloseTo(88);
    expect(first[1]).toBeCloseTo(105);
    expect(second[0]).toBeCloseTo(88);
    expect(second[1]).toBeCloseTo(95);
  });

  it('size sm/md/lg produce different base offsets', () => {
    const spySm = createCtxSpy();
    const spyMd = createCtxSpy();
    const spyLg = createCtxSpy();
    drawArrowhead(asCtx(spySm), { x: 0, y: 0, angle: 0 }, { kind: 'triangle', size: 'sm' }, '#000');
    drawArrowhead(asCtx(spyMd), { x: 0, y: 0, angle: 0 }, { kind: 'triangle', size: 'md' }, '#000');
    drawArrowhead(asCtx(spyLg), { x: 0, y: 0, angle: 0 }, { kind: 'triangle', size: 'lg' }, '#000');

    const baseX = (spy: ReturnType<typeof createCtxSpy>): number =>
      (spy.lineTo as unknown as { mock: { calls: number[][] } }).mock.calls[0][0];

    // baseX = 0 - len; expect monotonically more negative as size grows.
    expect(baseX(spySm)).toBeGreaterThan(baseX(spyMd));
    expect(baseX(spyMd)).toBeGreaterThan(baseX(spyLg));
  });

  it('non-triangle kinds (PR1) are no-ops', () => {
    const kinds = [
      'triangle-open',
      'diamond',
      'diamond-open',
      'circle',
      'circle-open',
      'square',
      'square-open',
    ] as const;
    for (const kind of kinds) {
      const spy = createCtxSpy();
      drawArrowhead(
        asCtx(spy),
        { x: 100, y: 100, angle: 0 },
        { kind, size: 'md' },
        'red',
      );
      expect(spy.beginPath).not.toHaveBeenCalled();
      expect(spy.moveTo).not.toHaveBeenCalled();
      expect(spy.lineTo).not.toHaveBeenCalled();
      expect(spy.fill).not.toHaveBeenCalled();
    }
  });
});
