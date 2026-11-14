import { act, render } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProviderContext } from '@/components/theme-provider';
import { Toaster } from '../sonner';

function renderToaster(resolvedTheme: 'light' | 'dark') {
  return render(
    <ThemeProviderContext.Provider
      value={{ theme: 'system', resolvedTheme, setTheme: () => {} }}
    >
      <Toaster />
    </ThemeProviderContext.Provider>,
  );
}

describe('Toaster', () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it.each(['light', 'dark'] as const)(
    'follows the app theme (%s), not Sonner’s light default',
    async (resolvedTheme) => {
      const { container } = renderToaster(resolvedTheme);
      act(() => {
        toast('Saved');
      });
      const toaster = await new Promise<HTMLElement | null>((resolve) =>
        setTimeout(
          () =>
            resolve(
              container.ownerDocument.querySelector<HTMLElement>(
                '[data-sonner-toaster]',
              ),
            ),
          0,
        ),
      );
      expect(toaster?.getAttribute('data-sonner-theme')).toBe(resolvedTheme);
    },
  );

  it('points the toast surface at the popover tokens', async () => {
    const { container } = renderToaster('dark');
    act(() => {
      toast('Saved');
    });
    await new Promise((r) => setTimeout(r, 0));
    const toaster = container.ownerDocument.querySelector<HTMLElement>(
      '[data-sonner-toaster]',
    );
    expect(toaster?.style.getPropertyValue('--normal-bg')).toBe('var(--popover)');
    expect(toaster?.style.getPropertyValue('--normal-text')).toBe(
      'var(--popover-foreground)',
    );
    expect(toaster?.style.getPropertyValue('--normal-border')).toBe('var(--border)');
  });
});
