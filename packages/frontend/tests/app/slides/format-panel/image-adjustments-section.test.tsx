import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageAdjustmentsSection } from '@/app/slides/format-panel/image-adjustments-section';
import type { ImageElement } from '@wafflebase/slides';

function img(id: string, opacity?: number): ImageElement {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { src: 'http://x', opacity },
  };
}

describe('ImageAdjustmentsSection', () => {
  it('renders the transparency slider', () => {
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1)]}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/transparency/i)).toBeTruthy();
  });

  it('shows 0% transparency when opacity is undefined or 1', () => {
    render(
      <ImageAdjustmentsSection elements={[img('a')]} onCommit={vi.fn()} />,
    );
    expect(
      screen.getByLabelText(/transparency/i).getAttribute('aria-valuenow'),
    ).toBe('0');
  });

  it('shows 30% transparency when opacity = 0.7', () => {
    render(
      <ImageAdjustmentsSection elements={[img('a', 0.7)]} onCommit={vi.fn()} />,
    );
    expect(
      screen.getByLabelText(/transparency/i).getAttribute('aria-valuenow'),
    ).toBe('30');
  });

  it('commits opacity to all selected ids on a keyboard slider step', () => {
    const onCommit = vi.fn();
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1), img('b', 1)]}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByLabelText(/transparency/i);
    // opacity 1 ⇒ transparency 0; ArrowRight steps to 1 ⇒ opacity 0.99.
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalled();
    const [ids, patch] = onCommit.mock.calls.at(-1)!;
    expect(ids).toEqual(['a', 'b']);
    expect(patch.opacity).toBeCloseTo(0.99);
  });

  it('commits brightness and contrast through their own sliders', () => {
    const onCommit = vi.fn();
    render(
      <ImageAdjustmentsSection elements={[img('a', 1)]} onCommit={onCommit} />,
    );
    fireEvent.keyDown(screen.getByLabelText(/brightness/i), {
      key: 'ArrowRight',
    });
    expect(onCommit.mock.calls.at(-1)![1].brightness).toBeCloseTo(0.01);
    fireEvent.keyDown(screen.getByLabelText(/contrast/i), {
      key: 'ArrowRight',
    });
    expect(onCommit.mock.calls.at(-1)![1].contrast).toBeCloseTo(0.01);
  });
});
