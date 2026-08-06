import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrangeMenu, type ArrangeMenuProps } from './arrange-menu';
import { TooltipProvider } from '@/components/ui/tooltip';

/** ArrangeMenu's trigger is wrapped in a Radix `Tooltip`, which throws
 * without an ancestor `TooltipProvider`. */
function renderArrangeMenu(props: ArrangeMenuProps) {
  return render(
    <TooltipProvider>
      <ArrangeMenu {...props} />
    </TooltipProvider>,
  );
}

/**
 * The Align submenu trigger is the observable proxy for `canAlign` — it and
 * every item under it share the same disabled flag. Radix marks a disabled
 * menu item with `data-disabled=""`; it is simply absent when enabled (no
 * `@testing-library/jest-dom` in this repo, so we read the attribute
 * directly rather than using a `toHaveAttribute` matcher).
 */
async function openArrange() {
  await userEvent.click(screen.getByRole('button', { name: /arrange/i }));
}

function alignTrigger() {
  return screen.getByText('Align');
}

describe('ArrangeMenu minAlignSelection', () => {
  it('enables Align at a single selection by default (slides behavior)', async () => {
    renderArrangeMenu({ editor: {} as never, selectionSize: 1 });
    await openArrange();
    expect(alignTrigger().hasAttribute('data-disabled')).toBe(false);
  });

  it('disables Align at a single selection when minAlignSelection is 2', async () => {
    renderArrangeMenu({ editor: {} as never, selectionSize: 1, minAlignSelection: 2 });
    await openArrange();
    expect(alignTrigger().hasAttribute('data-disabled')).toBe(true);
  });

  it('enables Align at two selected elements when minAlignSelection is 2', async () => {
    renderArrangeMenu({ editor: {} as never, selectionSize: 2, minAlignSelection: 2 });
    await openArrange();
    expect(alignTrigger().hasAttribute('data-disabled')).toBe(false);
  });
});
