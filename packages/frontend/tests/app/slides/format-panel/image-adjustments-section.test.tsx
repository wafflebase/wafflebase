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
      <ImageAdjustmentsSection
        elements={[img('a')]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/transparency/i) as HTMLInputElement).value,
    ).toBe('0');
  });

  it('shows 30% transparency when opacity = 0.7', () => {
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 0.7)]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/transparency/i) as HTMLInputElement).value,
    ).toBe('30');
  });

  it('commits opacity to all selected ids on pointerup', () => {
    const onCommit = vi.fn();
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1), img('b', 1)]}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByLabelText(/transparency/i);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 0.6);
  });

  it('commits opacity on keyup so keyboard adjustments (arrow / Home / End) reach the store', () => {
    const onCommit = vi.fn();
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1)]}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByLabelText(/transparency/i);
    // Keyboard adjustment fires onChange then keyup — no pointer event.
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.keyUp(slider, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenCalledWith(['a'], 0.75);
  });
});
