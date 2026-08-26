/**
 * Reporting a defect from inside the scene frame.
 *
 * The design editor is the second host of `@wafflebase/debug-report`, and this
 * file is the whole of it: an adapter and a mount. The overlay, the preview
 * panel, the capture and the transport are the package's.
 *
 * REACHED ONLY THROUGH `debug-report.tsx`, and never statically. This is the one
 * file under `src/scenes` that imports the reporter, so keeping it behind that
 * module's `React.lazy` is what makes the package an OPTIONAL peer rather than a
 * hard requirement of every design-editor consumer. See there for the gate.
 *
 * **IT MOUNTS IN THE FRAME, NOT THE SHELL, AND THAT IS THE ONE DECISION HERE.**
 * The shell is chrome; the scene is the thing being judged. An overlay in the
 * shell could not name anything inside the scene — `elementFromPoint` there
 * returns the `<iframe>`, not the button whose padding is wrong — so a report
 * would carry a picture and no selector, which is the failure the package's
 * promotion rules exist to prevent. In the frame it sees the real elements, and
 * the selector it records is one a grep can find in the consumer's source.
 *
 * ONE REACT, measured rather than argued. Asked of a live design-sandbox dev
 * server, `react` resolves to the SAME optimizer chunk from all four importers
 * that matter here — the frame entry, this file, the reporter's own
 * `overlay.tsx`, and a `packages/frontend/src` component under review. No alias
 * for `@wafflebase/debug-report` is needed either: its exports map points at
 * `src/`, so pnpm's link resolves the subpath on its own. What the reporter DOES
 * need built is `@wafflebase/core/geometry`, which resolves into
 * `packages/core/dist` — the same requirement the host stylesheet already had.
 *
 * NO CANVAS LOCATOR. A scene is DOM, so `locateOnCanvas` is deliberately
 * omitted: any canvas a scene happens to contain becomes a region, which is the
 * honest answer for a surface this host cannot interrogate. Wafflebase's app
 * supplies engine locators because it has engines; a design editor does not.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { HostAdapter } from '@wafflebase/debug-report';
import { debugSession } from '@wafflebase/debug-report';
import { createDevHost, DebugOverlay, DEBUG_SESSION_ID } from '@wafflebase/debug-report/react';
import type { FrameSide } from './frame-protocol.ts';

export type DebugReportFrameProps = {
  /** The scene on screen — the design editor's equivalent of a route. */
  sceneId: string;
  /** `before` or `after`: the same scene, two transforms of it. */
  side: FrameSide;
  theme: 'light' | 'dark';
  /**
   * Told whenever the reporter arms or disarms.
   *
   * The shell needs it to leave Pick mode while a report is being aimed —
   * picking suppresses the product's own click handlers, which is the opposite
   * of what someone reporting on the running interface needs. Only the frame
   * knows, because only the frame holds the session.
   */
  onLiveChange?: (live: boolean) => void;
};

/**
 * What a report says about where it happened.
 *
 * Deliberately NOT the frame's URL. That query string carries the fixture and
 * mock-data flags, and a report is read by an agent looking for source — the
 * scene id and the side are what identify the thing on screen, and nothing else
 * on that URL helps.
 */
export function sceneRoute(sceneId: string, side: FrameSide): string {
  return `scene:${sceneId || 'unknown'}/${side}`;
}

/**
 * The whole adapter: three facts, and one deliberate omission.
 *
 * `read` is a getter rather than two values so the component can hold the host
 * across renders while still reporting the latest route and theme.
 *
 * NO `locateOnCanvas`, which is what makes `locate()` answer `undefined` and the
 * overlay fall back to a region for any canvas a scene happens to paint. Pinned
 * by a test, because the honest answer here is easy to "fix" into a wrong one.
 */
export function createSceneHost(read: () => { route: string; theme: string }): HostAdapter {
  return createDevHost({
    route: () => read().route,
    theme: () => read().theme,
    // The design editor's analogue of a document type: every frame is a scene.
    documentType: () => 'scene',
  });
}

export function DebugReportInFrame({
  sceneId,
  side,
  theme,
  onLiveChange,
}: DebugReportFrameProps) {
  const route = sceneRoute(sceneId, side);
  /*
   * Built ONCE, reading the latest values through refs — the same shape as
   * wafflebase's own `src/debug/mount.tsx`, for the same reason. `DebugPanel`
   * keys its drafting effect on the host's IDENTITY, so a host rebuilt per
   * render restarts the model call on every re-render of the overlay.
   */
  const latest = useRef({ route, theme });
  latest.current = { route, theme };
  const host = useMemo(() => createSceneHost(() => latest.current), []);

  /*
   * Subscribed to the SESSION rather than lifted out of the overlay's props,
   * because the mode changes from inside it — the hotkey, and `Esc` peeling the
   * last layer off. The session is the one thing both see.
   *
   * Edge-triggered: only a change in liveness is reported, so the mode moving
   * between `idle`, `region` and `describing` — all live — posts nothing. The
   * host would otherwise be told to leave Pick mode it had already left, and
   * each redundant message is a re-render of the frame's parent.
   */
  const wasLive = useRef(false);
  useEffect(() => {
    if (!onLiveChange) return;
    const read = () => {
      const live = debugSession.mode() !== 'off';
      if (live === wasLive.current) return;
      wasLive.current = live;
      onLiveChange(live);
    };
    read();
    return debugSession.subscribe(read);
  }, [onLiveChange]);

  return <DebugOverlay route={route} host={host} sessionId={DEBUG_SESSION_ID} />;
}

/**
 * Default export, so the slot can reach this module through `React.lazy`.
 */
export default DebugReportInFrame;
