// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  loadFailureKind,
  pickScene,
  SceneFrame,
  type SceneConfigLike,
} from '../../src/scenes/scene-frame.tsx';
import type { FrameMessage } from '../../src/scenes/frame-protocol.ts';

/**
 * What the frame decides, driven in jsdom.
 *
 * NO REAL BROWSER IS AVAILABLE HERE — `chromium.launch()` fails in this environment,
 * the same constraint the prototype recorded — so nothing below asserts that a scene
 * PAINTS. What it asserts is every decision a wrong contract breaks silently: which
 * export is mounted, which `wb:error` kind each failure reports, that `wb:ready`
 * carries the selectable set, and that a project with no providers module still gets
 * its scene. Each of those failing leaves a blank frame, which reads as a scene that
 * renders nothing rather than as a bug.
 *
 * `SceneFrame` takes its loader and its channel as props precisely so this file does
 * not have to resolve `virtual:wb-scenes`, which the plugin generates at serve time.
 */

let root: Root | null = null;

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

/**
 * Let the loader's promise settle and the post-paint rAF fire.
 *
 * TWO frames, not one. The readiness effect requests its rAF only after `loaded` is
 * set and the re-render has committed, so a single `requestAnimationFrame` awaited here
 * is queued BEFORE theirs and resolves first — which looked exactly like `wb:ready`
 * never being sent.
 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });
  await act(async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const DASH: SceneConfigLike = { id: 'dash', export: 'default', route: '/dash', mocks: [] };

function frame(
  over: Partial<React.ComponentProps<typeof SceneFrame>> = {},
): { el: HTMLElement; sent: FrameMessage[] } {
  const sent: FrameMessage[] = [];
  const el = mount(
    <SceneFrame
      sceneId="dash"
      side="after"
      theme="light"
      config={DASH}
      loadScene={() => Promise.resolve([{ default: () => 'SCENE' }])}
      send={(m) => sent.push(m)}
      selectableIds={() => ['a.tsx#Page:0']}
      renderedClasses={() => ['p-2']}
      {...over}
    />,
  );
  return { el, sent };
}

const kinds = (sent: FrameMessage[]) =>
  sent.filter((m) => m.type === 'wb:error').map((m) => (m as { kind: string }).kind);

describe('mounting', () => {
  it('renders the export the manifest names', async () => {
    const { el, sent } = frame();
    await settle();
    expect(el.textContent).toBe('SCENE');
    expect(kinds(sent)).toEqual([]);
  });

  it('honours a NAMED export rather than assuming default', async () => {
    // Naming it in the manifest is what lets a consumer point at a named export without
    // renaming their own route file.
    const { el } = frame({
      config: { id: 'dash', export: 'Dashboard' },
      loadScene: () => Promise.resolve([{ Dashboard: () => 'NAMED', default: () => 'WRONG' }]),
    });
    await settle();
    expect(el.textContent).toBe('NAMED');
  });

  it('wraps the scene when the consumer declared a providers module', async () => {
    const { el } = frame({
      loadScene: () =>
        Promise.resolve([
          { default: () => 'SCENE' },
          { default: (p: { children: React.ReactNode }) => <>P[{p.children}]</> },
        ]),
    });
    await settle();
    expect(el.textContent).toBe('P[SCENE]');
  });

  it('mounts bare when there is none, which is the ordinary case', async () => {
    const { el } = frame({ loadScene: () => Promise.resolve([{ default: () => 'SCENE' }]) });
    await settle();
    expect(el.textContent).toBe('SCENE');
  });

  it('renders nothing before the module lands, because the host shows the veil', () => {
    const { el } = frame({ loadScene: () => new Promise(() => {}) });
    expect(el.textContent).toBe('');
  });
});

describe('readiness', () => {
  it('announces after paint, carrying the selectable set and the classes', async () => {
    // The host lifts its veil on this and takes the set from it; read before paint the
    // set is empty, which reads as a scene with no editable nodes.
    const { sent } = frame({ side: 'before' });
    await settle();
    expect(sent.find((m) => m.type === 'wb:ready')).toEqual({
      type: 'wb:ready',
      scene: 'dash',
      side: 'before',
      selectable: ['a.tsx#Page:0'],
    });
    expect(sent.find((m) => m.type === 'wb:classes')).toEqual({
      type: 'wb:classes',
      classes: ['p-2'],
    });
  });

  it('does not announce while the module is still loading', () => {
    const { sent } = frame({ loadScene: () => new Promise(() => {}) });
    expect(sent).toEqual([]);
  });

  it('waits a frame, so the selectable set is read after the scene painted', async () => {
    // The rAF is the point of that effect, and asserting only the message CANNOT see
    // it: replacing the `requestAnimationFrame` with a direct `send` failed no test.
    // What separates the two is WHEN the set is read — this counts a `selectableIds`
    // call that has not happened yet at the end of the commit.
    let calls = 0;
    const { sent } = frame({ selectableIds: () => (calls++, ['a.tsx#Page:0']) });
    await act(async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    });
    // The module has landed and the effect has run, but its frame has not fired.
    expect(calls).toBe(0);
    expect(sent.some((m) => m.type === 'wb:ready')).toBe(false);

    await act(async () => {
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    expect(calls).toBe(1);
    expect(sent.some((m) => m.type === 'wb:ready')).toBe(true);
  });
});

describe('failures, by kind', () => {
  it('an unknown scene says so instead of leaving a blank frame', async () => {
    const { el, sent } = frame({ config: undefined, sceneId: 'nope' });
    await settle();
    expect(el.textContent).toMatch(/no scene "nope"/);
    // And REPORTED, not only painted: `SceneHost` lifts its mounting veil on a message,
    // so a frame that fails silently here stays hidden behind it forever.
    expect(kinds(sent)).toEqual(['mount']);
  });

  it('a missing export is a mount error naming what it looked for', async () => {
    const { el, sent } = frame({ loadScene: () => Promise.resolve([{ notIt: () => 'x' }]) });
    await settle();
    expect(kinds(sent)).toEqual(['mount']);
    expect(el.textContent).toMatch(/default export/);
  });

  it('a missing NAMED export names the export, not "default"', async () => {
    const { el } = frame({
      config: { id: 'dash', export: 'Dashboard' },
      loadScene: () => Promise.resolve([{ default: () => 'x' }]),
    });
    await settle();
    expect(el.textContent).toMatch(/export "Dashboard"/);
  });

  it('a transform failure is `compile`, because the host offers undo for it', async () => {
    // Our own write broke the consumer's file. That has a different recovery from a
    // missing dependency, so it cannot share a kind with it.
    const { sent } = frame({
      loadScene: () => Promise.reject(new Error('Transform failed with 1 error: Unexpected ")"')),
    });
    await settle();
    expect(kinds(sent)).toEqual(['compile']);
  });

  it('any other load failure is `mount`', async () => {
    const { sent } = frame({
      loadScene: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    });
    await settle();
    expect(kinds(sent)).toEqual(['mount']);
  });

  it('a throw from the scene’s own render is `render`, and is caught', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { el, sent } = frame({
      loadScene: () =>
        Promise.resolve([
          {
            default: () => {
              throw new Error('boom');
            },
          },
        ]),
    });
    await settle();
    expect(kinds(sent)).toEqual(['render']);
    expect(el.textContent).toMatch(/boom/);
    spy.mockRestore();
  });
});

describe('loadFailureKind', () => {
  it('reads a transform or parse failure as compile', () => {
    for (const m of [
      'Transform failed with 1 error',
      'Parse error at line 3',
      'Unexpected token',
      'expected ")" but found ";"',
    ]) {
      expect(loadFailureKind(m), m).toBe('compile');
    }
  });

  it('reads anything else as mount', () => {
    for (const m of ['Failed to fetch dynamically imported module', 'ENOENT', '']) {
      expect(loadFailureKind(m), m).toBe('mount');
    }
  });
});

describe('pickScene', () => {
  it('throws rather than returning nothing when the export is absent', () => {
    // Returning nothing would render a blank frame, which is the failure mode this
    // whole file exists to make impossible.
    expect(() => pickScene([{}], DASH)).toThrow(/no default export/);
    expect(() => pickScene([], DASH)).toThrow(/no default export/);
    expect(() => pickScene(undefined, DASH)).toThrow(/no default export/);
  });

  it('takes providers from `default` or from `SceneProviders`', () => {
    const P = () => null;
    expect(pickScene([{ default: P }, { default: P }], DASH).Providers).toBe(P);
    expect(pickScene([{ default: P }, { SceneProviders: P }], DASH).Providers).toBe(P);
  });

  it('ignores a providers module that exports no component', () => {
    expect(pickScene([{ default: () => null }, { nope: 1 }], DASH).Providers).toBeUndefined();
  });
});
