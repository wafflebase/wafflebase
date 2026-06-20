import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecolorSection } from '@/app/slides/format-panel/recolor-section';
import type { ImageElement, ImageRecolor } from '@wafflebase/slides';

function img(id: string, recolor?: ImageRecolor): ImageElement {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { src: 'http://x', ...(recolor ? { recolor } : {}) },
  };
}

describe('RecolorSection', () => {
  const pressed = (name: string): string | null =>
    screen.getByRole('button', { name }).getAttribute('aria-pressed');

  it('marks "No recolor" pressed for a fresh image', () => {
    render(<RecolorSection elements={[img('a')]} onCommit={vi.fn()} />);
    expect(pressed('No recolor')).toBe('true');
  });

  it('marks the active preset pressed', () => {
    render(
      <RecolorSection elements={[img('a', 'sepia')]} onCommit={vi.fn()} />,
    );
    expect(pressed('Sepia')).toBe('true');
  });

  it('commits the chosen preset to all selected ids', () => {
    const onCommit = vi.fn();
    render(
      <RecolorSection elements={[img('a'), img('b')]} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Grayscale' }));
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 'grayscale');
  });

  it('shows none pressed when the selection mixes recolor values', () => {
    render(
      <RecolorSection
        elements={[img('a', 'grayscale'), img('b', 'sepia')]}
        onCommit={vi.fn()}
      />,
    );
    // Mixed → no preset reads as the common value, so none is pressed.
    expect(pressed('Grayscale')).toBe('false');
    expect(pressed('Sepia')).toBe('false');
  });
});
