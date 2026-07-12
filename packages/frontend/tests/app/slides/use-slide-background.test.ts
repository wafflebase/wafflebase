import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemSlidesStore } from '@wafflebase/slides';
import type { GradientFill } from '@wafflebase/slides';
import { useSlideBackground } from '@/app/slides/use-slide-background.ts';

function fixture() {
  const store = new MemSlidesStore();
  let slideId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
  });
  const theme = store.read().themes[0];
  return { store, slideId, theme };
}

const grad: GradientFill = {
  kind: 'gradient',
  type: 'linear',
  angle: 0,
  stops: [
    { pos: 0, color: { kind: 'srgb', value: '#ff0000' } },
    { pos: 1, color: { kind: 'srgb', value: '#0000ff' } },
  ],
};

describe('useSlideBackground', () => {
  it('onChangeSolid writes { fill } and drops any existing image', () => {
    const { store, slideId, theme } = fixture();
    store.batch(() =>
      store.updateSlideBackground(slideId, { image: { src: 'https://x/before.png' } }),
    );

    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));
    act(() => {
      result.current.onChangeSolid({ kind: 'srgb', value: '#ff0000' }, { commit: true });
    });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.background).toEqual({ fill: { kind: 'srgb', value: '#ff0000' } });
  });

  it('onChangeSolid only records the color when opts.record is set on an srgb value', () => {
    const { store, slideId, theme } = fixture();
    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));

    act(() => {
      result.current.onChangeSolid({ kind: 'srgb', value: '#123456' });
    });
    expect(store.read().meta.recentColors ?? []).not.toContain('#123456');

    act(() => {
      result.current.onChangeSolid({ kind: 'srgb', value: '#abcdef' }, { record: true });
    });
    expect(store.read().meta.recentColors).toContain('#abcdef');
  });

  it('onChangeGradient with commit:false only updates the draft, no store write', () => {
    const { store, slideId, theme } = fixture();
    const before = store.read();
    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));

    act(() => {
      result.current.onChangeGradient(grad, { commit: false });
    });

    expect(store.read()).toEqual(before);
    expect(result.current.gradientDraft).toEqual(grad);
  });

  it('onChangeGradient with commit:true persists the gradient and clears the draft', () => {
    const { store, slideId, theme } = fixture();
    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));

    act(() => {
      result.current.onChangeGradient(grad, { commit: false });
    });
    expect(result.current.gradientDraft).toEqual(grad);

    act(() => {
      result.current.onChangeGradient(grad, { commit: true });
    });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.background).toEqual({ fill: grad });
    expect(result.current.gradientDraft).toBeNull();
  });

  it('onFlushGradientDraft persists a pending draft exactly once', () => {
    const { store, slideId, theme } = fixture();
    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));

    act(() => {
      result.current.onChangeGradient(grad, { commit: false });
    });
    act(() => {
      result.current.onFlushGradientDraft();
    });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.background).toEqual({ fill: grad });
    expect(result.current.gradientDraft).toBeNull();

    // No draft pending: a second flush is a no-op (no extra undo entry).
    const canUndoBefore = store.canUndo();
    act(() => {
      result.current.onFlushGradientDraft();
    });
    expect(store.canUndo()).toBe(canUndoBefore);
  });

  it('onChooseImage writes { image: { src } } and drops any existing fill', () => {
    const { store, slideId, theme } = fixture();
    store.batch(() =>
      store.updateSlideBackground(slideId, { fill: { kind: 'srgb', value: '#00ff00' } }),
    );

    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));
    act(() => {
      result.current.onChooseImage('https://x/y.png');
    });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    expect(slide.background).toEqual({ image: { src: 'https://x/y.png' } });
  });

  it('onRemoveImage and onResetToTheme both clear the background to {}', () => {
    const { store, slideId, theme } = fixture();
    store.batch(() =>
      store.updateSlideBackground(slideId, { image: { src: 'https://x/y.png' } }),
    );

    const { result } = renderHook(() => useSlideBackground(store, slideId, theme));
    act(() => {
      result.current.onRemoveImage();
    });
    expect(store.read().slides.find((s) => s.id === slideId)!.background).toEqual({});

    act(() => {
      store.batch(() =>
        store.updateSlideBackground(slideId, { fill: { kind: 'srgb', value: '#ff00ff' } }),
      );
    });
    act(() => {
      result.current.onResetToTheme();
    });
    expect(store.read().slides.find((s) => s.id === slideId)!.background).toEqual({});
  });

  it('resolves backgroundFill / backgroundImage from the slide, inherited when unset', () => {
    const { store, slideId, theme } = fixture();
    const { result, rerender } = renderHook(() => useSlideBackground(store, slideId, theme));
    // Blank layout / default master / theme resolve to a themed background
    // color by default (inherited, no explicit slide fill).
    expect(result.current.backgroundFill).toBeDefined();
    expect(result.current.backgroundImage).toBeUndefined();

    act(() => {
      store.batch(() =>
        store.updateSlideBackground(slideId, { image: { src: 'https://x/y.png' } }),
      );
    });
    rerender();
    expect(result.current.backgroundImage).toEqual({ src: 'https://x/y.png' });
  });

  it('resets the gradient draft when slideId changes', () => {
    const { store, slideId, theme } = fixture();
    let otherSlideId = '';
    store.batch(() => {
      otherSlideId = store.addSlide('blank');
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSlideBackground(store, id, theme),
      { initialProps: { id: slideId } },
    );
    act(() => {
      result.current.onChangeGradient(grad, { commit: false });
    });
    expect(result.current.gradientDraft).toEqual(grad);

    rerender({ id: otherSlideId });
    expect(result.current.gradientDraft).toBeNull();
  });
});
