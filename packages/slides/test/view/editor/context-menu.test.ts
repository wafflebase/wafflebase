// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showContextMenu } from '../../../src/view/editor/context-menu';

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
