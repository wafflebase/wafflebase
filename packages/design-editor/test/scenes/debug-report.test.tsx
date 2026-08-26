// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { debugSession } from '@wafflebase/debug-report';
import { DRAFT_ENDPOINT, REPORT_ENDPOINT } from '@wafflebase/debug-report/react';
import {
  DebugReportSlot,
  REPORTER_FLAG,
  reporterEnabled,
} from '../../src/scenes/debug-report.tsx';
import {
  createSceneHost,
  DebugReportInFrame,
  sceneRoute,
} from '../../src/scenes/debug-report-host.tsx';

/**
 * The design editor as the reporter's SECOND host.
 *
 * What the package already pins, this file does not repeat: that the overlay
 * renders nothing while idle and never takes the pointer is
 * `packages/debug-report/src/ui/overlay.test.tsx`'s subject. What is only true
 * here is the composition — that the adapter this frame builds reports the SCENE
 * as its route, the frame's own theme rather than the document's, and no canvas
 * locator; that mounting it in the frame's tree produces a working reporter
 * rather than a component that renders and does nothing; and that an unarmed
 * frame gets none of it.
 *
 * NEEDS `pnpm core build`. The reporter's overlay imports
 * `@wafflebase/core/geometry`, whose exports map points into `packages/core/dist`.
 * `verify:fast` builds core before it reaches this package; a bare
 * `pnpm --filter @wafflebase/design-editor test` on a fresh checkout has to.
 *
 * Raw `createRoot` + `act`, matching `scene-frame.test.tsx`: this package has no
 * `@testing-library/react`.
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
 * Let a `React.lazy` factory settle. A macrotask, not a microtask chain: the
 * factory is a real dynamic import going through the test runner's loader.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Dispatched on `document`, as a real key press arrives: the overlay listens on
 * `window` in the capture phase, so it sees the event on the way down.
 */
function press(init: KeyboardEventInit): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

const TOGGLE = { key: 'Y', ctrlKey: true, shiftKey: true };
const ARMED = { [REPORTER_FLAG]: '1' };

beforeEach(() => {
  debugSession.clear();
  debugSession.setMode('off');
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  debugSession.clear();
  debugSession.setMode('off');
});

describe('sceneRoute', () => {
  it('names the scene and the side, which is what identifies the thing on screen', () => {
    expect(sceneRoute('documents/list', 'after')).toBe('scene:documents/list/after');
    expect(sceneRoute('documents/list', 'before')).toBe('scene:documents/list/before');
  });

  it('says `unknown` rather than nothing when the frame was given no scene', () => {
    // `scene-entry.tsx` reads `params.get('scene') ?? ''`, so an empty id is
    // reachable — a frame opened by hand, or a manifest whose scene went away.
    // Interpolating it raw produced `scene:/after`, which reads as a route with a
    // blank segment rather than as a missing one.
    expect(sceneRoute('', 'after')).toBe('scene:unknown/after');
    expect(sceneRoute('', 'before')).toBe('scene:unknown/before');
  });

  it('is not the frame URL, whose other params help no one reading a report', () => {
    const route = sceneRoute('documents/list', 'after');
    for (const param of ['theme=', 'frame=', 'empty=', '?']) {
      expect(route).not.toContain(param);
    }
  });
});

describe('reporterEnabled', () => {
  it('is off when nothing asked for it', () => {
    // The default matters more than any other case here: an unarmed frame must
    // neither load the reporter nor open its capture store.
    expect(reporterEnabled({})).toBe(false);
    expect(reporterEnabled({ [REPORTER_FLAG]: undefined })).toBe(false);
  });

  it('accepts the forms a shell or an .env file actually produces', () => {
    for (const value of ['1', 'true', 'TRUE', 'on', ' 1 ']) {
      expect(reporterEnabled({ [REPORTER_FLAG]: value }), value).toBe(true);
    }
    // A `define` can hand through a real boolean rather than a string.
    expect(reporterEnabled({ [REPORTER_FLAG]: true })).toBe(true);
  });

  it('treats every unrecognised value as off, so a typo cannot arm it', () => {
    for (const value of ['0', 'false', '', 'off', 'yes', 'no', '2', 'debug']) {
      expect(reporterEnabled({ [REPORTER_FLAG]: value }), value).toBe(false);
    }
    expect(reporterEnabled({ [REPORTER_FLAG]: false })).toBe(false);
    expect(reporterEnabled({ [REPORTER_FLAG]: 1 })).toBe(false);
  });

  it('reads the flag this package documents, not a neighbouring one', () => {
    expect(REPORTER_FLAG).toBe('VITE_WB_DEBUG_REPORT');
    expect(reporterEnabled({ VITE_WB_DEBUG: '1' })).toBe(false);
  });
});

describe('createSceneHost', () => {
  it('reports the scene route and the frame’s own theme, not the document’s', () => {
    // The frame receives `?theme=` and paints itself; `document.documentElement`
    // is what the package would otherwise read, and here it is the wrong answer.
    document.documentElement.dataset.theme = 'light';
    const host = createSceneHost(() => ({ route: 'scene:login/after', theme: 'dark' }));
    expect(host.route()).toBe('scene:login/after');
    expect(host.theme()).toBe('dark');
    expect(host.environment().theme).toBe('dark');
    expect(host.environment().route).toBe('scene:login/after');
    delete document.documentElement.dataset.theme;
  });

  it('marks every frame a scene, which is this host’s document type', () => {
    const host = createSceneHost(() => ({ route: 'scene:login/after', theme: 'light' }));
    expect(host.environment().documentType).toBe('scene');
  });

  it('re-reads the getter, so a host built once still reports the current route', () => {
    let current = { route: 'scene:a/after', theme: 'light' };
    const host = createSceneHost(() => current);
    expect(host.route()).toBe('scene:a/after');
    current = { route: 'scene:b/before', theme: 'dark' };
    expect(host.route()).toBe('scene:b/before');
    expect(host.environment().theme).toBe('dark');
  });

  it('cannot name a canvas point, and says so by answering undefined', async () => {
    // The omission is the decision: a scene is DOM, this host mounts no engine,
    // and the overlay's fallback — a region — is the honest answer. Supplying a
    // locator that guessed would put a wrong address in a report.
    const host = createSceneHost(() => ({ route: 'scene:a/after', theme: 'light' }));
    await expect(host.locate({ x: 12, y: 34 })).resolves.toBeUndefined();
  });
});

describe('DebugReportInFrame', () => {
  it('paints nothing in the scene until the hotkey is pressed', () => {
    // The scene is the thing being judged. A reporter that added so much as an
    // outline to an unarmed frame would be measuring the instrument.
    const host = mount(<DebugReportInFrame sceneId="documents/list" side="after" theme="light" />);
    expect(host.innerHTML).toBe('');
    expect(document.querySelectorAll('[data-wb-debug]')).toHaveLength(0);
  });

  it('turns into a live reporter on the toggle, carrying the scene route', () => {
    // The composition proof: the adapter, the overlay and the session are wired
    // to each other in THIS tree, and the badge shows the route this host made.
    mount(<DebugReportInFrame sceneId="documents/list" side="before" theme="dark" />);
    press(TOGGLE);
    const badge = document.querySelector('[data-testid="debug-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('scene:documents/list/before');
    // `idle` IS the aiming mode. #961 removed the separate `pick`, whose only
    // effect was painting the hover outline that is now always on while live.
    expect(debugSession.mode()).toBe('idle');
  });

  it('leaves the scene alone again when the reporter is turned off', () => {
    const host = mount(<DebugReportInFrame sceneId="login" side="after" theme="light" />);
    press(TOGGLE);
    expect(document.querySelector('[data-testid="debug-badge"]')).not.toBeNull();
    press(TOGGLE);
    expect(host.innerHTML).toBe('');
    expect(debugSession.mode()).toBe('off');
  });

  it('never intercepts a pointer event with its overlay layer', () => {
    // The overlay layer covers the whole viewport while live. It is a picture,
    // not a surface: taking the pointer would stop the scene tracking hover and
    // destroy the very state a report is usually about.
    mount(<DebugReportInFrame sceneId="login" side="after" theme="light" />);
    press(TOGGLE);
    const layer = document.querySelector<HTMLElement>('[data-testid="debug-overlay"]');
    expect(layer).not.toBeNull();
    expect(layer!.style.pointerEvents).toBe('none');
  });
});

describe('DebugReportSlot', () => {
  it('is empty in a frame nobody armed, hotkey or not', async () => {
    const host = mount(<DebugReportSlot sceneId="login" side="after" theme="light" env={{}} />);
    await settle();
    press(TOGGLE);
    await settle();
    expect(host.innerHTML).toBe('');
    expect(document.querySelector('[data-testid="debug-badge"]')).toBeNull();
    // Not merely hidden: the overlay was never mounted, so nothing subscribed to
    // the session and nothing opened the capture store.
    expect(debugSession.mode()).toBe('off');
  });

  it('loads the reporter when armed, and the hotkey then works', async () => {
    mount(<DebugReportSlot sceneId="login" side="after" theme="dark" env={ARMED} />);
    await settle();
    press(TOGGLE);
    const badge = document.querySelector('[data-testid="debug-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('scene:login/after');
  });

  it('shows nothing while the reporter is still arriving', () => {
    // Rendered but not yet settled: the `Suspense` fallback is `null`, so the
    // scene is never made to wait behind a spinner of ours.
    const host = mount(<DebugReportSlot sceneId="login" side="after" theme="light" env={ARMED} />);
    expect(host.innerHTML).toBe('');
  });
});

/**
 * The frame's fetch guard refuses every URL no fixture covers, and the reporter
 * lives inside the frame — so its own two endpoints have to be named as ours.
 *
 * They are named there by a regex rather than by importing these constants,
 * because `fetch-fixtures.ts` is in EVERY frame's module graph and importing the
 * reporter there would make it a hard dependency of frames that never asked for
 * one. This test is the joint: it holds that duplication to the real values, so
 * renaming an endpoint fails here instead of turning into a "Scene fetch error"
 * the next time somebody hands a report over.
 */
describe('the frame guard lets the reporter reach its own endpoints', () => {
  const passesGuard = (url: string) => {
    const path = new URL(url, 'http://scene.invalid').pathname;
    return /(?:^|\/)__wb_debug_(?:report|draft)$/.test(path);
  };

  it('passes both endpoints the plugin serves', () => {
    expect(passesGuard(REPORT_ENDPOINT)).toBe(true);
    expect(passesGuard(DRAFT_ENDPOINT)).toBe(true);
  });

  it('passes them under a consumer base path, which the frame cannot know', () => {
    expect(passesGuard(`/some/base${REPORT_ENDPOINT}`)).toBe(true);
  });

  it('does NOT pass a consumer route that merely starts the same way', () => {
    // The reason the pattern is anchored rather than a `__wb_` prefix: a loose
    // one is a passthrough for paths only a consumer could own.
    expect(passesGuard('/__wb_debug_reporter')).toBe(false);
    expect(passesGuard('/__wb_debug_report/extra')).toBe(false);
    expect(passesGuard('/__wb_admin')).toBe(false);
  });
});
