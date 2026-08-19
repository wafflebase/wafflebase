// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SceneHost } from '../../src/shell/scenes/SceneHost.tsx';
import { stampId } from '../../src/scenes/frame-protocol.ts';
import type { FrameMessage, HostMessage, StampRef } from '../../src/scenes/frame-protocol.ts';

/**
 * The host half of the frame protocol.
 *
 * Driven in jsdom because an iframe here loads nothing — what is under test is the
 * MESSAGE handling and the gating, not the paint. `verify:frame` covers the paint in a
 * real browser; the two are deliberately different jobs.
 *
 * Every case below is a way the host can be silently wrong: a message accepted from the
 * wrong window, a stale measurement landing as the current selection's rect, or a
 * host→frame message posted before the frame installed its listener — which Vite drops
 * without a word, so the frame comes back blank after a reload instead of restoring.
 */

let root: Root | null = null;

/** What the host posted INTO the frame, in order. */
function mount(props: Partial<React.ComponentProps<typeof SceneHost>> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const posted: HostMessage[] = [];
  let current = { sceneId: 'dash', dark: false, ...props } as React.ComponentProps<
    typeof SceneHost
  >;
  act(() => root!.render(<SceneHost {...current} />));
  const rerender = (next: Partial<React.ComponentProps<typeof SceneHost>>) => {
    current = { ...current, ...next };
    act(() => root!.render(<SceneHost {...current} />));
  };
  const frame = host.querySelector('iframe')!;
  // jsdom gives an iframe a real contentWindow; capturing its `postMessage` is what the
  // frame would have received.
  const win = frame.contentWindow!;
  vi.spyOn(win, 'postMessage').mockImplementation((msg) => {
    posted.push(msg as HostMessage);
  });
  return { host, frame, win, posted, rerender };
}

/** Deliver a frame→host message as the real frame would: same origin, same source. */
function fromFrame(win: Window, data: FrameMessage, over: { origin?: string; source?: unknown } = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: over.origin ?? window.location.origin,
        source: (over.source ?? win) as MessageEventSource,
      }),
    );
  });
}

const REF: StampRef = {
  id: stampId('app/a.tsx', 'Page', [0]),
  component: 'Page',
  path: [0],
  fp: 'deadbeef',
  tag: 'main',
  file: 'app/a.tsx',
  instances: 1,
};
const RECT = { x: 10, y: 20, width: 100, height: 40 };
const ready = (win: Window) =>
  fromFrame(win, { type: 'wb:ready', scene: 'dash', side: 'after', selectable: [REF.id] });

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('frame → host', () => {
  it('reports readiness with the selectable set', () => {
    const seen: string[][] = [];
    const { win } = mount({ onReady: (s) => seen.push(s) });
    ready(win);
    expect(seen).toEqual([[REF.id]]);
  });

  it('passes a selection through', () => {
    const got: StampRef[] = [];
    const { win } = mount({ onSelect: (n) => got.push(n) });
    fromFrame(win, { type: 'wb:select', node: REF, rect: RECT, altKey: false });
    expect(got).toEqual([REF]);
  });

  it('routes each error kind, and only `compile` offers an undo', () => {
    // The kinds exist because the recoveries differ; collapsing them is what puts an
    // undo button in front of a problem undo cannot solve.
    const compiles: string[] = [];
    const { host, win } = mount({ onCompileError: (m) => compiles.push(m) });
    fromFrame(win, { type: 'wb:error', kind: 'mount', message: 'no export' });
    expect(host.textContent).toContain('Scene mount error');
    expect(compiles).toEqual([]);
    fromFrame(win, { type: 'wb:error', kind: 'compile', message: 'Unexpected )' });
    expect(compiles).toEqual(['Unexpected )']);
  });

  it('ignores a message from another origin', () => {
    const got: StampRef[] = [];
    const { win } = mount({ onSelect: (n) => got.push(n) });
    fromFrame(win, { type: 'wb:select', node: REF, rect: RECT, altKey: false }, {
      origin: 'https://evil.example',
    });
    expect(got).toEqual([]);
  });

  it('ignores a message from a window that is not our frame', () => {
    // The host page runs the consumer's app and Vite's HMR client in the same window.
    const got: StampRef[] = [];
    const { win } = mount({ onSelect: (n) => got.push(n) });
    fromFrame(win, { type: 'wb:select', node: REF, rect: RECT, altKey: false }, { source: window });
    expect(got).toEqual([]);
  });

  it('ignores a namespaced payload whose fields are wrong', () => {
    // `isFrameMessage` validates per variant as of the second CodeRabbit round; without
    // that a listener reads `node.id` off undefined.
    const got: StampRef[] = [];
    const { win } = mount({ onSelect: (n) => got.push(n) });
    fromFrame(win, { type: 'wb:select' } as unknown as FrameMessage);
    expect(got).toEqual([]);
  });
});

describe('host → frame', () => {
  it('holds every message until the frame says it is ready', () => {
    // A message sent before the frame's listener exists is dropped silently, and nothing
    // re-sends it — so a frame that never got its selection looks like a frame that
    // ignored it.
    //
    // Asserting "nothing posted yet" right after mount CANNOT see the gate: the spy is
    // installed after the first render, so the pre-ready posts have already happened by
    // then and removing the gate failed no test. What separates gated from ungated is
    // whether a LATER prop change posts while still not ready.
    const { win, posted, rerender } = mount({ selectedId: REF.id });
    posted.length = 0;
    rerender({ selectedId: stampId('app/a.tsx', 'Page', [1]) });
    expect(posted, 'not ready — nothing may be posted').toEqual([]);

    ready(win);
    posted.length = 0;
    rerender({ selectedId: stampId('app/a.tsx', 'Page', [2]) });
    expect(posted.map((m) => m.type), 'ready — the change is posted').toContain(
      'wb:set-selection',
    );
  });

  it('sends the selection, hover, picking mode and token vars once ready', () => {
    const { win, posted } = mount({ selectedId: REF.id, tokenVars: { '--primary': '#0f0' } });
    ready(win);
    const types = posted.map((m) => m.type);
    expect(types).toContain('wb:set-selection');
    expect(types).toContain('wb:set-hover');
    expect(types).toContain('wb:set-picking');
    expect(types).toContain('wb:set-token-vars');
    expect(posted.find((m) => m.type === 'wb:set-token-vars')).toEqual({
      type: 'wb:set-token-vars',
      vars: { '--primary': '#0f0' },
    });
  });

  it('measures the selection, and clears the rect when there is none', () => {
    const rects: (typeof RECT | null)[] = [];
    const { win, posted } = mount({ selectedId: REF.id, onMeasured: (r) => rects.push(r) });
    ready(win);
    const measure = posted.find((m) => m.type === 'wb:measure');
    expect(measure).toMatchObject({ type: 'wb:measure', id: REF.id });

    fromFrame(win, { type: 'wb:measured', nonce: (measure as { nonce: number }).nonce, rect: RECT });
    expect(rects.at(-1)).toEqual(RECT);
  });

  it('drops a measurement whose nonce is stale', () => {
    // Selecting B while A's reply is in flight must not land A's rect as B's answer.
    const rects: (typeof RECT | null)[] = [];
    const { win, posted } = mount({ selectedId: REF.id, onMeasured: (r) => rects.push(r) });
    ready(win);
    const nonce = (posted.find((m) => m.type === 'wb:measure') as { nonce: number }).nonce;
    rects.length = 0;
    fromFrame(win, { type: 'wb:measured', nonce: nonce - 1, rect: RECT });
    expect(rects).toEqual([]);
  });
});

describe('the frame element', () => {
  it('carries the scene, side, theme and mock-data state in its URL', () => {
    const { frame } = mount({ dark: true, mockDataEmpty: true, side: 'before' });
    const url = new URL(frame.getAttribute('src')!, 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scene: 'dash',
      frame: 'before',
      theme: 'dark',
      empty: '1',
    });
  });

  it('remounts when the theme changes, because the frame reads it at load', () => {
    // The prototype posted `{type:'theme-change'}`, which only wafflebase's own
    // ThemeProvider listened for — `packages/frontend/src/components/theme-provider.tsx`.
    // A generic consumer has no such listener, so that message vanishes and the frame
    // stays in whatever theme it loaded with. Baking `theme` into the URL and the `key`
    // is the only mechanism that works without assuming anything about their app.
    const { host, frame, rerender } = mount({ dark: false });
    expect(frame.getAttribute('src')).toContain('theme=light');

    rerender({ dark: true });
    const next = host.querySelector('iframe')!;
    expect(next.getAttribute('src')).toContain('theme=dark');
    // The `key` is what forces a NEW element. Asserting only the `src` cannot see it —
    // React would have reused the same iframe and a same-document `src` swap does not
    // reliably reload one. Node identity is the property that matters, because the frame
    // reads `theme` once at load.
    expect(next, 'the iframe element itself must be replaced').not.toBe(frame);
  });

  it('shows a mounting veil until the frame is ready', () => {
    const { host, win } = mount();
    expect(host.textContent).toContain('mounting dash');
    ready(win);
    expect(host.textContent).not.toContain('mounting dash');
  });
});

/**
 * The resize handle drags ACROSS the iframe, and the frame's document consumes the
 * pointer events the window is listening for. All three tests here describe the same
 * failure: listeners that outlive the drag and let a later stray move resize the frame.
 */
describe('the resize handle', () => {
  const handle = (host: HTMLElement) =>
    host.querySelector<HTMLElement>('.cursor-ew-resize')!;

  const down = (el: HTMLElement, captured: number[]) => {
    // jsdom has no setPointerCapture; the component calls it optionally, so record it.
    (el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (
      id: number,
    ) => captured.push(id);
    act(() => {
      const e = new MouseEvent('pointerdown', { bubbles: true, clientX: 100 });
      Object.defineProperty(e, 'pointerId', { value: 7 });
      el.dispatchEvent(e);
    });
  };

  const move = (x: number) =>
    act(() => {
      const e = new MouseEvent('pointermove', { bubbles: true, clientX: x });
      window.dispatchEvent(e);
    });

  it('captures the pointer so the iframe cannot swallow the drag', () => {
    const { host } = mount();
    const captured: number[] = [];
    down(handle(host), captured);
    expect(captured).toEqual([7]);
  });

  it('stops resizing on pointercancel, not only on pointerup', () => {
    const { host } = mount();
    down(handle(host), []);
    move(160);
    const afterDrag = handle(host).parentElement!.style.width;
    act(() => window.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true })));
    move(400);
    // Unchanged: a cancelled drag that kept its listeners would have taken this move.
    expect(handle(host).parentElement!.style.width).toBe(afterDrag);
  });

  it('drops an in-flight drag when the host unmounts', () => {
    // Asserted on the teardown itself, not on a symptom: a leaked listener calling
    // `setCustomSize` after unmount does not throw and does not move the DOM, so
    // "nothing happened" is true whether or not the listener was removed.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { host } = mount();
    down(handle(host), []);
    const onMove = add.mock.calls.find(([t]) => t === 'pointermove')?.[1];
    expect(onMove).toBeDefined();
    act(() => root!.unmount());
    root = null;
    expect(remove.mock.calls.some(([t, h]) => t === 'pointermove' && h === onMove)).toBe(true);
  });
});
