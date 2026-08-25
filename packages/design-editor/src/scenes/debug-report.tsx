/**
 * Whether this frame carries the bug reporter, and the boundary that loads it.
 *
 * TWO JOBS, AND THE SPLIT FROM `debug-report-host.tsx` IS WHY THIS FILE EXISTS:
 * nothing here value-imports `@wafflebase/debug-report`, so a frame that was not
 * asked for a reporter never resolves that specifier at all. `React.lazy` calls
 * its factory on first render and never before — the same shape wafflebase's own
 * `App.tsx` uses for the app-side mount.
 *
 * That is what lets `@wafflebase/debug-report` be an OPTIONAL peer of this
 * package. `test/plugin/peer-contract.test.ts` requires every runtime bare
 * import under `src/scenes` to be a declared peer, because these files are served
 * BY PATH and resolved from the CONSUMER's `node_modules`. A static import would
 * make the reporter mandatory for every consumer of the design editor — a 500 at
 * frame load for a project that never wanted it.
 *
 * **THE GATE IS OFF BY DEFAULT BECAUSE THE OVERLAY IS NOT INERT WHEN IDLE.**
 * Mounted with the mode `off` it renders nothing and takes no pointer event —
 * measured, and pinned by `test/scenes/debug-report.test.tsx` — but
 * `useDebugSession` opens the capture store regardless: an IndexedDB connection,
 * a `localStorage` read, and a write back under one fixed key. That cost is right
 * for an app, which is one document per tab. It is wrong here, because the editor
 * reloads the frame on every theme / scene / mock-data flip and can serve TWO
 * frames of one scene (`before` and `after`) on ONE origin, where the store
 * refuses the second writer as foreign and the badge then reports the session as
 * unpersistable. `docs/design/debug-report.md` asks for exactly this gate, in the
 * words "no listener, no capture budget, no session in storage until someone asks
 * for one".
 *
 * AN ENV FLAG, not a frame-URL param and not a plugin option, because the
 * reporter's two halves have to be armed together: without `debugReportPlugin`
 * in the same `vite.config.ts` there is nowhere to hand a report to, and Hand
 * over answers 404. So the opt-in lives where the plugin does — the consumer's
 * dev-server config — and both are one restart. `?report=1` on the frame URL is
 * the shape the design doc suggests and the upgrade path if that restart proves
 * to be real friction; it needs a param on `sceneFrameUrl` plus a control in the
 * shell, which is more machinery than a dev opt-in has yet earned.
 */

import { lazy, Suspense } from 'react';
import type { FrameSide } from './frame-protocol.ts';

/** The env flag a consumer sets to arm the reporter in their scene frames. */
export const REPORTER_FLAG = 'VITE_WB_DEBUG_REPORT';

/**
 * Every unrecognised value is OFF, including `0`, `false` and the empty string:
 * a typo must never silently arm a reporter.
 */
export function reporterEnabled(env: Record<string, unknown>): boolean {
  const flag = env[REPORTER_FLAG];
  // A `define` can hand through a real boolean where an `.env` file gives a string.
  if (flag === true) return true;
  if (typeof flag !== 'string') return false;
  const value = flag.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

/**
 * Resolved once per frame load, at module scope.
 *
 * The factory does not run until `DebugReportSlot` renders something, which is
 * what keeps the import out of an unarmed frame's module graph.
 */
const DebugReportInFrame = lazy(() => import('./debug-report-host.tsx'));

export type DebugReportSlotProps = {
  sceneId: string;
  side: FrameSide;
  theme: 'light' | 'dark';
  /** Injected by tests. Defaults to this frame's own build-time env. */
  env?: Record<string, unknown>;
  /** Forwarded to the reporter; see `DebugReportFrameProps`. */
  onLiveChange?: (live: boolean) => void;
};

/**
 * The reporter's place in the frame, empty unless it was asked for.
 *
 * `Suspense` with a `null` fallback: there is nothing to show while the chunk
 * arrives, and the scene under review must not be made to wait for it.
 */
export function DebugReportSlot({
  sceneId,
  side,
  theme,
  env,
  onLiveChange,
}: DebugReportSlotProps) {
  if (!reporterEnabled(env ?? (import.meta.env as unknown as Record<string, unknown>))) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <DebugReportInFrame
        sceneId={sceneId}
        side={side}
        theme={theme}
        onLiveChange={onLiveChange}
      />
    </Suspense>
  );
}
