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

  const checkOf = (li: Element) => li.querySelector('svg[aria-label="Selected"]');

  it('draws a check icon in a leading slot for the selected item (radio group)', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined, selected: true },
      { label: 'Middle', run: () => undefined, selected: false },
      { label: 'Bottom', run: () => undefined, selected: false },
    ], 0, 0);
    const items = Array.from(host.querySelectorAll('li'));
    // Labels are plain text — the check is an icon, not a `✓` glyph.
    expect(items.map((li) => li.textContent)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(checkOf(items[0])).toBeTruthy();
    expect(items[0].dataset.selected).toBe('true');
    expect(checkOf(items[1])).toBeNull();
    expect(checkOf(items[2])).toBeNull();
    // Every radio row carries the same fixed-width slot so labels align.
    for (const li of items) {
      const slot = li.firstElementChild as HTMLElement;
      expect(slot.style.width).toBe('16px');
    }
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
      .filter((li) => li.textContent && li.textContent.trim() !== '');
    const byLabel = (label: string) => items.find((li) => li.textContent === label)!;
    // Action items get no slot at all.
    expect(byLabel('Copy').children).toHaveLength(0);
    expect(byLabel('Cut').children).toHaveLength(0);
    expect(checkOf(byLabel('Top'))).toBeTruthy();
    expect(byLabel('Middle').children).toHaveLength(2);
    expect(checkOf(byLabel('Middle'))).toBeNull();
  });

  it('omits the check column entirely when no item opts in', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined },
      { label: 'Middle', run: () => undefined },
    ], 0, 0);
    for (const li of host.querySelectorAll('li')) {
      expect(li.querySelector('svg')).toBeNull();
      expect(li.children).toHaveLength(0);
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

describe('showContextMenu — touch sizing', () => {
  const setPointer = (coarse: boolean) => {
    // jsdom ships no `matchMedia`; the menu treats its absence as a
    // precise pointer, so the mouse case needs a stub too.
    window.matchMedia = ((query: string) => ({
      matches: coarse && query === '(pointer: coarse)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  };

  afterEach(() => {
    dismiss();
    // @ts-expect-error — restoring jsdom's own (absent) matchMedia
    delete window.matchMedia;
  });

  it('keeps mouse-sized rows for a precise pointer', () => {
    setPointer(false);
    showContextMenu(document.body, [{ label: 'Copy', run: vi.fn() }], 0, 0);
    const li = document.body.querySelector<HTMLLIElement>(
      '.wfb-slides-context-menu li',
    )!;
    expect(li.style.padding).toBe('6px 8px');
    expect(li.style.lineHeight).toBe('20px');
  });

  it('grows the rows to a touch target for a coarse pointer', () => {
    // 13px above and below an 18px line is 44px — the smallest target
    // every touch platform's guidance accepts. At the mouse size, two
    // adjacent entries are within one fingertip of each other, which on
    // this menu means Delete sits a hair from Duplicate.
    setPointer(true);
    showContextMenu(document.body, [{ label: 'Copy', run: vi.fn() }], 0, 0);
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    const li = menu.querySelector<HTMLLIElement>('li')!;
    expect(li.style.padding).toBe('13px 8px');
    expect(li.style.lineHeight).toBe('18px');
    expect(menu.style.fontSize).toBe('15px');
  });

  it('scrolls rather than overflowing the viewport when long', () => {
    // Touch rows make the table menu taller than a phone; without a cap
    // the clamp would push its last entries off-screen.
    //
    // The cap is measured from `window.innerHeight` — the SAME source
    // the clamp below it reads — and not from `100vh`, which on mobile
    // Safari and Chrome is the large viewport (URL bar retracted) and
    // would let the cap exceed the clamp's idea of the screen by the
    // height of that bar. A `position: fixed` element cannot be
    // scrolled to, so those rows would be unreachable.
    setPointer(true);
    showContextMenu(
      document.body,
      Array.from({ length: 20 }, (_, i) => ({
        label: `Item ${i}`,
        run: vi.fn(),
      })),
      0,
      0,
    );
    const menu = document.body.querySelector<HTMLUListElement>(
      '.wfb-slides-context-menu',
    )!;
    expect(menu.style.overflowY).toBe('auto');
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 16}px`);
  });
});
