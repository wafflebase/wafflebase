import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReflectionSection } from '@/app/slides/format-panel/reflection-section';
import type { Reflection, ShapeElement } from '@wafflebase/slides';

function shape(id: string, reflection?: Reflection): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 60, rotation: 0 },
    data: { kind: 'rect', ...(reflection ? { effects: { reflection } } : {}) },
  };
}

const REFLECTION: Reflection = { opacity: 0.5, distance: 0, size: 0.5 };

describe('ReflectionSection', () => {
  it('renders the toggle off with no controls when absent', () => {
    const onCommit = vi.fn();
    render(<ReflectionSection elements={[shape('a')]} onCommit={onCommit} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText('Reflection size')).toBeNull();
  });

  it('enabling commits a default reflection to all selected ids', () => {
    const onCommit = vi.fn();
    render(
      <ReflectionSection
        elements={[shape('a'), shape('b')]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    const [ids, reflection] = onCommit.mock.calls[0];
    expect(ids).toEqual(['a', 'b']);
    expect(reflection).toMatchObject({ opacity: 0.5, size: 0.5 });
  });

  it('disabling commits undefined (removes the reflection)', () => {
    const onCommit = vi.fn();
    render(
      <ReflectionSection
        elements={[shape('a', REFLECTION)]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCommit).toHaveBeenCalledWith(['a'], undefined);
  });

  it('editing size commits a new fraction', () => {
    const onCommit = vi.fn();
    render(
      <ReflectionSection
        elements={[shape('a', REFLECTION)]}
        onCommit={onCommit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Reflection size'), {
      target: { value: '80' },
    });
    const [, reflection] = onCommit.mock.calls.at(-1)!;
    expect(reflection.size).toBeCloseTo(0.8);
  });
});
