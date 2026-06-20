// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showContextMenu, dismiss } from '../../../src/view/editor/context-menu';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showContextMenu', () => {
  it('mounts a list of items at the anchor point', () => {
    const items = [
      { label: 'Copy', run: vi.fn() },
      { label: 'Delete', run: vi.fn() },
    ];
    showContextMenu(document.body, items, 100, 50);
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    expect(menu).toBeTruthy();
    expect(menu.children).toHaveLength(2);
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('50px');
  });

  it('clicking an item runs its handler and dismisses the menu', () => {
    const run = vi.fn();
    showContextMenu(document.body, [{ label: 'X', run }], 0, 0);
    const item = document.body.querySelector<HTMLLIElement>(
      '.wfb-slides-context-menu li',
    )!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('clicking outside dismisses the menu', async () => {
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 0, 0);
    // Outside-click listener is attached via setTimeout(..., 0) so the
    // showing right-click doesn't immediately dismiss its own menu.
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('Escape dismisses', async () => {
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 0, 0);
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('only one menu can be open at a time', () => {
    showContextMenu(document.body, [{ label: 'A', run: vi.fn() }], 0, 0);
    showContextMenu(document.body, [{ label: 'B', run: vi.fn() }], 0, 0);
    expect(
      document.body.querySelectorAll('.wfb-slides-context-menu'),
    ).toHaveLength(1);
    expect(
      document.body.querySelector('.wfb-slides-context-menu li')!.textContent,
    ).toBe('B');
  });

  it('renders a separator for "---" items without click handlers', () => {
    const run = vi.fn();
    showContextMenu(
      document.body,
      [
        { label: 'A', run: vi.fn() },
        { label: '---', run },
        { label: 'B', run: vi.fn() },
      ],
      0,
      0,
    );
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    // 3 children: A, separator, B.
    expect(menu.children).toHaveLength(3);
    // Separator has no text label and clicking it should NOT run.
    const sep = menu.children[1] as HTMLLIElement;
    expect(sep.textContent).toBe('');
    sep.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).not.toHaveBeenCalled();
    // Menu still open after clicking the separator.
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeTruthy();
  });

  it('rapid right-clicks do not leak listeners onto document', async () => {
    // Repro: a second showContextMenu before the first menu's
    // setTimeout(0) fires would dismiss the first synchronously while
    // its addEventListener for `mousedown`/`keydown` was still pending
    // — then both menus' listeners would attach but the first menu's
    // had no cleanup pointer, leaking listeners that called dismiss()
    // on the (now-second) menu.
    const addSpy = vi.spyOn(document, 'addEventListener');
    showContextMenu(document.body, [{ label: 'A', run: vi.fn() }], 0, 0);
    showContextMenu(document.body, [{ label: 'B', run: vi.fn() }], 0, 0);
    // Drain the pending setTimeout(0) callbacks. Only the second
    // menu's attach should run — the first's must have been cleared.
    await new Promise((r) => setTimeout(r, 0));
    const documentPointerdownAttaches = addSpy.mock.calls.filter(
      ([type]) => type === 'pointerdown',
    );
    expect(documentPointerdownAttaches).toHaveLength(1);
    addSpy.mockRestore();
    // Menu B is still mounted and a single outside click cleanly
    // dismisses it without leftover listener noise.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('flips up/left of the anchor when it would overflow the viewport', () => {
    // jsdom defaults: window.innerWidth=1024, innerHeight=768 and
    // getBoundingClientRect() returns zeros. Stub the rect so the menu
    // reports a real size and the edge logic has something to react to.
    const rectSpy = vi
      .spyOn(HTMLUListElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        width: 200,
        height: 300,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

    // Anchor near the bottom-right corner: 1000px right, 700px down.
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 1000, 700);
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    // Flipped left: 1000 - 200 = 800; flipped up: 700 - 300 = 400.
    expect(menu.style.left).toBe('800px');
    expect(menu.style.top).toBe('400px');
    rectSpy.mockRestore();
  });

  it('clamps to the edge when the menu is too large to flip', () => {
    const rectSpy = vi
      .spyOn(HTMLUListElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        width: 200,
        height: 300,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

    // Anchor near the right edge but with too little room to flip
    // fully (1000 - 200 = 800 fits, so use a tighter anchor): pick
    // an x where flipping would push left below the 8px margin.
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 1020, 10);
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    // 1020 + 200 = 1220 > 1024-8 → flip: 1020 - 200 = 820, still
    // within viewport so stays 820. Top 10 fits (10 + 300 = 310 < 760).
    expect(menu.style.left).toBe('820px');
    expect(menu.style.top).toBe('10px');
    rectSpy.mockRestore();
  });

  it('disabled items do not run when clicked', () => {
    const run = vi.fn();
    showContextMenu(
      document.body,
      [{ label: 'X', run, disabled: true }],
      0,
      0,
    );
    const item = document.body.querySelector<HTMLLIElement>(
      '.wfb-slides-context-menu li',
    )!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('showContextMenu — selected indicator', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    dismiss();
    host.remove();
  });

  it('prefixes selected items with a check-mark glyph (radio group)', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined, selected: true },
      { label: 'Middle', run: () => undefined, selected: false },
      { label: 'Bottom', run: () => undefined, selected: false },
    ], 0, 0);
    const items = Array.from(host.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(items[0]).toMatch(/^✓\s/);
    expect(items[1]).toMatch(/^\s{3}/);
    expect(items[2]).toMatch(/^\s{3}/);
  });

  it('does not indent unrelated items when a radio group is present', () => {
    showContextMenu(host, [
      { label: 'Copy',   run: () => undefined },
      { label: 'Cut',    run: () => undefined },
      { label: '---',    run: () => undefined },
      { label: 'Top',    run: () => undefined, selected: true },
      { label: 'Middle', run: () => undefined, selected: false },
    ], 0, 0);
    const items = Array.from(host.querySelectorAll('li'))
      .filter((li) => li.textContent && li.textContent.trim() !== '')
      .map((li) => li.textContent ?? '');
    expect(items.find((t) => t.includes('Copy'))).toBe('Copy');
    expect(items.find((t) => t.includes('Cut'))).toBe('Cut');
    expect(items.find((t) => t.startsWith('✓'))).toMatch(/^✓ Top/);
    expect(items.find((t) => t.includes('Middle'))).toMatch(/^\s{3}Middle/);
  });

  it('omits the check-mark glyph entirely when no item is selected', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined },
      { label: 'Middle', run: () => undefined },
    ], 0, 0);
    for (const li of host.querySelectorAll('li')) {
      expect(li.textContent ?? '').not.toMatch(/^✓/);
    }
  });

  it('still fires run() when a selected item is clicked', () => {
    const handler = vi.fn();
    showContextMenu(host, [
      { label: 'Top', run: handler, selected: true },
    ], 0, 0);
    const li = host.querySelector('li')!;
    li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
