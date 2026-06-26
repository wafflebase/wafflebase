import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import { LayoutEditStore } from '../../src/store/layout-edit-store';
import {
  layoutEditSlideId,
  placeholderElementId,
} from '../../src/model/layout';

/**
 * PR3 commit 5a — `LayoutEditStore` is the "virtual-slide gate" for
 * canvas layout-editing mode. It wraps the real store and a current
 * layout id, serving a single synthetic slide from `read()` and routing
 * `updateElementFrame` to `updateLayoutPlaceholderFrame`. Structural
 * mutations are guarded no-ops so a layout edit can never leak into slide
 * content. `batch` / undo / `onChange` delegate to the real store.
 */
describe('LayoutEditStore', () => {
  const TITLE_REF = { type: 'title' as const, index: 0 };

  it('read() serves a single synthetic slide for the current layout', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');

    const doc = proxy.read();
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0].id).toBe(layoutEditSlideId('title-body'));
    expect(doc.slides[0].elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'title', index: 0 },
      { type: 'body', index: 0 },
    ]);
  });

  it('read() carries through the real document meta/themes/masters/layouts', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');

    const realDoc = real.read();
    const doc = proxy.read();
    expect(doc.meta).toEqual(realDoc.meta);
    expect(doc.themes).toEqual(realDoc.themes);
    expect(doc.masters).toEqual(realDoc.masters);
    expect(doc.layouts).toEqual(realDoc.layouts);
  });

  it('updateElementFrame routes to updateLayoutPlaceholderFrame on the layout', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');
    const titleId = placeholderElementId(TITLE_REF);

    proxy.batch(() => {
      proxy.updateElementFrame(layoutEditSlideId('title-body'), titleId, {
        x: 111,
        y: 222,
      });
    });

    // The real layout's title placeholder moved.
    const layout = real.read().layouts.find((l) => l.id === 'title-body')!;
    const titleSpec = layout.placeholders.find(
      (p) => p.placeholder.type === 'title',
    )!;
    expect(titleSpec.frame.x).toBe(111);
    expect(titleSpec.frame.y).toBe(222);

    // And the synthetic slide reflects it on the next read.
    const synthTitle = proxy
      .read()
      .slides[0].elements.find((e) => e.id === titleId)!;
    expect(synthTitle.frame.x).toBe(111);
    expect(synthTitle.frame.y).toBe(222);
  });

  it('updateElementFrame for an unknown element id is a no-op', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');
    const before = real.read().layouts;

    expect(() =>
      proxy.batch(() =>
        proxy.updateElementFrame('x', 'no-such-element', { x: 5 }),
      ),
    ).not.toThrow();
    expect(real.read().layouts).toEqual(before);
  });

  it('a frame edit is a single undo unit on the real store', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');
    const titleId = placeholderElementId(TITLE_REF);
    const originalX = real
      .read()
      .layouts.find((l) => l.id === 'title-body')!
      .placeholders.find((p) => p.placeholder.type === 'title')!.frame.x;

    proxy.batch(() => {
      proxy.updateElementFrame(layoutEditSlideId('title-body'), titleId, {
        x: 999,
      });
    });
    expect(proxy.canUndo()).toBe(true);

    proxy.undo();
    const restored = real
      .read()
      .layouts.find((l) => l.id === 'title-body')!
      .placeholders.find((p) => p.placeholder.type === 'title')!.frame.x;
    expect(restored).toBe(originalX);
  });

  it('structural mutations are guarded no-ops (no slide ever created)', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');

    proxy.batch(() => {
      const id = proxy.addElement(layoutEditSlideId('title-body'), {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      } as never);
      expect(id).toBe('');
      proxy.removeElement('x', 'y');
      proxy.removeElements('x', ['y']);
      proxy.addSlide('blank');
      proxy.applyLayout('x', 'blank');
    });

    // The real document still has zero persisted slides.
    expect(real.read().slides).toEqual([]);
  });

  it('setLayoutId switches which layout read() serves', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');
    expect(proxy.read().slides[0].id).toBe(layoutEditSlideId('title-body'));

    proxy.setLayoutId('big-number');
    expect(proxy.getLayoutId()).toBe('big-number');
    expect(proxy.read().slides[0].id).toBe(layoutEditSlideId('big-number'));
    expect(
      proxy.read().slides[0].elements.map((e) => e.placeholderRef?.type),
    ).toEqual(['big-number', 'body']);
  });

  it('delegates theme-builder mutations to the real store', () => {
    const real = new MemSlidesStore();
    const proxy = new LayoutEditStore(real, 'title-body');

    proxy.batch(() => {
      proxy.updateTheme('default-light', { colors: { accent1: '#ABCDEF' } });
    });
    expect(
      real.read().themes.find((t) => t.id === 'default-light')!.colors.accent1,
    ).toBe('#ABCDEF');
  });
});
