// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../src/shell/ui/dialog.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../src/shell/ui/popover.tsx';

/**
 * The two primitives 12 added or changed.
 *
 * `dialog` is new and holds the review modal — the surface that writes files, so its
 * dismissal rules matter: a drag that ends outside the panel must not discard the plan
 * the user was reading, and Escape must work because the modal covers the whole shell.
 *
 * `popover` gained CONTROLLED mode for `Combobox`, which opens on a keystroke rather than
 * on a click. The uncontrolled path is `tabs`/`popover`'s existing behaviour and is
 * covered in `ui.test.tsx`; what is pinned here is that the two modes do not leak into
 * each other.
 *
 * NOT COVERED: the `if (openProp === undefined)` guard around the internal setter. Removing
 * it changes nothing observable — `open = openProp ?? own` still reads the prop — so the
 * guard only avoids pointless state, and no assertion here can see it.
 */

let root: Root | null = null;

function render(ui: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');

describe('Dialog', () => {
  const ui = (open: boolean, onOpenChange = () => {}) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review</DialogTitle>
          <DialogDescription>two changes</DialogDescription>
        </DialogHeader>
        <p>body</p>
        <DialogFooter>
          <button type="button">Approve</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  it('renders nothing while closed', () => {
    render(ui(false));
    expect(panel()).toBeNull();
  });

  it('portals to document.body, past the pane it was declared in', () => {
    // The right pane has `overflow: hidden` and its own stacking context; a modal rendered
    // inside it would be clipped.
    const host = render(ui(true));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it('wires the title and description to the dialog for assistive tech', () => {
    render(ui(true));
    const p = panel()!;
    expect(document.getElementById(p.getAttribute('aria-labelledby')!)?.textContent).toBe('Review');
    expect(document.getElementById(p.getAttribute('aria-describedby')!)?.textContent).toBe(
      'two changes',
    );
  });

  it('takes focus on the PANEL, not on the first button', () => {
    // Landing on "Approve" invites an Enter that writes files; the plan is what to read first.
    render(ui(true));
    expect(document.activeElement).toBe(panel());
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(ui(true, onOpenChange));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on a backdrop mousedown', () => {
    const onOpenChange = vi.fn();
    render(ui(true, onOpenChange));
    const backdrop = panel()!.parentElement!;
    act(() => backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does NOT close when the mousedown started inside the panel', () => {
    // Selecting text in the diff drags to a point outside the panel; without the target
    // check that discards the plan mid-read.
    const onOpenChange = vi.fn();
    render(ui(true, onOpenChange));
    act(() => panel()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('refuses a part used outside its Dialog', () => {
    expect(() => render(<DialogTitle>x</DialogTitle>)).toThrow(/must be inside <Dialog>/);
  });
});

describe('Popover — controlled mode', () => {
  it('follows the open prop and never manages its own state', () => {
    const onOpenChange = vi.fn();
    const host = render(
      <Popover open={false} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    act(() =>
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    // Reported, not applied: the owner decides.
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(host.textContent).not.toContain('list');
  });

  it('opens when the owner says so, with no click at all', () => {
    // `Combobox` opens on a keystroke; a click-only popover could not serve it.
    const host = render(
      <Popover open onOpenChange={() => {}}>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    expect(host.textContent).toContain('list');
  });

  it('still self-manages when neither prop is given', () => {
    const host = render(
      <Popover>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    act(() =>
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(host.textContent).toContain('list');
  });

  it('applies sideOffset instead of the default margin', () => {
    const host = render(
      <Popover open onOpenChange={() => {}}>
        <PopoverTrigger asChild>
          <button>o</button>
        </PopoverTrigger>
        <PopoverContent sideOffset={4}>list</PopoverContent>
      </Popover>,
    );
    const content = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(content.style.marginTop).toBe('4px');
    expect(content.className).not.toContain('mt-1');
  });

  it('matches the trigger width when asked, and leaves it alone otherwise', () => {
    // jsdom reports 0 for every box, so the assertion is that the property is only ever
    // written from a REAL measurement — a hardcoded fallback would show up here as a value.
    const host = render(
      <Popover open onOpenChange={() => {}}>
        <PopoverTrigger asChild>
          <button>o</button>
        </PopoverTrigger>
        <PopoverContent matchTriggerWidth>list</PopoverContent>
      </Popover>,
    );
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.style.minWidth).toBe('');
  });
});

/**
 * A ref callback whose identity changes is detached and reattached by React on every
 * render, and `PopoverTrigger`'s reads layout. MEASURED before memoising: 60 parent
 * renders produced 60 `getBoundingClientRect()` calls — one per render, per popover.
 * `App` re-renders on `onHover` while the pointer moves over the frame and holds three
 * popovers, so that was ~3 forced layout reads per pointer event. Free in jsdom; not in
 * a browser.
 *
 * Pinned as a NUMBER rather than as "is memoised", because the thing that matters is the
 * layout read, and a future refactor can reintroduce it without touching `useCallback`.
 */
describe('the trigger does not re-measure on every parent render', () => {
  it('reads layout once at mount and not again while the parent re-renders', () => {
    let rects = 0;
    const proto = window.HTMLElement.prototype;
    const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      rects++;
      return { width: 120, height: 20, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      let bump: (n: number) => void = () => {};
      function Parent() {
        const [n, setN] = useState(0);
        bump = setN;
        return (
          <div data-n={n}>
            <Popover>
              <PopoverTrigger>open</PopoverTrigger>
              <PopoverContent>body</PopoverContent>
            </Popover>
          </div>
        );
      }
      render(<Parent />);
      const afterMount = rects;
      // Separate act() per update: one render each, the way a pointer-move stream arrives.
      // Batched into a single act() they collapse to one render and measure nothing.
      for (let i = 1; i <= 20; i++) act(() => bump(i));
      expect(rects - afterMount).toBe(0);
    } finally {
      proto.getBoundingClientRect = orig;
    }
  });
});
