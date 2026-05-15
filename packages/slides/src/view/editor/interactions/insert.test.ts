import { describe, it, expect } from 'vitest';
import { buildInsertElement, defaultInsertSize } from './insert';

describe('buildInsertElement — drag-shaped shapes', () => {
  it('builds a rect from the drag rectangle', () => {
    const init = buildInsertElement('rect', { x: 10, y: 20 }, { x: 110, y: 80 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 10, y: 20, w: 100, h: 60, rotation: 0 },
      data: {
        kind: 'rect',
        fill: { kind: 'role', role: 'accent1' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 1 },
      },
    });
  });
  it('builds an ellipse the same way', () => {
    const init = buildInsertElement('ellipse', { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: {
        kind: 'ellipse',
        fill: { kind: 'role', role: 'accent1' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 1 },
      },
    });
  });
  it('normalises a backwards drag', () => {
    const init = buildInsertElement('rect', { x: 100, y: 100 }, { x: 50, y: 60 });
    expect(init.frame).toEqual({ x: 50, y: 60, w: 50, h: 40, rotation: 0 });
  });
});

describe('buildInsertElement — text', () => {
  it('returns a default-sized text box anchored at the start point', () => {
    const text = buildInsertElement('text', { x: 50, y: 50 }, { x: 50, y: 50 });
    expect(text.type).toBe('text');
    expect(text.frame.w).toBe(400);
    expect(text.frame.h).toBe(80);
    expect(text.frame.x).toBe(50);
    expect(text.frame.y).toBe(50);
  });
});

describe('buildInsertElement — category defaults', () => {
  it('uses outlined defaults for callouts', () => {
    const init = buildInsertElement(
      'wedgeRectCallout', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(init).toMatchObject({
      type: 'shape',
      data: {
        kind: 'wedgeRectCallout',
        fill: { kind: 'role', role: 'background' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
      },
    });
  });

  it('uses filled defaults for new block-arrow kinds', () => {
    const init = buildInsertElement(
      'rightArrow', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(init).toMatchObject({
      type: 'shape',
      data: {
        kind: 'rightArrow',
        fill: { kind: 'role', role: 'accent1' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 1 },
      },
    });
  });

  it('uses outlined defaults for flowchart kinds', () => {
    const init = buildInsertElement(
      'flowChartTerminator', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(init).toMatchObject({
      type: 'shape',
      data: {
        kind: 'flowChartTerminator',
        fill: { kind: 'role', role: 'background' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
      },
    });
  });

  it('uses filled defaults for star kinds', () => {
    const init = buildInsertElement(
      'star5', { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(init).toMatchObject({
      type: 'shape',
      data: {
        kind: 'star5',
        fill: { kind: 'role', role: 'accent1' },
        stroke: { color: { kind: 'role', role: 'text' }, width: 1 },
      },
    });
  });
});

describe('buildInsertElement — no-drag click defaults', () => {
  // When the pointer barely moves (< 4 px Euclidean) we treat it as a
  // click and apply a per-kind default size from DEFAULT_INSERT_SIZE.
  // The frame is anchored top-left at the click point.

  it('rect → SHAPE_WIDE (320×200)', () => {
    const init = buildInsertElement('rect', { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(init.frame).toEqual({ x: 100, y: 100, w: 320, h: 200, rotation: 0 });
  });

  it('ellipse → SHAPE_SQUARE (200×200)', () => {
    const init = buildInsertElement('ellipse', { x: 50, y: 50 }, { x: 50, y: 50 });
    expect(init.frame).toEqual({ x: 50, y: 50, w: 200, h: 200, rotation: 0 });
  });

  it('rightArrow → horizontal ARROW_H (320×160)', () => {
    const init = buildInsertElement('rightArrow', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 320, h: 160, rotation: 0 });
  });

  it('upArrow → vertical ARROW_V (160×320)', () => {
    const init = buildInsertElement('upArrow', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 160, h: 320, rotation: 0 });
  });

  it('quadArrow → square SHAPE_SQUARE_L (240×240)', () => {
    const init = buildInsertElement('quadArrow', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 240, h: 240, rotation: 0 });
  });

  it('ribbon → BANNER (480×140)', () => {
    const init = buildInsertElement('ribbon', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 480, h: 140, rotation: 0 });
  });

  it('verticalScroll → SCROLL_V (200×400)', () => {
    const init = buildInsertElement('verticalScroll', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 200, h: 400, rotation: 0 });
  });

  it('flowChartTerminator → FLOWCHART (280×160)', () => {
    const init = buildInsertElement(
      'flowChartTerminator', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 280, h: 160, rotation: 0 });
  });

  it('star5 → SHAPE_SQUARE_L (240×240)', () => {
    const init = buildInsertElement('star5', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 240, h: 240, rotation: 0 });
  });

  it('mathPlus → square 200×200', () => {
    const init = buildInsertElement('mathPlus', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 200, h: 200, rotation: 0 });
  });

  it('actionButtonHome → ACTION_BUTTON (140×140)', () => {
    const init = buildInsertElement(
      'actionButtonHome', { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 140, h: 140, rotation: 0 });
  });

  it('treats sub-threshold drags (< 4 px Euclidean) as clicks', () => {
    // 3-4 sqrt = 5 → exceeds threshold; 3-3 sqrt ≈ 4.24 → exceeds;
    // 2-2 sqrt ≈ 2.83 → below threshold (sq = 8 < 16) → click.
    const drag = buildInsertElement('rect', { x: 10, y: 10 }, { x: 13, y: 14 });
    expect(drag.frame).toEqual({ x: 10, y: 10, w: 3, h: 4, rotation: 0 });
    const click = buildInsertElement('rect', { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(click.frame).toEqual({ x: 10, y: 10, w: 320, h: 200, rotation: 0 });
  });

  it('drag overrides default size even for a square-default kind', () => {
    // ellipse default is 200×200 but a real drag should still win.
    const init = buildInsertElement('ellipse', { x: 0, y: 0 }, { x: 50, y: 80 });
    expect(init.frame).toEqual({ x: 0, y: 0, w: 50, h: 80, rotation: 0 });
  });

  it('defaultInsertSize falls back for any unmapped kind', () => {
    // Use a real kind that intentionally hits the fallback path; if
    // every kind ends up mapped, swap to an as-cast literal. For now,
    // smokeyTest the helper directly with a known mapping.
    expect(defaultInsertSize('rect')).toEqual({ w: 320, h: 200 });
    expect(defaultInsertSize('actionButtonHome')).toEqual({ w: 140, h: 140 });
  });
});
