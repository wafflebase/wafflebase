import { describe, expect, it } from 'vitest';
import {
  isFrameMessage,
  isHostMessage,
  parseStampId,
  sceneFrameUrl,
  stampId,
  VIEWPORT_WIDTH,
} from '../../src/scenes/frame-protocol.ts';
import { BASE } from '../../src/base.ts';

describe('sceneFrameUrl', () => {
  it('points at the plugin mount, not the bare document', () => {
    // The prototype returned `/scene.html?…`, which was right when the editor WAS
    // the Vite app. The shipped shell serves both documents under `BASE` and maps
    // exactly `/scene` onto `scene.html`, so a root-relative URL never reaches the
    // shell middleware — it 404s in the CONSUMER's app instead.
    const url = sceneFrameUrl({ scene: 'dashboard', side: 'after', theme: 'light' });
    expect(url.startsWith(`${BASE}/scene?`)).toBe(true);
    expect(url).not.toContain('scene.html');
  });

  it('carries the scene, side and theme the frame reads at load', () => {
    const q = new URLSearchParams(
      sceneFrameUrl({ scene: 'home', side: 'before', theme: 'dark' }).split('?')[1],
    );
    expect(Object.fromEntries(q)).toEqual({ scene: 'home', frame: 'before', theme: 'dark' });
  });

  it('adds the mock-data flag only when set, since it is read once per load', () => {
    expect(sceneFrameUrl({ scene: 'a', side: 'after', theme: 'light' })).not.toContain('empty');
    expect(
      sceneFrameUrl({ scene: 'a', side: 'after', theme: 'light', mockDataEmpty: true }),
    ).toContain('empty=1');
  });

  it('encodes a scene id that needs it', () => {
    const url = sceneFrameUrl({ scene: 'a/b c', side: 'after', theme: 'light' });
    expect(url).toContain('scene=a%2Fb+c');
    expect(new URLSearchParams(url.split('?')[1]).get('scene')).toBe('a/b c');
  });
});

describe('stampId', () => {
  it('round-trips a file, root and path', () => {
    const id = stampId('app/pages/home.tsx', 'Home', [0, 1, 2]);
    expect(id).toBe('app/pages/home.tsx#Home:0.1.2');
    expect(parseStampId(id)).toEqual({
      file: 'app/pages/home.tsx',
      component: 'Home',
      path: [0, 1, 2],
    });
  });

  it('keeps the file in the id, because a bare stamp is not unique', () => {
    // A shell scene paints layout, sidebar and page in ONE document, and `Page` is
    // a common root name — two files can both contribute `Page:0.1`.
    const a = stampId('app/a.tsx', 'Page', [0, 1]);
    const b = stampId('app/b.tsx', 'Page', [0, 1]);
    expect(a).not.toBe(b);
    expect(parseStampId(a)?.file).toBe('app/a.tsx');
  });

  it('round-trips a root node, whose path is empty', () => {
    const id = stampId('a.tsx', 'Page', []);
    expect(id).toBe('a.tsx#Page:');
    expect(parseStampId(id)).toEqual({ file: 'a.tsx', component: 'Page', path: [] });
  });

  it('splits on the LAST colon, so a root name may contain one', () => {
    expect(parseStampId('a.tsx#Card:Header:0')).toEqual({
      file: 'a.tsx',
      component: 'Card:Header',
      path: [0],
    });
  });

  it('returns null for anything malformed rather than a wrong anchor', () => {
    for (const bad of [
      '',
      'nofile',
      '#Page:0',
      'a.tsx#Page',
      'a.tsx#:0',
      'a.tsx#Page:x',
      'a.tsx#Page:-1',
      'a.tsx#Page:0.5.x',
    ]) {
      expect(parseStampId(bad), bad).toBeNull();
    }
  });

  it('rejects a segment that is not digits, where `Number` was permissive', () => {
    // `Number('')` is 0, so an empty segment parsed as index 0 and the id resolved to
    // a real but DIFFERENT node — selected, scrolled to and measured, which is the
    // wrong anchor the list above exists to rule out. Ids arrive from the host over
    // `postMessage`, so this is reachable without a stamper bug.
    for (const bad of [
      'a.tsx#Page:0.', // trailing separator
      'a.tsx#Page:.0', // leading separator
      'a.tsx#Page:0..1', // doubled separator
      'a.tsx#Page:1e2', // an integer to `Number`, not a path index
      'a.tsx#Page: 1', // whitespace `Number` would trim
      'a.tsx#Page:+1',
    ]) {
      expect(parseStampId(bad), bad).toBeNull();
    }
    // The shape `stampId` actually emits still round-trips.
    expect(parseStampId('a.tsx#Page:0.12.3')?.path).toEqual([0, 12, 3]);
    expect(parseStampId('a.tsx#Page:')?.path).toEqual([]);
  });
});

describe('message guards', () => {
  const REF = {
    id: 'a.tsx#Page:0',
    component: 'Page',
    path: [0],
    fp: 'deadbeef',
    tag: 'div',
    file: 'a.tsx',
    instances: 1,
  };
  const RECT = { x: 0, y: 0, width: 10, height: 10 };

  it('accepts only namespaced objects', () => {
    expect(isHostMessage({ type: 'wb:set-theme', theme: 'dark' })).toBe(true);
    expect(isFrameMessage({ type: 'wb:deselect' })).toBe(true);
    // The frame shares a window with real product code and with anything the host
    // page runs; an un-namespaced message is somebody else's.
    for (const bad of [null, undefined, 'wb:ready', 42, {}, { type: 7 }, { type: 'ready' }]) {
      expect(isHostMessage(bad), JSON.stringify(bad)).toBe(false);
      expect(isFrameMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects a namespaced payload whose fields do not inhabit the variant', () => {
    // The `wb:` prefix alone narrowed these to the union, so a listener read
    // `msg.node.id` off `undefined`, or applied `'system'` as a theme, with the type
    // system saying both were safe. These cross a `postMessage` boundary between two
    // documents, so "the other side is our own code" is a claim about the page.
    for (const bad of [
      { type: 'wb:set-theme', theme: 'system' },
      { type: 'wb:set-theme' },
      { type: 'wb:measure', id: 'a' },
      { type: 'wb:measure', id: 'a', nonce: 'x' },
      { type: 'wb:set-picking', enabled: 'yes' },
      { type: 'wb:set-selection', id: 7 },
      { type: 'wb:set-token-vars', vars: { '--a': 1 } },
      { type: 'wb:unknown-host-verb' },
    ]) {
      expect(isHostMessage(bad), JSON.stringify(bad)).toBe(false);
    }

    for (const bad of [
      { type: 'wb:select' },
      { type: 'wb:select', node: { id: 'a' }, rect: RECT, altKey: false },
      { type: 'wb:select', node: REF, rect: { x: 0 }, altKey: false },
      { type: 'wb:select', node: REF, rect: RECT },
      { type: 'wb:ready', scene: 'a', side: 'sideways', selectable: [] },
      { type: 'wb:ready', scene: 'a', side: 'before', selectable: [7] },
      { type: 'wb:error', kind: 'whoops', message: 'x' },
      { type: 'wb:measured', nonce: 1, rect: { x: 0, y: 0 } },
      { type: 'wb:classes', classes: 'p-2' },
      { type: 'wb:unknown-frame-verb' },
    ]) {
      expect(isFrameMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('still accepts every well-formed variant', () => {
    // The rejection list is only meaningful if the guard has not simply become strict
    // enough to refuse real traffic.
    for (const ok of [
      { type: 'wb:set-theme', theme: 'light' },
      { type: 'wb:set-selection', id: null },
      { type: 'wb:set-hover', id: 'a.tsx#Page:0' },
      { type: 'wb:measure', id: 'a.tsx#Page:0', nonce: 3 },
      { type: 'wb:set-picking', enabled: false },
      { type: 'wb:set-token-vars', vars: { '--primary': '#0f0' } },
    ]) {
      expect(isHostMessage(ok), JSON.stringify(ok)).toBe(true);
    }

    for (const ok of [
      { type: 'wb:ready', scene: 'dash', side: 'before', selectable: ['a'] },
      { type: 'wb:select', node: REF, rect: RECT, altKey: true },
      { type: 'wb:hover', node: null, rect: null },
      { type: 'wb:hover', node: REF, rect: RECT },
      { type: 'wb:measured', nonce: 1, rect: null },
      { type: 'wb:error', kind: 'fetch', message: 'boom', url: '/x' },
      { type: 'wb:error', kind: 'mount', message: 'boom' },
      { type: 'wb:classes', classes: [] },
      { type: 'wb:route-change', path: '/x' },
      { type: 'wb:deselect' },
    ]) {
      expect(isFrameMessage(ok), JSON.stringify(ok)).toBe(true);
    }
  });

  it('does not read a variant off Object.prototype', () => {
    // `shapes[d.type]` without an own-property check hands `"constructor"` a function,
    // which is truthy and then called as if it were a validator.
    for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isHostMessage({ type: t }), t).toBe(false);
      expect(isFrameMessage({ type: t }), t).toBe(false);
    }
  });
});

describe('viewports', () => {
  it('gives desktop no width, so the pane is not scaled', () => {
    // Real widths, never a transform: a scaled frame reports the wrong breakpoint.
    expect(VIEWPORT_WIDTH.desktop).toBeNull();
    expect(VIEWPORT_WIDTH.mobile).toBe(390);
    expect(VIEWPORT_WIDTH.tablet).toBe(768);
  });
});
