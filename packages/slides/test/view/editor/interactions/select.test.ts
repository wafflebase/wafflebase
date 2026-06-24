import { describe, it, expect } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../src/view/canvas/test-canvas-env';
import type { Slide } from '../../../../src/model/presentation';
import type { Element } from '../../../../src/model/element';
import type { Block } from '@wafflebase/docs';
import {
  selectAt,
  isEmptyPlaceholder,
  type SelectAtOptions,
} from '../../../../src/view/editor/interactions/select';

const blankSlide = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: { kind: 'srgb' as const, value: '#fff' } },
  elements,
  notes: [],
});
const rect = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});
const ellipse = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'ellipse', fill: { kind: 'srgb' as const, value: '#abc' } },
});
const diamond = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'diamond', fill: { kind: 'srgb' as const, value: '#abc' } },
});

const testCtx = createTestCanvas(1, 1).getContext('2d');
const hitOpts: SelectAtOptions = { ctx: testCtx };

describe('selectAt', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 200, 200);
  const overlapping = rect('c', 50, 50, 50, 50); // sits on top of a
  const slide = blankSlide([a, b, overlapping]);

  it('selects the topmost element under the point (last in array)', () => {
    expect(selectAt(slide, 60, 60, {}, [], hitOpts)).toEqual(['c']);
  });

  it('selects a non-overlapping element', () => {
    expect(selectAt(slide, 250, 250, {}, [], hitOpts)).toEqual(['b']);
  });

  it('clears selection when clicking on empty canvas', () => {
    expect(selectAt(slide, 500, 500, {}, ['a'], hitOpts)).toEqual([]);
  });

  it('shift-click toggles addition to multi-select', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c'], hitOpts)).toEqual(['c', 'b']);
  });

  it('shift-click toggles removal of an already-selected element', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c', 'b'], hitOpts)).toEqual(['c']);
  });

  it('shift-click on empty canvas leaves selection unchanged', () => {
    expect(selectAt(slide, 500, 500, { shift: true }, ['a'], hitOpts)).toEqual(['a']);
  });

  it('clicking an already-selected element preserves the multi-selection', () => {
    // Without this, a no-shift click on one of several selected
    // elements would collapse the selection to just the hit and the
    // follow-up drag would only move that one element.
    expect(selectAt(slide, 250, 250, {}, ['a', 'b'], hitOpts)).toEqual(['a', 'b']);
  });

  it('clicking a non-selected element while others are selected replaces selection', () => {
    expect(selectAt(slide, 60, 60, {}, ['b'], hitOpts)).toEqual(['c']);
  });
});

describe('selectAt — precise shape geometry', () => {
  it('ignores clicks in an ellipse bbox corner outside the ellipse', () => {
    // 100x100 ellipse at origin — the (4, 4) bbox corner is well
    // outside the ellipse (1 = (50-4)²/50² + (50-4)²/50² > 1).
    const slide = blankSlide([ellipse('e', 0, 0)]);
    expect(selectAt(slide, 4, 4, {}, [], hitOpts)).toEqual([]);
  });

  it('selects an ellipse when clicking near its centre', () => {
    const slide = blankSlide([ellipse('e', 0, 0)]);
    expect(selectAt(slide, 50, 50, {}, [], hitOpts)).toEqual(['e']);
  });

  it('ignores clicks in a diamond bbox corner outside the diamond', () => {
    // 100x100 diamond at origin — the (5, 5) bbox corner is well
    // outside the diamond's |x-50|/50 + |y-50|/50 ≤ 1 region.
    const slide = blankSlide([diamond('d', 0, 0)]);
    expect(selectAt(slide, 5, 5, {}, [], hitOpts)).toEqual([]);
  });

  it('selects a diamond when clicking its centre', () => {
    const slide = blankSlide([diamond('d', 0, 0)]);
    expect(selectAt(slide, 50, 50, {}, [], hitOpts)).toEqual(['d']);
  });

  it('selects a stroke-only ellipse when clicking on the outline', () => {
    const outlined: Element = {
      id: 'o', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'ellipse', stroke: { color: '#000', width: 1 } },
    };
    const slide = blankSlide([outlined]);
    // Outline at angle 0 is (100, 50). Click 2 px inside still hits the
    // stroke band (stroke 1 + 2*6 tolerance → 13 px wide).
    expect(selectAt(slide, 98, 50, {}, [], hitOpts)).toEqual(['o']);
  });

  it('ignores empty bbox corners of a stroke-only ellipse', () => {
    // The (4, 4) bbox corner is ~15 px from the outline — well outside
    // the 6.5 px-half stroke band. Pre-v2 this returned ['o']; v2's
    // precision pass tightens it.
    const outlined: Element = {
      id: 'o', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { kind: 'ellipse', stroke: { color: '#000', width: 1 } },
    };
    const slide = blankSlide([outlined]);
    expect(selectAt(slide, 4, 4, {}, [], hitOpts)).toEqual([]);
  });

  it('selects a filled smileyFace via its interior', () => {
    const smiley: Element = {
      id: 'sm', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: {
        kind: 'smileyFace',
        fill: { kind: 'srgb' as const, value: '#ff0' },
      },
    };
    const slide = blankSlide([smiley]);
    // Slightly off-centre so we avoid the mouth band CCW subpath. The
    // face's interior at (60, 60) is well inside the body and outside
    // any cut-out.
    expect(selectAt(slide, 60, 60, {}, [], hitOpts)).toEqual(['sm']);
  });

  it('selects a filled smileyFace when clicking just outside the face circle (AA band)', () => {
    // Real users routinely click 1-3 px outside a curved boundary;
    // with v1 those clicks missed. The stroke-band fallback covers
    // them now.
    const smiley: Element = {
      id: 'sm', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: {
        kind: 'smileyFace',
        fill: { kind: 'srgb' as const, value: '#ff0' },
      },
    };
    const slide = blankSlide([smiley]);
    // Outline at angle 0 is (100, 50). (103, 50) is 3 px outside the
    // fill polygon — inside the 6 px tolerance band.
    expect(selectAt(slide, 103, 50, {}, [], hitOpts)).toEqual(['sm']);
  });

  it('selects a filled heart at its centre and tolerates near-edge clicks', () => {
    // 200x200 frame so the lobe geometry has clear interior + edge
    // sample points without sub-pixel ambiguity.
    const heart: Element = {
      id: 'h', type: 'shape',
      frame: { x: 0, y: 0, w: 200, h: 200, rotation: 0 },
      data: { kind: 'heart', fill: { kind: 'srgb' as const, value: '#f00' } },
    };
    const slide = blankSlide([heart]);
    // Deep inside the right lobe of the ECMA Bézier silhouette: (150, 50)
    // sits ~44 px clear of the nearest edge.
    expect(selectAt(slide, 150, 50, {}, [], hitOpts)).toEqual(['h']);
    // Just above the right lobe's top edge (≈ y=4 at x=150) — within the
    // 6 px tolerance band.
    expect(selectAt(slide, 150, 1, {}, [], hitOpts)).toEqual(['h']);
  });

  it('ignores clicks in the empty space above the heart dip', () => {
    // The dip between the two lobes (around (100, 0)) is outside the
    // heart even though it's inside the bbox. v2 still rejects when
    // the click is more than `tolerance` from any drawn edge.
    const heart: Element = {
      id: 'h', type: 'shape',
      frame: { x: 0, y: 0, w: 200, h: 200, rotation: 0 },
      data: { kind: 'heart', fill: { kind: 'srgb' as const, value: '#f00' } },
    };
    const slide = blankSlide([heart]);
    // (100, 10) is ~15 px from the nearest lobe arc — well outside the
    // 6 px tolerance band. (200x200 frame so the lobes meet sharply at
    // x=100 only at the y=lobeY=50 dip.)
    expect(selectAt(slide, 100, 10, {}, [], hitOpts)).toEqual([]);
  });

  it('selects a filled leftBracket along the visible stroke even though OPEN_PATH skips fill', () => {
    // Brackets/braces are OPEN_PATH_KINDS: the renderer ignores `fill`
    // and only strokes the path. v1 fell back to bbox here; v2 uses
    // the stroke band so empty regions inside the bracket bbox stop
    // selecting.
    const bracket: Element = {
      id: 'br', type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 200, rotation: 0 },
      data: {
        kind: 'leftBracket',
        fill: { kind: 'srgb' as const, value: '#000' },
        stroke: { color: '#000', width: 2 },
      },
    };
    const slide = blankSlide([bracket]);
    // The middle of the bbox at (50, 100) is far from the visible
    // C-shape outline → no hit.
    expect(selectAt(slide, 50, 100, {}, [], hitOpts)).toEqual([]);
  });
});

describe('isEmptyPlaceholder', () => {
  const placeholderRef = { type: 'title' as const, index: 0 };
  const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
  const blankBlock: Block = {
    id: 'b1', type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
  const filledBlock: Block = {
    id: 'b1', type: 'paragraph',
    inlines: [{ text: 'Hello', style: {} }],
    style: {},
  } as Block;

  it('true for a text element with placeholderRef and zero blocks', () => {
    const el = {
      id: 'e', type: 'text' as const, frame, placeholderRef,
      data: { blocks: [] },
    };
    expect(isEmptyPlaceholder(el)).toBe(true);
  });

  it('true for a text element with placeholderRef and a single empty paragraph', () => {
    const el = {
      id: 'e', type: 'text' as const, frame, placeholderRef,
      data: { blocks: [blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(true);
  });

  it('false when the placeholder text element carries real content', () => {
    const el = {
      id: 'e', type: 'text' as const, frame, placeholderRef,
      data: { blocks: [filledBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('true for a placeholder whose multiple blocks all have empty inlines', () => {
    // Mirrors the renderer's `isBlocksEmpty` gate: every inline across
    // every block must be the empty string. The predicate intentionally
    // stays this broad so it never says "empty" when the user sees text,
    // or "non-empty" when they see a ghost hint.
    const el = {
      id: 'e', type: 'text' as const, frame, placeholderRef,
      data: { blocks: [blankBlock, blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(true);
  });

  it('false when any inline in any block carries text', () => {
    const el = {
      id: 'e', type: 'text' as const, frame, placeholderRef,
      data: { blocks: [blankBlock, filledBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('false for a text element WITHOUT placeholderRef even when empty', () => {
    const el = {
      id: 'e', type: 'text' as const, frame,
      data: { blocks: [blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('false for a non-text element even when placeholderRef is set', () => {
    // Defensive: today only text elements carry placeholderRef, but
    // the predicate must stay narrow.
    const el = {
      id: 'e', type: 'shape' as const, frame, placeholderRef,
      data: { kind: 'rect' as const, fill: { kind: 'srgb' as const, value: '#abc' } },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('false for null / undefined defensively', () => {
    expect(isEmptyPlaceholder(null)).toBe(false);
    expect(isEmptyPlaceholder(undefined)).toBe(false);
  });
});
