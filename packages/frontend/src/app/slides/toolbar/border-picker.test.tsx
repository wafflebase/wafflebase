import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dashArray, type Stroke } from '@wafflebase/slides';
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

    // Compared against `dashArray()` itself, not against today's two
    // literals: a preview that hardcoded `'6 4'` / `'2 2'` is exactly
    // the drift this design exists to prevent, and would pass a
    // hardcoded expectation unchanged.
    expect(lineIn(solid)?.getAttribute('stroke-dasharray')).toBeNull();
    expect(lineIn(dashed)?.getAttribute('stroke-dasharray')).toBe(
      dashArray('dashed', 1).join(' '),
    );
    expect(lineIn(dotted)?.getAttribute('stroke-dasharray')).toBe(
      dashArray('dotted', 1).join(' '),
    );
  });

  it('previews the dash at the border’s real weight', async () => {
    // The clamp this replaces drew every dash row at 3px, so the menu
    // promised a crisp dotted line and the canvas painted a bar. The
    // weight is now the real one; only the pattern is bounded, so the
    // preview still reports the thickness the canvas will stroke.
    renderPicker({ color: '#000', width: 16, dash: 'dotted' });
    await openDash();

    const dotted = screen.getByRole('menuitemcheckbox', { name: 'Dotted' });
    expect(Number(lineIn(dotted)?.getAttribute('stroke-width'))).toBe(16);

    // The pattern keeps `dashArray`'s dash:gap ratio rather than a
    // literal — hardcoding `'2 2'` is the drift this design prevents —
    // but is scaled to repeat inside the preview box.
    const [dash, gap] = lineIn(dotted)!
      .getAttribute('stroke-dasharray')!
      .split(' ')
      .map(Number);
    const [refDash, refGap] = dashArray('dotted', 16);
    expect(dash / gap).toBeCloseTo(refDash / refGap);
    // Two whole cycles inside the 64px preview, so a gap is visible at
    // all: unbounded, `dashArray('dotted', 16)` is `[32, 32]`, whose
    // first dash alone fills half the line and leaves it reading solid.
    expect(dash + gap).toBeLessThanOrEqual(32);
  });

  it('keeps Dashed visibly dashed at the largest weight', async () => {
    // At 16px `dashArray('dashed', 16)` is `[96, 64]` — one dash longer
    // than the whole 64px preview line, which painted the Dashed row as
    // an unbroken bar indistinguishable from Solid.
    renderPicker({ color: '#000', width: 16, dash: 'dashed' });
    await openDash();

    const dashed = screen.getByRole('menuitemcheckbox', { name: 'Dashed' });
    const [dash, gap] = lineIn(dashed)!
      .getAttribute('stroke-dasharray')!
      .split(' ')
      .map(Number);
    // A gap has to start and end inside the 64px box, not merely exist.
    expect(dash + gap).toBeLessThanOrEqual(32);
    expect(gap).toBeGreaterThan(0);
    // Still distinguishable from Dotted, whose ratio is 1:1.
    const [refDash, refGap] = dashArray('dashed', 16);
    expect(dash / gap).toBeCloseTo(refDash / refGap);
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

  it('checks nothing when the element has no border at all', async () => {
    // The default for every `filled` insert kind, and what the weight
    // menu's "No border" writes. Distinct from a solid border: checking
    // Solid here would assert an edge the shape does not have.
    renderPicker(undefined);
    await openDash();

    for (const name of ['Solid', 'Dashed', 'Dotted']) {
      expect(screen.getByRole('menuitemcheckbox', { name })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
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
    // Scaled to the row's own weight, not the element's — the row shows
    // what picking it would produce.
    expect(lineIn(four)?.getAttribute('stroke-dasharray')).toBe(
      dashArray('dotted', 4).join(' '),
    );
  });

  it('opts the preview out of the menu item svg clamp', async () => {
    // `DropdownMenuCheckboxItem` forces every descendant `<svg>` without
    // a `size-` class to `size-4`, which crushes a 64px-wide preview into
    // a 16px stub pinned to the item's left edge. jsdom applies no
    // Tailwind, so assert the opt-out the rule defines rather than the
    // rendered geometry.
    renderPicker({ color: '#000', width: 2, dash: 'solid' });
    await openWeight();

    // Reach the preview through its `<line>`, not `querySelector('svg')`:
    // a checked row also contains the indicator's check icon, which comes
    // first in DOM order and carries `size-4` — the very class this opts
    // out of. Matching `/size-/` against it passed while testing nothing.
    const svg = lineIn(screen.getByRole('menuitemcheckbox', { name: '2px' }))
      ?.ownerSVGElement;
    expect(svg?.getAttribute('class')).toBe('size-auto');
  });

  it('checks "No border" when the element has none', async () => {
    // The two menus describe one border and must agree about this
    // state: absent is a weight this menu writes, so it reports it.
    renderPicker(undefined);
    await openWeight();

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'No border' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: '1px' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps "No border" as words — it has no line to draw', async () => {
    renderPicker({ color: '#000', width: 1, dash: 'solid' });
    await openWeight();

    const none = screen.getByRole('menuitemcheckbox', { name: 'No border' });
    expect(lineIn(none)).toBeNull();
    expect(none).toHaveTextContent('No border');
  });
});
