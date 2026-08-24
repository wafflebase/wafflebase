// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  FloatingClassEditor,
  activeOf,
  setExclusive,
  setSize,
  sizeOf,
} from '../../src/shell/scenes/FloatingClassEditor.tsx';

/**
 * The floating class editor — the first surface in this package that WRITES.
 *
 * WHAT IS AT RISK. Every control here rewrites a class list that will be saved into
 * the consumer's source, so a control that removes more than it meant to deletes the
 * designer's own class from a real file. The class-list functions are therefore tested
 * directly and hard, especially `setSize`, whose pattern deliberately does NOT match
 * the classes this editor has no control for.
 *
 * The panel is tested through a real root because two of its behaviours only exist in
 * the DOM: it portals to `document.body` (so a `querySelector` on the mount host would
 * find nothing), and it stops `mousedown` from bubbling — without which adjusting a
 * class deselects the node being adjusted.
 */

let root: Root | null = null;

function render(ui: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

const rect = { left: 40, top: 60, width: 100, height: 20 };

beforeEach(() => {
  // jsdom defaults to 1024×768; pinned so the flip/clamp arithmetic is deterministic.
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const panel = () => document.querySelector<HTMLElement>('[data-wb-class-editor]');
const buttons = (label?: string) =>
  [...document.querySelectorAll('button')].filter((b) =>
    label ? b.getAttribute('aria-label') === label : true,
  );
const click = (el: Element) =>
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/**
 * React tracks an input's value on the node and skips `onChange` when the value it
 * sees has not changed since it last wrote it. A direct `input.value = …` is invisible
 * to that bookkeeping, so the edit has to go through the native setter.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('setExclusive — the mutually-exclusive primitive', () => {
  it('drops every member of the group before adding one back', () => {
    // Two members of one group is a contradiction; leaving the old one in would emit
    // `items-start items-center` and let CSS order decide.
    expect(setExclusive(['p-2', 'items-start', 'items-end'], ['items-start', 'items-end'], 'items-end')).toEqual([
      'p-2',
      'items-end',
    ]);
  });

  it('clears the group when the value is null', () => {
    expect(setExclusive(['p-2', 'items-end'], ['items-start', 'items-end'], null)).toEqual(['p-2']);
  });

  it('leaves classes outside the group alone', () => {
    // The one thing this must never do is touch a class it was not asked about.
    expect(setExclusive(['flex', 'items-center-ish', 'gap-2'], ['items-center'], 'items-center')).toEqual([
      'flex',
      'items-center-ish',
      'gap-2',
      'items-center',
    ]);
  });
});

describe('activeOf', () => {
  it('finds the member that is present', () => {
    expect(activeOf(['p-2', 'gap-4'], ['gap-2', 'gap-4'])).toBe('gap-4');
  });
  it('reports null when none is', () => {
    expect(activeOf(['p-2'], ['gap-2', 'gap-4'])).toBeNull();
  });
  it('picks by GROUP order when the list contradicts itself', () => {
    // Deterministic rather than list-order dependent, so the highlighted button does
    // not depend on which class the file happens to list first.
    expect(activeOf(['gap-4', 'gap-2'], ['gap-2', 'gap-4'])).toBe('gap-2');
  });
});

describe('setSize / sizeOf — the anchored pattern is the point', () => {
  it('replaces a scale preset', () => {
    expect(setSize(['flex', 'w-4'], 'w', '8')).toEqual(['flex', 'w-8']);
  });

  it('clears the utility when the token is null', () => {
    expect(setSize(['flex', 'w-4'], 'w', null)).toEqual(['flex']);
  });

  it('KEEPS the width classes this editor has no control for', () => {
    // A looser `^w-` would strip all three. They belong to the chip list, and picking
    // a preset silently deleting the designer's own `w-[137px]` is a write nobody
    // asked for.
    const kept = ['w-fit', 'w-1/2', 'w-[137px]', 'w-min'];
    expect(setSize([...kept], 'w', '8')).toEqual([...kept, 'w-8']);
  });

  it('does not confuse the two prefixes', () => {
    expect(setSize(['w-4', 'h-8'], 'h', '12')).toEqual(['w-4', 'h-12']);
  });

  it('ignores a variant-prefixed utility', () => {
    // `hover:w-4` is a different declaration; rewriting the base must not remove it.
    expect(setSize(['hover:w-4'], 'w', '8')).toEqual(['hover:w-4', 'w-8']);
  });

  it('reads the token back, and reports empty for the classes it does not own', () => {
    expect(sizeOf(['flex', 'w-auto'], 'w')).toBe('auto');
    expect(sizeOf(['w-full'], 'w')).toBe('full');
    expect(sizeOf(['w-96'], 'w')).toBe('96');
    expect(sizeOf(['w-[137px]', 'w-fit'], 'w')).toBe('');
    expect(sizeOf(['h-4'], 'w')).toBe('');
  });
});

describe('the panel', () => {
  const props = (over: Partial<React.ComponentProps<typeof FloatingClassEditor>> = {}) => ({
    hostRect: rect,
    classes: ['flex', 'gap-2'],
    title: '<div>',
    onChange: vi.fn(),
    onClose: vi.fn(),
    ...over,
  });

  it('renders nothing without a rect', () => {
    // `undefined` = still measuring, `null` = no visible box. Neither should paint a
    // panel at 0,0.
    render(<FloatingClassEditor {...props({ hostRect: undefined })} />);
    expect(panel()).toBeNull();
    act(() => root!.render(<FloatingClassEditor {...props({ hostRect: null })} />));
    expect(panel()).toBeNull();
  });

  it('portals to document.body rather than into the mount host', () => {
    // It has to escape the pane's `overflow`/transform to sit over the iframe.
    const host = render(<FloatingClassEditor {...props()} />);
    expect(host.querySelector('[data-wb-class-editor]')).toBeNull();
    expect(panel()!.parentElement).toBe(document.body);
  });

  it('stays on-screen when the window is narrower than the panel', () => {
    // 288 + 6 > 200, so the right-edge bound is negative. Applied last it would win over
    // the left-edge floor and hang the panel off the left of the viewport.
    Object.defineProperty(window, 'innerWidth', { value: 200, configurable: true });
    render(<FloatingClassEditor {...props()} />);
    expect(parseFloat(panel()!.style.left)).toBeGreaterThanOrEqual(0);
  });

  it('anchors below the selection', () => {
    render(<FloatingClassEditor {...props()} />);
    expect(panel()!.style.top).toBe('86px'); // 60 + 20 + 6
    expect(panel()!.style.left).toBe('40px');
  });

  it('flips above when there is no room below', () => {
    render(<FloatingClassEditor {...props({ hostRect: { ...rect, top: 700 } })} />);
    // 768 − 720 = 48 below, and 700 above — so above wins: 700 − 260 − 6.
    expect(panel()!.style.top).toBe('434px');
  });

  it('clamps to the viewport instead of overflowing off-screen', () => {
    // The panel has no scroll container of its own, so an overflow is unreachable UI.
    render(<FloatingClassEditor {...props({ hostRect: { ...rect, left: 1000 } })} />);
    expect(panel()!.style.left).toBe('730px'); // 1024 − 288 − 6
    act(() => root!.render(<FloatingClassEditor {...props({ hostRect: { ...rect, left: -50 } })} />));
    expect(panel()!.style.left).toBe('6px');
  });

  it('stops mousedown from reaching the gutter’s deselect handler', () => {
    // `stopPropagation` here blocks REACT-tree propagation, not DOM bubbling: a portal
    // keeps its React parentage, so a synthetic event on the panel travels up to
    // whatever ancestor holds the gutter's `onMouseDown` even though the DOM node sits
    // in `document.body`. Without this guard, adjusting a class deselects the node
    // being adjusted.
    const onGutterDown = vi.fn();
    render(
      <div onMouseDown={onGutterDown}>
        <FloatingClassEditor {...props()} />
      </div>,
    );
    act(() => panel()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onGutterDown).not.toHaveBeenCalled();
  });

  it('toggles a group member on, and the same button off again', () => {
    const onChange = vi.fn();
    render(<FloatingClassEditor {...props({ classes: ['flex'], onChange })} />);
    const col = [...document.querySelectorAll('button')].find((b) => b.title === 'flex-col')!;
    click(col);
    expect(onChange).toHaveBeenCalledWith(['flex', 'flex-col']);

    onChange.mockClear();
    act(() =>
      root!.render(<FloatingClassEditor {...props({ classes: ['flex', 'flex-col'], onChange })} />),
    );
    click([...document.querySelectorAll('button')].find((b) => b.title === 'flex-col')!);
    expect(onChange).toHaveBeenCalledWith(['flex']);
  });

  it('marks the active option for assistive tech, not by colour alone', () => {
    render(<FloatingClassEditor {...props({ classes: ['gap-4'] })} />);
    const on = [...document.querySelectorAll('button')].find((b) => b.title === 'gap-4')!;
    const off = [...document.querySelectorAll('button')].find((b) => b.title === 'gap-2')!;
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(off.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the full utility name reachable, since the label drops the stem', () => {
    // The node must OWN the property for its group to open — the panel no longer shows
    // every group on every node. The assertion is unchanged; only the fixture is, from
    // a node that never had a `justify-` to one that does.
    render(<FloatingClassEditor {...props({ classes: ['flex', 'justify-start'] })} />);
    const b = [...document.querySelectorAll('button')].find((x) => x.title === 'justify-between')!;
    expect(b.textContent).toBe('between');
  });

  it('sets and clears a size through the select', () => {
    const onChange = vi.fn();
    render(<FloatingClassEditor {...props({ classes: ['flex'], onChange })} />);
    const sel = [...document.querySelectorAll('select')].find(
      (s) => s.getAttribute('aria-label') === 'Width',
    )!;
    act(() => {
      sel.value = '8';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(['flex', 'w-8']);

    onChange.mockClear();
    act(() => root!.render(<FloatingClassEditor {...props({ classes: ['w-8'], onChange })} />));
    const sel2 = [...document.querySelectorAll('select')].find(
      (s) => s.getAttribute('aria-label') === 'Width',
    )!;
    act(() => {
      sel2.value = '';
      sel2.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('adds an arbitrary class through the escape hatch', () => {
    // The presets are on-token by construction; this is the only way to reach
    // anything else, so it must accept what the presets refuse.
    const onChange = vi.fn();
    render(<FloatingClassEditor {...props({ classes: ['flex'], onChange })} />);
    const input = document.querySelector<HTMLInputElement>('input')!;
    typeInto(input, '  w-[137px]  ');
    click(buttons('Add the class')[0]);
    expect(onChange).toHaveBeenCalledWith(['flex', 'w-[137px]']);
  });

  it('adds on Enter, and refuses a blank or duplicate', () => {
    const onChange = vi.fn();
    render(<FloatingClassEditor {...props({ classes: ['flex'], onChange })} />);
    const input = document.querySelector<HTMLInputElement>('input')!;
    const type = (v: string) => typeInto(input, v);
    const enter = () =>
      act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

    type('p-4');
    enter();
    expect(onChange).toHaveBeenCalledWith(['flex', 'p-4']);

    onChange.mockClear();
    type('   ');
    enter();
    type('flex');
    enter();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip by name', () => {
    const onChange = vi.fn();
    render(<FloatingClassEditor {...props({ classes: ['flex', 'gap-2'], onChange })} />);
    click(buttons('Remove gap-2')[0]);
    expect(onChange).toHaveBeenCalledWith(['flex']);
  });

  it('says (none) rather than showing an empty row', () => {
    render(<FloatingClassEditor {...props({ classes: [] })} />);
    expect(panel()!.textContent).toContain('(none)');
  });

  it('closes without starting a drag', () => {
    // The X sits inside the drag handle, so its `pointerdown` reaches `beginDrag`
    // unless it is stopped. What that costs is not a failed close — the click still
    // fires — but a panel that JUMPS on the way out: any pointer movement between
    // down and up is applied as a drag, which on a trackpad or a touch screen is most
    // clicks.
    const onClose = vi.fn();
    render(<FloatingClassEditor {...props({ onClose })} />);
    const before = panel()!.style.left;
    const x = buttons('Close the class editor')[0];
    act(() => x.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0 })));
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40 })));
    expect(panel()!.style.left).toBe(before);
    click(x);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('dragging', () => {
  const props = () => ({
    hostRect: rect,
    classes: ['flex'],
    title: '<div>',
    onChange: vi.fn(),
    onClose: vi.fn(),
  });

  const drag = (from: [number, number], to: [number, number]) => {
    act(() =>
      panel()!.querySelector('.cursor-grab')!.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: from[0], clientY: from[1] }),
      ),
    );
    act(() =>
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: to[0], clientY: to[1] })),
    );
  };

  it('offsets the panel from its anchor', () => {
    render(<FloatingClassEditor {...props()} />);
    drag([0, 0], [30, -10]);
    expect(panel()!.style.left).toBe('70px'); // 40 + 30
    expect(panel()!.style.top).toBe('76px'); // 86 − 10
  });

  it('keeps tracking the same node after being dragged aside', () => {
    // The offset is added to the anchor, not substituted for it, so scrolling the pane
    // moves the panel with the node instead of leaving it behind.
    render(<FloatingClassEditor {...props()} />);
    drag([0, 0], [30, 0]);
    act(() =>
      root!.render(<FloatingClassEditor {...props()} hostRect={{ ...rect, top: 160 }} />),
    );
    expect(panel()!.style.top).toBe('186px'); // (160 + 20 + 6) + 0
    expect(panel()!.style.left).toBe('70px'); // offset preserved
  });

  it('stops moving after pointerup', () => {
    render(<FloatingClassEditor {...props()} />);
    drag([0, 0], [30, 0]);
    act(() => window.dispatchEvent(new PointerEvent('pointerup')));
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 })));
    expect(panel()!.style.left).toBe('70px');
  });

  it('never leaves two live pointermove listeners', () => {
    // Counting is the only way to see this: a second pointerdown without an
    // intervening pointerup leaves BOTH handlers attached, and because they both write
    // the same state in one batch the position still looks right. The damage is
    // unbounded growth — one handler per aborted drag, for the session.
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    render(<FloatingClassEditor {...props()} />);
    const handle = () => panel()!.querySelector('.cursor-grab')!;
    const down = () =>
      act(() =>
        handle().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0 })),
      );
    down();
    down();
    down();
    const live =
      addSpy.mock.calls.filter(([t]) => t === 'pointermove').length -
      removeSpy.mock.calls.filter(([t]) => t === 'pointermove').length;
    expect(live).toBe(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('detaches the drag listener when it unmounts mid-drag', () => {
    // Otherwise the `pointermove` listener outlives the panel and keeps setting state
    // on a component that is gone, once per mouse move, for the rest of the session.
    const spy = vi.spyOn(window, 'removeEventListener');
    render(<FloatingClassEditor {...props()} />);
    act(() =>
      panel()!.querySelector('.cursor-grab')!.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }),
      ),
    );
    act(() => root!.unmount());
    root = null;
    expect(spy.mock.calls.some(([type]) => type === 'pointermove')).toBe(true);
    spy.mockRestore();
  });
});
