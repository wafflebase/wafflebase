// @vitest-environment jsdom
/**
 * Regression test for the border color palette failing to auto-close on
 * selection.
 *
 * Issue: clicking a theme/standard swatch inside `BorderPicker`'s "Border
 * color" dropdown applied the color but left the palette open, because the
 * swatches are plain `<button>` elements and Radix only auto-closes on
 * `DropdownMenuItem` activation.
 *
 * Fix: make the wrapping `DropdownMenu` controlled and close it after
 * `ThemedColorPicker.onChange` fires.
 *
 * This is the representative slides-side test; sheets / docs use the same
 * pattern via `ColorPickerGrid`.
 *
 * JSX is avoided (matching the `tests/**\/*.test.ts` runner) — elements
 * are built with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TooltipProvider } from '../../../src/components/ui/tooltip.tsx';
import { BorderPicker } from '../../../src/app/slides/toolbar/border-picker.tsx';
import { getBuiltInTheme } from '@wafflebase/slides';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(h(TooltipProvider, null, ui));
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

function pointerClick(el: HTMLElement) {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  el.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

describe('BorderPicker — color palette auto-close', () => {
  test('palette closes after clicking a theme swatch', () => {
    const theme = getBuiltInTheme('default-light');
    const onChange = vi.fn();
    const el = render(
      h(BorderPicker, { value: undefined, theme, onChange }),
    );

    // Open the border color dropdown.
    const trigger = el.querySelector(
      '[aria-label="Border color"]',
    ) as HTMLElement;
    expect(trigger).toBeTruthy();
    act(() => pointerClick(trigger));

    // The themed picker mounts inside a Radix portal in document.body.
    const accent1Swatch = document.body.querySelector(
      '[aria-label="accent1"]',
    ) as HTMLElement | null;
    expect(accent1Swatch).toBeTruthy();

    act(() => pointerClick(accent1Swatch!));

    // onChange fires (color applied).
    expect(onChange).toHaveBeenCalled();

    // Palette must auto-close: the swatch should no longer be in the DOM.
    const stillOpen = document.body.querySelector('[aria-label="accent1"]');
    expect(stillOpen).toBeNull();
  });
});
