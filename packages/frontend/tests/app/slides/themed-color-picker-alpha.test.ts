// @vitest-environment jsdom
/**
 * Tests for the optional Transparency (alpha) slider in `ThemedColorPicker`.
 *
 * Mirroring Google Slides, fill-like call sites (shape fill, border, cell
 * fill, slide background) opt in with `allowAlpha`; the picker then renders
 * a Transparency slider in the Custom section. Text-color contexts omit it.
 * The slider is disabled when there is no current color to make transparent.
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

const theme = getBuiltInTheme('default-light');

describe('ThemedColorPicker — Transparency slider', () => {
  test('omits the slider when allowAlpha is not set', () => {
    const el = render(
      h(ThemedColorPicker, {
        value: { kind: 'srgb', value: '#ff0000' },
        theme,
        onChange: vi.fn(),
      }),
    );
    expect(el.querySelector('[data-alpha-control]')).toBeNull();
  });

  test('renders the Transparency slider when allowAlpha is set', () => {
    const el = render(
      h(ThemedColorPicker, {
        value: { kind: 'srgb', value: '#ff0000', alpha: 0.4 },
        theme,
        onChange: vi.fn(),
        allowAlpha: true,
      }),
    );
    const control = el.querySelector('[data-alpha-control]') as HTMLElement;
    expect(control).toBeTruthy();
    // Shows the transparency percentage (alpha 0.4 ⇒ 60%).
    expect(control.textContent).toContain('60%');
  });

  test('commits alpha via onChange, preserving the color kind', () => {
    const onChange = vi.fn();
    const el = render(
      h(ThemedColorPicker, {
        // 60% transparent ⇒ alpha 0.4.
        value: { kind: 'srgb', value: '#ff0000', alpha: 0.4 },
        theme,
        onChange,
        allowAlpha: true,
      }),
    );

    const thumb = el.querySelector(
      '[data-alpha-control] [role="slider"]',
    ) as HTMLElement;
    expect(thumb).toBeTruthy();

    // ArrowRight raises transparency one step (60→61%) and Radix commits the
    // keyboard change immediately → onChange fires with the lowered alpha.
    act(() => {
      thumb.focus();
      thumb.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls.at(-1)![0];
    expect(arg.kind).toBe('srgb');
    expect(arg.value).toBe('#ff0000');
    // 61% transparent ⇒ alpha 0.39 (more transparent ⇒ lower alpha).
    expect(arg.alpha).toBeCloseTo(0.39, 5);
  });

  test('disables the slider when there is no current color', () => {
    const el = render(
      h(ThemedColorPicker, {
        value: undefined,
        theme,
        onChange: vi.fn(),
        allowAlpha: true,
      }),
    );
    // Radix marks the disabled slider root with a `data-disabled` attribute.
    const slider = el.querySelector(
      '[data-alpha-control] [data-slot="slider"]',
    ) as HTMLElement | null;
    expect(slider).toBeTruthy();
    expect(slider!.hasAttribute('data-disabled')).toBe(true);
  });
});
