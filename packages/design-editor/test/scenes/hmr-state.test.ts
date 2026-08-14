// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureFrameState, restoreFrameState } from '../../src/scenes/hmr-state.ts';

/** A stamped element, as `stamp.mjs` writes it. Only `data-wb-fp` matters here. */
function stamped(tag: string, fp: string): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.wbFp = fp;
  return el;
}

/** jsdom has no layout, so scroll offsets have to be forced onto the element. */
function scrollable(fp: string, top: number, left = 0): HTMLElement {
  const el = stamped('div', fp);
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: left, writable: true, configurable: true });
  return el;
}

/**
 * jsdom implements no layout and no scrolling, so `window.scrollTo` logs a
 * "Not implemented" error to its virtual console on every call. Stubbed rather than
 * guarded in the source: restoring the page scroll is unconditional ON PURPOSE — a
 * snapshot of (0, 0) still has to be re-applied when the patch itself scrolled the
 * page, so skipping the call for a zero snapshot would break the case it exists for.
 */
window.scrollTo = (() => {}) as typeof window.scrollTo;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('captureFrameState', () => {
  it('keys the focused element on its nearest stamped ancestor', () => {
    // The element you had focused and the one at the same JSX position after the
    // patch are not `===`. `data-wb-fp` is the identifier built to survive exactly
    // that: it excludes className content and the child-tag sequence.
    const wrapper = stamped('div', 'fp-field');
    const input = document.createElement('input');
    wrapper.append(input);
    document.body.append(wrapper);
    input.focus();
    expect(captureFrameState().activeFp).toBe('fp-field');
  });

  it('captures a text field’s selection range', () => {
    const input = stamped('input', 'fp-name') as HTMLInputElement;
    document.body.append(input);
    input.value = 'wafflebase';
    input.focus();
    input.setSelectionRange(2, 5);
    expect(captureFrameState().selection).toEqual({ start: 2, end: 5 });
  });

  it('reports no selection for a non-text focus', () => {
    const btn = stamped('button', 'fp-btn');
    document.body.append(btn);
    btn.focus();
    expect(captureFrameState().selection).toBeNull();
  });

  it('captures only containers that are actually scrolled', () => {
    document.body.append(scrollable('fp-a', 120, 8), scrollable('fp-b', 0, 0));
    expect(captureFrameState().scrolls).toEqual([{ fp: 'fp-a', top: 120, left: 8 }]);
  });

  it('skips an unstamped scroll container, whose offset is unrecoverable', () => {
    // A component that does not spread `{...props}` swallows the attribute, so there
    // is no key to re-find it by after the patch. Skipped rather than guessed.
    const plain = document.createElement('div');
    Object.defineProperty(plain, 'scrollTop', { value: 50, configurable: true });
    document.body.append(plain);
    expect(captureFrameState().scrolls).toEqual([]);
  });

  it('reports no active fp when focus is on nothing stamped', () => {
    expect(captureFrameState().activeFp).toBeNull();
  });
});

describe('restoreFrameState', () => {
  it('re-finds a node by fingerprint and restores focus and selection', () => {
    // The whole point: the pre-patch node is gone, and a NEW element stands in for the
    // same source node.
    const before = stamped('input', 'fp-name') as HTMLInputElement;
    document.body.append(before);
    before.value = 'wafflebase';
    before.focus();
    before.setSelectionRange(1, 4);
    const snap = captureFrameState();

    // Simulate the patch: the element is torn down and rebuilt.
    document.body.replaceChildren();
    const after = stamped('input', 'fp-name') as HTMLInputElement;
    document.body.append(after);
    after.value = 'wafflebase';

    restoreFrameState(snap);
    expect(document.activeElement).toBe(after);
    expect([after.selectionStart, after.selectionEnd]).toEqual([1, 4]);
  });

  it('focuses a text field nested inside the stamped wrapper', () => {
    const wrapper = stamped('div', 'fp-field');
    const input = document.createElement('input');
    wrapper.append(input);
    document.body.append(wrapper);
    restoreFrameState({
      activeFp: 'fp-field',
      selection: null,
      scrolls: [],
      windowScroll: { x: 0, y: 0 },
    });
    expect(document.activeElement).toBe(input);
  });

  it('restores scroll offsets by fingerprint', () => {
    const el = scrollable('fp-list', 0);
    document.body.append(el);
    restoreFrameState({
      activeFp: null,
      selection: null,
      scrolls: [{ fp: 'fp-list', top: 240, left: 12 }],
      windowScroll: { x: 0, y: 0 },
    });
    expect([el.scrollTop, el.scrollLeft]).toEqual([240, 12]);
  });

  it('does nothing when the node did not come back', () => {
    // An HMR patch can remove a node outright; restoring against a tree that no
    // longer has it must not throw.
    expect(() =>
      restoreFrameState({
        activeFp: 'fp-gone',
        selection: { start: 0, end: 1 },
        scrolls: [{ fp: 'fp-also-gone', top: 10, left: 0 }],
        windowScroll: { x: 0, y: 0 },
      }),
    ).not.toThrow();
  });

  it('takes the first match when one fingerprint names several nodes', () => {
    // A `.map()` row renders the same fp N times. Elsewhere in this tool that
    // ambiguity must REFUSE, because it is a write; here it is a read-only nicety, so
    // the worst case is a sibling row's identical field getting the caret.
    const a = stamped('input', 'fp-row') as HTMLInputElement;
    const b = stamped('input', 'fp-row') as HTMLInputElement;
    document.body.append(a, b);
    restoreFrameState({
      activeFp: 'fp-row',
      selection: null,
      scrolls: [],
      windowScroll: { x: 0, y: 0 },
    });
    expect(document.activeElement).toBe(a);
  });

  it('survives a selection range a non-text input rejects', () => {
    // `setSelectionRange` throws on a checkbox.
    const box = stamped('input', 'fp-box') as HTMLInputElement;
    box.type = 'checkbox';
    document.body.append(box);
    expect(() =>
      restoreFrameState({
        activeFp: 'fp-box',
        selection: { start: 0, end: 1 },
        scrolls: [],
        windowScroll: { x: 0, y: 0 },
      }),
    ).not.toThrow();
  });
});
