// @vitest-environment jsdom
/**
 * Tests for the unified "None / Reset" affordance in `ColorPickerGrid`.
 *
 * The picker offers a single clear/none control rendered as a red-diagonal
 * `NoneSwatch`. Its label is context-aware: text-color call sites keep the
 * default "Reset" (restore default), while highlight / background call sites
 * pass `noneLabel="None"` (clear to transparent).
 *
 * JSX is avoided (matching the `tests/**\/*.test.ts` runner) — elements are
 * built with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ColorPickerGrid } from '../../src/components/color-picker-grid.tsx';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

function click(el: HTMLElement) {
  act(() =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
}

describe('ColorPickerGrid — None / Reset affordance', () => {
  test('defaults the clear control to "Reset" and calls onReset', () => {
    const onReset = vi.fn();
    const el = render(
      h(ColorPickerGrid, {
        colors: ['#000000', '#FFFFFF'],
        onSelect: vi.fn(),
        onReset,
      }),
    );

    const noneSwatch = el.querySelector('[data-testid="none-swatch"]');
    expect(noneSwatch).toBeTruthy();

    const clear = el.querySelector('[data-none-control]') as HTMLElement;
    expect(clear).toBeTruthy();
    expect(clear.textContent).toContain('Reset');

    click(clear);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test('honors a custom noneLabel for fill/highlight contexts', () => {
    const el = render(
      h(ColorPickerGrid, {
        colors: ['#000000'],
        onSelect: vi.fn(),
        onReset: vi.fn(),
        noneLabel: 'None',
      }),
    );

    const clear = el.querySelector('[data-none-control]') as HTMLElement;
    expect(clear.textContent).toContain('None');
  });
});
