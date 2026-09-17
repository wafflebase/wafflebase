import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Stroke } from '@wafflebase/slides';
import { BorderPicker } from './border-picker';
import { TooltipProvider } from '@/components/ui/tooltip';

function renderPicker(value?: Stroke, onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <BorderPicker value={value} onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
}

/** The drawn line inside a menu item, or null when the item has none. */
function lineIn(item: HTMLElement): SVGLineElement | null {
  return item.querySelector('line');
}

describe('BorderPicker dash menu', () => {
  async function openDash() {
    await userEvent.click(screen.getByRole('button', { name: /border dash/i }));
  }

  it('previews each style with the pattern the renderer strokes', async () => {
    renderPicker({ color: '#000', width: 1, dash: 'solid' });
    await openDash();

    // The items are named by aria-label — the SVG preview is aria-hidden,
    // so removing the text labels must not cost the accessible name.
    const solid = screen.getByRole('menuitemcheckbox', { name: 'Solid' });
    const dashed = screen.getByRole('menuitemcheckbox', { name: 'Dashed' });
    const dotted = screen.getByRole('menuitemcheckbox', { name: 'Dotted' });

    // `dashArray()` values, not lookalikes invented for the picker.
    expect(lineIn(solid)?.getAttribute('stroke-dasharray')).toBeNull();
    expect(lineIn(dashed)?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(lineIn(dotted)?.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('keeps the dash preview legible when the border is thick', async () => {
    // A [2,2] pattern stroked at 16px reads as a solid bar, so the dash
    // menu clamps the weight it previews.
    renderPicker({ color: '#000', width: 16, dash: 'dotted' });
    await openDash();

    const dotted = screen.getByRole('menuitemcheckbox', { name: 'Dotted' });
    // Exact, not `<= 3`: a missing attribute reads as 0, which would
    // satisfy an upper bound while drawing nothing.
    expect(Number(lineIn(dotted)?.getAttribute('stroke-width'))).toBe(3);
    // Still dotted, just thinner.
    expect(lineIn(dotted)?.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('checks Solid when the stroke carries no dash', async () => {
    // Optional in the model: PPTX import never sets it and older stored
    // strokes predate it. Such a border renders solid, so the menu has
    // to say Solid — with the text labels gone, nothing else would.
    renderPicker({ color: '#000', width: 1 });
    await openDash();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Solid' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('marks the active style and emits the picked one', async () => {
    const onChange = renderPicker({ color: '#000', width: 2, dash: 'dashed' });
    await openDash();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Dashed' }),
    ).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dotted' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dash: 'dotted', width: 2 }),
    );
  });
});

describe('BorderPicker weight menu', () => {
  async function openWeight() {
    await userEvent.click(screen.getByRole('button', { name: /border weight/i }));
  }

  it('draws each weight at its real thickness', async () => {
    renderPicker({ color: '#000', width: 1, dash: 'solid' });
    await openWeight();

    for (const w of [1, 2, 4, 8, 16]) {
      const item = screen.getByRole('menuitemcheckbox', { name: `${w}px` });
      expect(Number(lineIn(item)?.getAttribute('stroke-width'))).toBe(w);
    }
  });

  it('carries the current dash into the weight previews', async () => {
    // The two menus describe one border; a weight preview drawn solid
    // while the border is dotted would misreport what the click produces.
    renderPicker({ color: '#000', width: 2, dash: 'dotted' });
    await openWeight();

    const four = screen.getByRole('menuitemcheckbox', { name: '4px' });
    expect(lineIn(four)?.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('opts the preview out of the menu item svg clamp', async () => {
    // `DropdownMenuCheckboxItem` forces every descendant `<svg>` without
    // a `size-` class to `size-4`, which crushes a 64px-wide preview into
    // a 16px stub pinned to the item's left edge. jsdom applies no
    // Tailwind, so assert the opt-out the rule defines rather than the
    // rendered geometry.
    renderPicker({ color: '#000', width: 2, dash: 'solid' });
    await openWeight();

    const svg = screen
      .getByRole('menuitemcheckbox', { name: '2px' })
      .querySelector('svg');
    expect(svg?.getAttribute('class')).toMatch(/size-/);
  });

  it('keeps "No border" as words — it has no line to draw', async () => {
    renderPicker({ color: '#000', width: 1, dash: 'solid' });
    await openWeight();

    const none = screen.getByRole('menuitemcheckbox', { name: 'No border' });
    expect(lineIn(none)).toBeNull();
    expect(none).toHaveTextContent('No border');
  });
});
