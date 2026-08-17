// @vitest-environment jsdom
//
// The first DOM environment in this package. Everything else here is text-in /
// text-out or a Node-side plan, but the picker IS DOM manipulation: it appends an
// overlay, hit-tests through `closest`, and reads `getBoundingClientRect`. Testing it
// against a fake document would only test the fake.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTokenVars,
  disposePicker,
  installPicker,
  renderedClasses,
  selectableIds,
} from '../../src/scenes/frame-picker.ts';
import { stampId } from '../../src/scenes/frame-protocol.ts';
import type { FrameMessage } from '../../src/scenes/frame-protocol.ts';

/**
 * `installPicker` is idempotent by module-level flag, so the FIRST call in this file
 * is the only one that attaches listeners. The `send` spy is therefore swapped
 * through a mutable box rather than re-installed per test.
 */
const sent: FrameMessage[] = [];
let installed = false;
function picker(): FrameMessage[] {
  if (!installed) {
    installed = true;
    installPicker({ send: (m) => sent.push(m) });
  }
  sent.length = 0;
  return sent;
}

/** A stamped element, as `stamp.mjs` would have written it. */
function stamped(
  tag: string,
  file: string,
  component: string,
  path: number[],
  fp: string,
): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.wbNode = `${component}:${path.join('.')}`;
  el.dataset.wbFile = file;
  el.dataset.wbFp = fp;
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/**
 * Without this the suite passes and STILL reports an uncaught error: the mutation
 * observer's callback is a microtask, so it fires after vitest has torn the jsdom
 * globals down and throws from inside the observer where nothing catches it.
 */
afterAll(() => disposePicker());

describe('selectableIds', () => {
  it('reports the ids that actually reached the DOM', () => {
    // This is the `clickSelectable` correction: the metadata's guess is conservative
    // because a component that does not spread `{...props}` swallows the attribute,
    // and that cannot be known from source.
    const a = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a');
    const b = stamped('span', 'app/a.tsx', 'Page', [0, 1], 'fp-b');
    document.body.append(a, b);
    expect(selectableIds().sort()).toEqual(
      [stampId('app/a.tsx', 'Page', [0]), stampId('app/a.tsx', 'Page', [0, 1])].sort(),
    );
  });

  it('de-duplicates the N elements one source node renders', () => {
    // A `.map()` row carries the same stamp N times; it is ONE editable node.
    for (let i = 0; i < 3; i++) {
      document.body.append(stamped('li', 'app/a.tsx', 'Page', [0, 2], 'fp-row'));
    }
    expect(selectableIds()).toEqual([stampId('app/a.tsx', 'Page', [0, 2])]);
  });

  it('skips an element missing any of the three attributes', () => {
    const partial = document.createElement('div');
    partial.dataset.wbNode = 'Page:0';
    // no file, no fp
    document.body.append(partial);
    expect(selectableIds()).toEqual([]);
  });

  it('skips an element whose stamp is malformed, rather than publishing a NaN id', () => {
    // `refFor` used to re-parse the attribute itself and skip `parseStampId`'s
    // validation, so this produced `path: [NaN]` and the id `app/a.tsx#Page:NaN`:
    // matching no element, so the overlay silently never drew, and `NaN` reaching the
    // host as an anchor hint — `postMessage` preserves it.
    const bad = document.createElement('div');
    bad.dataset.wbNode = 'Page:x';
    bad.dataset.wbFile = 'app/a.tsx';
    bad.dataset.wbFp = 'deadbeef';
    document.body.append(bad);
    expect(selectableIds()).toEqual([]);
  });
});

describe('renderedClasses', () => {
  it('collects the scene’s classes, split on whitespace', () => {
    const el = document.createElement('div');
    el.className = 'p-2  bg-primary\ntext-sm';
    document.body.append(el);
    expect(renderedClasses().sort()).toEqual(['bg-primary', 'p-2', 'text-sm']);
  });

  it('excludes the overlay’s own furniture', () => {
    // Feeding these back would have the host register Tailwind candidates for the
    // editor's own boxes.
    const overlay = document.createElement('div');
    overlay.setAttribute('data-wb-overlay', 'root');
    const inner = document.createElement('div');
    inner.className = 'editor-only';
    overlay.append(inner);
    const scene = document.createElement('div');
    scene.className = 'scene-class';
    document.body.append(overlay, scene);
    expect(renderedClasses()).toEqual(['scene-class']);
  });

  it('reads an SVG’s classes, which `className` reports as an object', () => {
    // `[class]` matches SVG, and there `className` is an `SVGAnimatedString`:
    // `.toString()` gave `'[object SVGAnimatedString]'`, so every lucide icon
    // contributed the two junk candidates `[object` and `SVGAnimatedString]` and
    // none of its real ones. A runtime-composed class on an icon then had no rule
    // generated and rendered unstyled.
    //
    // `createElementNS`, not `createElement('svg')` — the latter builds an
    // `HTMLUnknownElement` whose `className` is a plain string, which is why the
    // original suite could not see this.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lucide h-4 w-4');
    document.body.append(svg);
    expect(renderedClasses().sort()).toEqual(['h-4', 'lucide', 'w-4']);
  });
});

describe('applyTokenVars', () => {
  const styleEl = () => document.getElementById('wb-token-preview') as HTMLStyleElement | null;
  /** The rules as the CSS parser sees them — where the declarations now live. */
  const rules = () => [...(styleEl()!.sheet!.cssRules as unknown as Iterable<CSSStyleRule>)];
  const valueOf = (i: number, prop: string) => rules()[i].style.getPropertyValue(prop).trim();

  it('writes one replaceable block for both themes', () => {
    applyTokenVars({ '--primary': '#0f0' });
    // Asserted through the CSSOM rather than on `textContent`: the element's text is
    // now two EMPTY rules and the declarations are set on them, which is what stops
    // a `}` in a value from terminating the block.
    expect(rules().map((r) => r.selectorText)).toEqual([':root', '.dark']);
    expect([valueOf(0, '--primary'), valueOf(1, '--primary')]).toEqual(['#0f0', '#0f0']);
  });

  it('replaces rather than accumulates', () => {
    applyTokenVars({ '--primary': '#0f0' });
    applyTokenVars({ '--ring': '#00f' });
    expect(valueOf(0, '--ring')).toBe('#00f');
    expect(valueOf(0, '--primary')).toBe('');
    expect(document.querySelectorAll('#wb-token-preview')).toHaveLength(1);
  });

  it('keeps every other declaration when one value is malformed', () => {
    // The value field is free text, so a `}` mid-typing is ordinary. Interpolating
    // it terminated the rule: measured against a real parser, 1 of 4 declarations
    // survived and the whole dark block went with it.
    //
    // jsdom does not validate a custom-property value, so `--bad` itself is still
    // present here where a browser would reject it. What this pins is the part that
    // was actually broken: the block structure and the OTHER tokens.
    applyTokenVars({ '--bad': 'oklch(0.5 0 0)}', '--ring': '#00f' });
    expect(rules().map((r) => r.selectorText)).toEqual([':root', '.dark']);
    expect([valueOf(0, '--ring'), valueOf(1, '--ring')]).toEqual(['#00f', '#00f']);
  });

  it('removes the block entirely when the edit is discarded', () => {
    applyTokenVars({ '--primary': '#0f0' });
    applyTokenVars({});
    expect(styleEl()).toBeNull();
  });

  it('honours a project’s own dark selector', () => {
    // The default adapter defaults to `.dark`, but the option exists — and a project
    // that sets something else has a dark block that out-specifies a `:root`
    // override, so its dark preview would silently show the on-disk colour.
    applyTokenVars({ '--primary': '#0f0' }, '[data-theme="dark"]');
    const css = styleEl()!.textContent!;
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).not.toContain('.dark {');
  });

  it('appends to head, so it wins against an equally specific block', () => {
    applyTokenVars({ '--primary': '#0f0' });
    expect(document.head.lastElementChild?.id).toBe('wb-token-preview');
  });
});

describe('installPicker', () => {
  it('draws an overlay that cannot be hit-tested or fed back', () => {
    // The overlay is created LAZILY, on the first paint — not by `installPicker`.
    // Asserting it exists straight after install was my own wrong assumption; the
    // first interaction is what brings it into being.
    picker();
    document.body.append(stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a'));
    document.body.firstElementChild!.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }),
    );
    const root = document.querySelector('[data-wb-overlay="root"]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.pointerEvents).toBe('none');
    // And it must be invisible to `renderedClasses`, or the host registers Tailwind
    // candidates for the editor's own furniture.
    expect(renderedClasses()).toEqual([]);
  });

  it('never selects through the overlay, wherever the overlay sits', () => {
    // `pointer-events: none` means a real browser does not target the overlay, so the
    // guard in `stampedAt` looks redundant — and is, as long as the overlay stays a
    // direct child of `<body>` with no stamped ancestor. This pins the invariant the
    // guard exists for: mounted anywhere inside a stamped subtree, a click on the
    // overlay must not walk up and select its host.
    const out = picker();
    const host = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-host');
    const box = document.createElement('div');
    box.setAttribute('data-wb-overlay', 'selection');
    host.append(box);
    document.body.append(host);
    box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(out.filter((m) => m.type === 'wb:select')).toEqual([]);
  });

  it('reports a click on a stamped node, with its instance count', () => {
    const out = picker();
    const el = stamped('button', 'app/a.tsx', 'Page', [0], 'fp-a');
    document.body.append(el, stamped('button', 'app/a.tsx', 'Page', [0], 'fp-a'));
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const msg = out.find((m) => m.type === 'wb:select');
    expect(msg).toMatchObject({
      type: 'wb:select',
      node: { component: 'Page', path: [0], fp: 'fp-a', tag: 'button', instances: 2 },
    });
  });

  it('walks up to the nearest stamped ancestor', () => {
    // The deepest node under the cursor is frequently something no source node
    // produced — an SVG path inside an icon, an injected wrapper.
    const out = picker();
    const wrapper = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-w');
    const icon = document.createElement('svg');
    wrapper.append(icon);
    document.body.append(wrapper);
    icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(out.find((m) => m.type === 'wb:select')).toMatchObject({ node: { fp: 'fp-w' } });
  });

  it('deselects on a click that hits nothing stamped', () => {
    const out = picker();
    const el = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a');
    const plain = document.createElement('div');
    document.body.append(el, plain);
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    out.length = 0;
    plain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(out.map((m) => m.type)).toContain('wb:deselect');
  });

  it('cycles up the ancestor chain on repeated clicks at the same spot', () => {
    // Figma-style: every click re-selecting whatever is nearest the pointer pins you
    // to one depth, and reaching a padding-only wrapper then needs a pixel where
    // only it is hit-tested — often impossible.
    const out = picker();
    const outer = stamped('section', 'app/a.tsx', 'Page', [0], 'fp-outer');
    const inner = stamped('span', 'app/a.tsx', 'Page', [0, 0], 'fp-inner');
    outer.append(inner);
    document.body.append(outer);

    const click = () => inner.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    click();
    expect(out.filter((m) => m.type === 'wb:select').at(-1)).toMatchObject({
      node: { fp: 'fp-inner' },
    });
    click();
    expect(out.filter((m) => m.type === 'wb:select').at(-1)).toMatchObject({
      node: { fp: 'fp-outer' },
    });
    // Past the outermost is a deselect, and the next click starts over.
    out.length = 0;
    click();
    expect(out.map((m) => m.type)).toContain('wb:deselect');
    out.length = 0;
    click();
    expect(out.filter((m) => m.type === 'wb:select').at(-1)).toMatchObject({
      node: { fp: 'fp-inner' },
    });
  });

  it('jumps to the deepest node on a modifier click, whatever the cycle', () => {
    const out = picker();
    const outer = stamped('section', 'app/a.tsx', 'Page', [0], 'fp-outer');
    const inner = stamped('span', 'app/a.tsx', 'Page', [0, 0], 'fp-inner');
    outer.append(inner);
    document.body.append(outer);
    const click = (init: MouseEventInit = {}) =>
      inner.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }));
    click();
    click(); // now sitting on the outer
    out.length = 0;
    click({ metaKey: true });
    expect(out.filter((m) => m.type === 'wb:select').at(-1)).toMatchObject({
      node: { fp: 'fp-inner' },
    });
  });

  it('does no document query for a pointer sample over the same element', () => {
    // `mousemove` is not coalesced, so this runs per pointer sample. `refFor` ends in
    // `elementsFor(id)` — a document-wide `querySelectorAll` with two attribute
    // selectors — and it used to run before any identity check: measured, ten moves
    // across ONE element cost ten document queries. `paint()` was already gated by
    // `next === hoverId`, so this is the cheap half that was not.
    picker();
    const node = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a');
    const other = stamped('div', 'app/a.tsx', 'Page', [1], 'fp-b');
    document.body.append(node, other);

    const real = document.querySelectorAll.bind(document);
    let queries = 0;
    const spy = vi
      .spyOn(document, 'querySelectorAll')
      .mockImplementation((sel: string) => {
        queries++;
        return real(sel);
      });
    const move = (el: Element) =>
      el.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    try {
      move(node);
      queries = 0;
      for (let i = 0; i < 10; i++) move(node);
      expect(queries).toBe(0);

      // A move to a DIFFERENT element must still resolve it, or the outline would
      // stick to whatever was hovered first.
      move(other);
      expect(queries).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('prevents the product’s own handler while picking', () => {
    // Without capture + preventDefault a link navigates the frame before the
    // selection lands, and behind an in-memory router there is no URL to say so.
    picker();
    const el = stamped('a', 'app/a.tsx', 'Page', [0], 'fp-a');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    document.body.append(el);
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores a message from another origin', () => {
    // The frame renders real product code and shares a window with whatever the host
    // page runs; selection and writes must not be drivable from outside.
    const out = picker();
    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'wb:set-token-vars', vars: { '--primary': 'red' } },
      }),
    );
    expect(document.getElementById('wb-token-preview')).toBeNull();
    expect(out).toEqual([]);
  });

  it('detaches every listener and observer on dispose', () => {
    const out = picker();
    document.body.append(stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a'));
    disposePicker();
    installed = false;
    expect(document.querySelector('[data-wb-overlay="root"]')).toBeNull();
    out.length = 0;
    document.body.firstElementChild!.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }),
    );
    expect(out).toEqual([]);
  });

  /**
   * A queued animation frame outliving `disposePicker`.
   *
   * `AbortController` reaches the listeners and `observers` reaches the observers,
   * but the repaint rAF and the transition tracker are closures — so a scroll or a
   * running transition left a frame that fired after teardown, and `paint()` opens
   * with `ensureOverlay()`, which BUILDS and appends a new overlay into the disposed
   * document. The next `installPicker` then painted into a root that the following
   * `beforeEach` had detached, and drew nothing.
   *
   * What both cases pin is the `!started` check in `paint()`: reverting it fails the
   * transition-tracker case, and `cancelFrames` covers the scroll one on its own.
   * Reverting `cancelFrames` fails NEITHER — its effect is not observable from here,
   * and the source says so where it is defined rather than implying this covers it.
   */
  for (const [label, wake] of [
    ['a scroll-queued repaint', () => window.dispatchEvent(new window.Event('scroll'))],
    ['the transition tracker', () => window.dispatchEvent(new window.Event('transitionrun'))],
  ] as const) {
    it(`paints nothing after dispose when ${label} is pending`, async () => {
      picker();
      document.body.append(stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a'));
      document.body.firstElementChild!.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
      expect(document.querySelector('[data-wb-overlay="root"]')).not.toBeNull();

      wake();
      disposePicker();
      installed = false;
      expect(document.querySelector('[data-wb-overlay="root"]')).toBeNull();

      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      expect(document.querySelectorAll('[data-wb-overlay]')).toHaveLength(0);
    });
  }

  it('answers a measure request by nonce, null when the node is gone', () => {
    const out = picker();
    document.body.append(stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a'));
    const id = stampId('app/a.tsx', 'Page', [0]);
    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'wb:measure', id, nonce: 7 },
      }),
    );
    expect(out.find((m) => m.type === 'wb:measured')).toMatchObject({ nonce: 7, rect: {} });
    out.length = 0;
    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'wb:measure', id: stampId('app/a.tsx', 'Page', [9]), nonce: 8 },
      }),
    );
    expect(out.find((m) => m.type === 'wb:measured')).toEqual({
      type: 'wb:measured',
      nonce: 8,
      rect: null,
    });
  });
});

/**
 * The subject ResizeObserver, which jsdom does not implement.
 *
 * `observe()` starts an observation whose `lastReportedSize` is (0,0), so a rendered
 * element of any non-zero size is immediately active and the callback fires on the
 * next frame with no size change. That callback is the repaint, the repaint runs
 * `paint()`, and `paint()` ended by re-observing — a per-frame cycle that never
 * settled, each turn reading `getBoundingClientRect()` for every rendered instance.
 *
 * No test here can observe the loop: the real behaviour lives in the browser's
 * observer, and a stub that reproduced it would only be testing the stub. What is
 * pinned instead is the property that breaks the cycle — an unchanged subject set
 * does not re-observe — plus the thing that must keep working, that a CHANGED set
 * does.
 */
describe('subject observation', () => {
  class CountingRO {
    static observed = 0;
    static disconnected = 0;
    constructor(_cb: unknown) {}
    observe() {
      CountingRO.observed++;
    }
    unobserve() {}
    disconnect() {
      CountingRO.disconnected++;
    }
  }

  beforeEach(() => {
    disposePicker();
    installed = false;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CountingRO;
    CountingRO.observed = 0;
    CountingRO.disconnected = 0;
  });

  afterAll(() => {
    disposePicker();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const repaint = async () => {
    window.dispatchEvent(new window.Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  };

  it('does not re-observe when the subject set is unchanged', async () => {
    picker();
    document.body.append(stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a'));
    click(document.body.firstElementChild!);
    const afterFirstPaint = CountingRO.observed;
    expect(afterFirstPaint).toBeGreaterThan(0);

    await repaint();
    await repaint();
    expect(CountingRO.observed).toBe(afterFirstPaint);
  });

  it('re-observes when the selection moves to another node', async () => {
    picker();
    const a = stamped('div', 'app/a.tsx', 'Page', [0], 'fp-a');
    const b = stamped('div', 'app/a.tsx', 'Page', [1], 'fp-b');
    document.body.append(a, b);
    click(a);
    const afterA = CountingRO.observed;
    click(b);
    expect(CountingRO.observed).toBeGreaterThan(afterA);
  });
});
