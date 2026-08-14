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
});

describe('message guards', () => {
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
});

describe('viewports', () => {
  it('gives desktop no width, so the pane is not scaled', () => {
    // Real widths, never a transform: a scaled frame reports the wrong breakpoint.
    expect(VIEWPORT_WIDTH.desktop).toBeNull();
    expect(VIEWPORT_WIDTH.mobile).toBe(390);
    expect(VIEWPORT_WIDTH.tablet).toBe(768);
  });
});
