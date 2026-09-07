import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemSlidesStore } from '@wafflebase/slides';
import type { Frame, SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { FormatPanel } from '@/app/slides/format-panel';

/**
 * A panel W/H commit must resize a rotated element in place: the corner
 * that a south-east drag-resize anchors (the unrotated box's top-left)
 * must not move in world space (#1039).
 */
function localToWorld(frame: Frame, lx: number, ly: number) {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const dx = lx - frame.w / 2;
  const dy = ly - frame.h / 2;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function setup(frame: Frame) {
  const store = new MemSlidesStore();
  let slideId!: string;
  let elementId!: string;
  store.batch(() => {
    slideId = store.addSlide('blank', 0);
  });
  store.batch(() => {
    elementId = store.addElement(slideId, {
      type: 'shape',
      frame,
      data: { kind: 'rect' },
    });
  });

  const editor = {
    getCurrentSlideId: () => slideId,
    getSelection: () => [elementId],
    onSelectionChange: () => () => {},
  } as unknown as SlidesEditor;

  render(
    <FormatPanel
      store={store as SlidesStore}
      editor={editor}
      onClose={() => {}}
    />,
  );

  const readFrame = (): Frame => {
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    return slide.elements.find((el) => el.id === elementId)!.frame;
  };
  return { readFrame };
}

/** Commit a new value into a Size & Position input (px → inches). */
function commit(label: RegExp, px: number) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: (px / 192).toFixed(2) } });
  fireEvent.blur(input);
}

describe('FormatPanel W/H on a rotated element', () => {
  it('keeps the anchor corner in world space when W changes', () => {
    const start: Frame = { x: 100, y: 100, w: 384, h: 384, rotation: Math.PI / 4 };
    const { readFrame } = setup(start);
    const before = localToWorld(start, 0, 0);

    commit(/^width$/i, 768);

    const next = readFrame();
    expect(next.w).toBeCloseTo(768, 6);
    expect(next.h).toBeCloseTo(384, 6);
    const after = localToWorld(next, 0, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // The centre moved, which is exactly what keeps the corner still.
    expect(next.x).not.toBeCloseTo(start.x, 3);
  });

  it('keeps the anchor corner in world space when H changes', () => {
    const start: Frame = { x: 100, y: 100, w: 384, h: 384, rotation: Math.PI / 3 };
    const { readFrame } = setup(start);
    const before = localToWorld(start, 0, 0);

    commit(/^height$/i, 192);

    const next = readFrame();
    expect(next.h).toBeCloseTo(192, 6);
    const after = localToWorld(next, 0, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('keeps the anchor corner in world space with the aspect lock on', () => {
    const start: Frame = { x: 100, y: 100, w: 384, h: 192, rotation: Math.PI / 6 };
    const { readFrame } = setup(start);
    const before = localToWorld(start, 0, 0);

    fireEvent.click(screen.getByLabelText(/lock aspect ratio/i));
    commit(/^width$/i, 768);

    const next = readFrame();
    expect(next.w).toBeCloseTo(768, 6);
    expect(next.h).toBeCloseTo(384, 6);
    const after = localToWorld(next, 0, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('leaves x/y untouched on an unrotated element', () => {
    const start: Frame = { x: 100, y: 100, w: 384, h: 384, rotation: 0 };
    const { readFrame } = setup(start);

    commit(/^width$/i, 768);

    const next = readFrame();
    expect(next).toEqual({ x: 100, y: 100, w: 768, h: 384, rotation: 0 });
  });
});
