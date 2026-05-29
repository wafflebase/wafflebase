import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AltTextSection } from '@/app/slides/format-panel/alt-text-section';
import type { ImageElement } from '@wafflebase/slides';

function img(id: string, alt: string): ImageElement {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { src: 'http://x', alt },
  };
}

describe('AltTextSection', () => {
  it('shows the common alt text for a single selection', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection elements={[img('a', 'hello')]} onCommit={onCommit} />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'hello',
    );
  });

  it('shows empty placeholder when alt differs across selection', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', 'one'), img('b', 'two')]}
        onCommit={onCommit}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('commits the new value on blur to all selected ids', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', ''), img('b', '')]}
        onCommit={onCommit}
      />,
    );
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'new alt' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 'new alt');
  });

  it('blank → blur is a no-op (onCommit not called)', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', 'one'), img('b', 'two')]}
        onCommit={onCommit}
      />,
    );
    const ta = screen.getByRole('textbox');
    fireEvent.blur(ta);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
