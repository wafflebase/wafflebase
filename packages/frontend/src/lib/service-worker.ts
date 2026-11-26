/**
 * Registers the offline app-shell worker that the build writes as `sw.js`
 * (`service-worker/`; design in docs/design/frontend.md § Offline app shell).
 *
 * Production builds only: the dev server writes no worker, and a worker left
 * controlling `localhost:5173` would serve stale modules to the next session.
 * `VITE_SERVICE_WORKER=off` is the deployment's switch, and it has to undo as
 * well as skip: a worker installed by an earlier build outlives the build, so
 * turning it off unregisters it rather than merely not registering again.
 *
 * Desktop app only, for now: the worker is registered only where the desktop
 * shell marks the page (`isDesktopShell`). A web visitor gets none, and one an
 * earlier build installed in their browser is unregistered the same way.
 */
export function setUpServiceWorker(options: {
  production: boolean;
  setting: string | undefined;
  /** Running inside the desktop app (`isDesktopShell()`). */
  desktop: boolean;
  base: string;
  container: ServiceWorkerContainer | undefined;
}): Promise<void> {
  const { container } = options;
  if (!options.production || !container) return Promise.resolve();

  const off = (options.setting ?? "").trim().toLowerCase() === "off";
  if (off || !options.desktop) {
    return container
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((r) => r.unregister())),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  }

  // `updateViaCache: "none"` makes every update check fetch `sw.js` from the
  // network: GitHub Pages serves it with a ten-minute max-age, which would
  // otherwise hold a new deploy's worker back by that long. A failed
  // registration (private mode, a blocked origin) leaves the app exactly as
  // it was before this existed, so it is not reported.
  return container
    .register(`${options.base}sw.js`, {
      scope: options.base,
      updateViaCache: "none",
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Whether this page runs inside the Wafflebase desktop app. The shell injects
 * `window.__WAFFLEBASE_DESKTOP__` into every page it loads, before the page's
 * own scripts (`packages/desktop`, `DESKTOP_MARKER_SCRIPT`). A capability
 * flag, not an identity: a page that sets it on itself in a browser only gets
 * the offline worker, which is harmless.
 */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__WAFFLEBASE_DESKTOP__" in window;
}
