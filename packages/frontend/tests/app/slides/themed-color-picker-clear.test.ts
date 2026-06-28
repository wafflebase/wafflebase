// @vitest-environment jsdom
/**
 * Tests for the optional "No fill" affordance in `ThemedColorPicker`.
 *
 * Fill-like call sites (shape fill, cell fill, slide background) pass an
 * `onClear` callback; the picker then renders a red-diagonal `NoneSwatch`
 * row at the top. Call sites with no meaningful "none" (e.g. text color)
 * omit `onClear` and the row is absent.
 *
 * JSX is avoided (matching the `tests/**\/*.test.ts` runner) — elements are
 * built with `React.createElement`.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ThemedColorPicker } from '../../../src/app/slides/themed-color-picker.tsx';
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

const theme = getBuiltInTheme('default-light');

describe('ThemedColorPicker — No fill affordance', () => {
  test('omits the clear row when onClear is not provided', () => {
    const el = render(
      h(ThemedColorPicker, { value: undefined, theme, onChange: vi.fn() }),
    );
    expect(el.querySelector('[data-clear-control]')).toBeNull();
  });

  test('renders a clear row and calls onClear when provided', () => {
    const onClear = vi.fn();
    const el = render(
      h(ThemedColorPicker, {
        value: { kind: 'srgb', value: '#ff0000' },
        theme,
        onChange: vi.fn(),
        onClear,
      }),
    );

    const clear = el.querySelector('[data-clear-control]') as HTMLElement;
    expect(clear).toBeTruthy();
    expect(clear.querySelector('[data-testid="none-swatch"]')).toBeTruthy();
    expect(clear.textContent).toContain('No fill');

    click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test('marks the clear row selected when value is undefined', () => {
    const el = render(
      h(ThemedColorPicker, {
        value: undefined,
        theme,
        onChange: vi.fn(),
        onClear: vi.fn(),
      }),
    );

    const clear = el.querySelector('[data-clear-control]') as HTMLElement;
    expect(clear.getAttribute('aria-pressed')).toBe('true');
  });
});
