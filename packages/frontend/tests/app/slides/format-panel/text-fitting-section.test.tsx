import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextFittingSection } from '@/app/slides/format-panel/text-fitting-section';
import type { TextElement, AutofitMode } from '@wafflebase/slides';

function text(id: string, autofit?: AutofitMode): TextElement {
  return {
    id,
    type: 'text',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { blocks: [], autofit },
  };
}

describe('TextFittingSection', () => {
  it('selects the common autofit value (defaulting absent → "grow")', () => {
    render(
      <TextFittingSection
        elements={[text('a', undefined), text('b', 'grow')]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/resize shape to fit/i).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('no radio is checked when autofit differs across the selection', () => {
    render(
      <TextFittingSection
        elements={[text('a', 'grow'), text('b', 'shrink')]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(/do not autofit/i).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByLabelText(/shrink text/i).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByLabelText(/resize shape to fit/i).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('selecting a mode commits to every element id', () => {
    const onCommit = vi.fn();
    render(
      <TextFittingSection
        elements={[text('a', 'grow'), text('b', 'grow')]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/shrink text/i));
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 'shrink');
  });
});
