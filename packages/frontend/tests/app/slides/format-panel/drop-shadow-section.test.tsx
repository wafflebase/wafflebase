import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropShadowSection } from '@/app/slides/format-panel/drop-shadow-section';
import type { DropShadow, ShapeElement } from '@wafflebase/slides';

function shape(id: string, shadow?: DropShadow): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 60, rotation: 0 },
    data: { kind: 'rect', ...(shadow ? { effects: { shadow } } : {}) },
  };
}

const SHADOW: DropShadow = {
  color: '#000000',
  opacity: 0.4,
  angle: Math.PI / 4,
  distance: 8,
  blur: 8,
};

describe('DropShadowSection', () => {
  it('renders the toggle off with no shadow controls when absent', () => {
    const onCommit = vi.fn();
    render(<DropShadowSection elements={[shape('a')]} onCommit={onCommit} />);
    const toggle = screen.getByRole('checkbox');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Shadow transparency')).toBeNull();
  });

  it('enabling the toggle commits a default shadow to all selected ids', () => {
    const onCommit = vi.fn();
    render(
      <DropShadowSection
        elements={[shape('a'), shape('b')]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [ids, shadow] = onCommit.mock.calls[0];
    expect(ids).toEqual(['a', 'b']);
    expect(shadow).toMatchObject({ color: '#000000', opacity: 0.4 });
  });

  it('disabling the toggle commits undefined (removes the shadow)', () => {
    const onCommit = vi.fn();
    render(
      <DropShadowSection elements={[shape('a', SHADOW)]} onCommit={onCommit} />,
    );
    const toggle = screen.getByRole('checkbox');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onCommit).toHaveBeenCalledWith(['a'], undefined);
  });

  it('editing transparency commits a new opacity', () => {
    const onCommit = vi.fn();
    render(
      <DropShadowSection elements={[shape('a', SHADOW)]} onCommit={onCommit} />,
    );
    // opacity 0.4 ⇒ transparency 60; ArrowRight ⇒ 61 ⇒ opacity 0.39.
    fireEvent.keyDown(screen.getByLabelText('Shadow transparency'), {
      key: 'ArrowRight',
    });
    const [, shadow] = onCommit.mock.calls.at(-1)!;
    expect(shadow.opacity).toBeCloseTo(0.39);
  });
});
