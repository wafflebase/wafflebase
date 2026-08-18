// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../src/shell/ui/tabs.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../src/shell/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../src/shell/ui/select.tsx';

/**
 * The shell's three local primitives, standing in for the consumer's shadcn ones.
 *
 * These are tested because two of them can fail SILENTLY in ways a type-check cannot
 * see: `Select` reads its options out of its own children as DATA, so a shape change
 * yields an empty dropdown rather than an error, and `Popover`'s `asChild` clones the
 * caller's element, so dropping their handler or their classes looks like nothing
 * happened. The ported call sites are pinned here too, so a later rewrite of the
 * layout cannot quietly change what the widgets receive.
 */

let root: Root | null = null;
let host: HTMLElement;

function render(ui: React.ReactNode) {
  host = document.createElement('div');
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

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('Tabs', () => {
  // The layout's own shape: `defaultValue`, three triggers, a panel per tab.
  const ui = (
    <Tabs defaultValue="layout" className="flex">
      <TabsList className="w-full">
        <TabsTrigger value="layout" className="flex-1 data-[state=active]:bg-wb-accent">
          Layout
        </TabsTrigger>
        <TabsTrigger value="tokens">Token Editor</TabsTrigger>
      </TabsList>
      <TabsContent value="layout">outline</TabsContent>
      <TabsContent value="tokens">tokens</TabsContent>
    </Tabs>
  );

  it('shows only the default panel', () => {
    const el = render(ui);
    expect(el.textContent).toContain('outline');
    expect(el.textContent).not.toContain('tokens panel');
    expect(el.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });

  it('emits data-state, which the ported classes style on', () => {
    // `data-[state=active]:…` is compiled into the shell bundle from those call sites,
    // so a trigger that does not render `data-state` styles as nothing.
    const el = render(ui);
    const [first, second] = [...el.querySelectorAll('[role="tab"]')];
    expect(first.getAttribute('data-state')).toBe('active');
    expect(second.getAttribute('data-state')).toBe('inactive');
  });

  it('switches the panel and unmounts the old one', () => {
    const el = render(ui);
    click(el.querySelectorAll('[role="tab"]')[1]);
    expect(el.textContent).toContain('tokens');
    // Unmounted rather than hidden: a hidden panel keeps measuring, and these panels
    // render scene outlines and token previews.
    expect(el.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });

  it('refuses a part used outside its Tabs', () => {
    // Silently rendering nothing would look like an empty panel.
    expect(() => render(<TabsTrigger value="x">x</TabsTrigger>)).toThrow(/must be inside <Tabs>/);
  });
});

describe('Popover', () => {
  it('keeps the caller’s own element, classes and handler under asChild', () => {
    // The header passes its own styled button; a wrapper would break the flex layout
    // and move the classes off the real control.
    let ownClicks = 0;
    const el = render(
      <Popover>
        <PopoverTrigger asChild>
          <button className="rounded-full px-2" title="stale" onClick={() => ownClicks++}>
            3 stale
          </button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    const btn = el.querySelector('button')!;
    expect(btn.className).toBe('rounded-full px-2');
    expect(btn.getAttribute('title')).toBe('stale');

    click(btn);
    expect(ownClicks).toBe(1);
    expect(el.textContent).toContain('list');
  });

  it('closes on an outside pointerdown', () => {
    const el = render(
      <Popover>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    click(el.querySelector('button')!);
    expect(el.textContent).toContain('list');
    // `pointerdown`, not `click`, so dismissing does not also activate what is under it.
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(el.textContent).not.toContain('list');
  });

  it('closes on Escape', () => {
    const el = render(
      <Popover>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>list</PopoverContent>
      </Popover>,
    );
    click(el.querySelector('button')!);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(el.textContent).not.toContain('list');
  });

  it('does not close on a pointerdown inside its own panel', () => {
    const el = render(
      <Popover>
        <PopoverTrigger asChild>
          <button>open</button>
        </PopoverTrigger>
        <PopoverContent>
          <button>inside</button>
        </PopoverContent>
      </Popover>,
    );
    click(el.querySelector('button')!);
    const inside = [...el.querySelectorAll('button')].find((b) => b.textContent === 'inside')!;
    act(() => inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(el.textContent).toContain('inside');
  });
});

describe('Select', () => {
  // `SceneHost`'s zoom dropdown, verbatim in shape — including the `.map()`, which is
  // why the option walk has to be recursive rather than a single `Children` pass.
  const ZOOMS = [0.5, 0.75, 1];
  const ui = (onChange: (v: string) => void) => (
    <Select value="0.75" onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-[26px] font-mono" title="Zoom">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ZOOMS.map((z) => (
          <SelectItem key={z} value={String(z)}>
            {z * 100}%
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  it('renders one option per item, through the wrapper and the map', () => {
    // The failure this pins is an EMPTY dropdown: the items are read as data, so a
    // shape change yields no options rather than an error.
    const el = render(ui(() => {}));
    const opts = [...el.querySelectorAll('option')];
    expect(opts.map((o) => o.getAttribute('value'))).toEqual(['0.5', '0.75', '1']);
    expect(opts.map((o) => o.textContent)).toEqual(['50%', '75%', '100%']);
  });

  it('reflects the controlled value and reports a change', () => {
    let got = '';
    const el = render(ui((v) => (got = v)));
    const sel = el.querySelector('select')!;
    expect(sel.value).toBe('0.75');
    act(() => {
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(got).toBe('1');
  });

  it('carries the trigger’s className and title onto the control', () => {
    // The trigger does not render, so its props have to be found and moved; losing
    // them silently leaves an unstyled dropdown in the header.
    const el = render(ui(() => {}));
    const sel = el.querySelector('select')!;
    expect(sel.className).toContain('h-[26px]');
    expect(sel.getAttribute('title')).toBe('Zoom');
  });
});
