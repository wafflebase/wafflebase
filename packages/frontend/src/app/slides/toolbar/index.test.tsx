/**
 * `SlidesToolbar` focus-release wiring — issue #882.
 *
 * `toolbar-focus-release.test.tsx` covers the hook's behaviour against a
 * hand-written toolbar. These tests cover the other half: that the *real*
 * desktop toolbar is actually wired to it — the root carries the
 * `CANVAS_TOOLBAR_ATTR` opt-in, and the hook is mounted so a real toolbar
 * button hands the keyboard back after a click. Without them the fix could
 * be silently unwired (attribute dropped, hook removed, or
 * `Toolbar` stopping its `{...props}` spread) with a green suite.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SlidesStore } from '@wafflebase/slides';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CANVAS_TOOLBAR_ATTR } from '@/components/toolbar-focus-release';
import { SlidesToolbar } from './index';

// jsdom ships no matchMedia; the toolbar reads it through `useIsMobile()` to
// choose between the desktop shell (which carries the opt-in) and the mobile
// one (which does not). `matches: false` + jsdom's 1024px width = desktop.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * The smallest store that leaves Undo enabled and clickable — that button
 * is the real toolbar control this test drives. `editor` stays `null`, so
 * `getToolbarState` reports `idle` and the contextual middle renders the
 * (disabled) Insert group only.
 */
function stubStore(): SlidesStore {
  return {
    canUndo: () => true,
    canRedo: () => true,
    undo: () => {},
    redo: () => {},
    read: () => ({ slides: [] }),
  } as unknown as SlidesStore;
}

/** `SlidesToolbar`'s buttons sit in Radix `Tooltip`s, which need a provider. */
function renderToolbar() {
  return render(
    <TooltipProvider>
      <SlidesToolbar editor={null} store={stubStore()} onImagePick={() => {}} />
    </TooltipProvider>,
  );
}

describe('SlidesToolbar canvas focus release', () => {
  it('marks its root with the canvas-toolbar opt-in attribute', () => {
    const { container } = renderToolbar();
    expect(container.querySelector(`[${CANVAS_TOOLBAR_ATTR}]`)).not.toBeNull();
  });

  it('releases focus to the body after a real toolbar button is clicked', async () => {
    renderToolbar();
    const undo = screen.getByRole('button', { name: 'Undo' });
    await userEvent.click(undo);
    // The hook is mounted by SlidesToolbar itself: focus must not stay on
    // the button, or every canvas shortcut stays gated (issue #882).
    await waitFor(() => expect(document.activeElement).toBe(document.body));
  });
});
