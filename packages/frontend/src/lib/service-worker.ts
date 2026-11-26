/**
 * Registers the offline app-shell worker that the build writes as `sw.js`
 * (`service-worker/`; design in docs/design/frontend.md § Offline app shell).
 *
 * Production builds only: the dev server writes no worker, and a worker left
 * controlling `localhost:5173` would serve stale modules to the next session.
 * `VITE_SERVICE_WORKER=off` is the deployment's switch, and it has to undo as
 * well as skip: a worker installed by an earlier build outlives the build, so
 * turning it off unregisters it rather than merely not registering again.
 */
export function setUpServiceWorker(options: {
  production: boolean;
  setting: string | undefined;
  base: string;
  container: ServiceWorkerContainer | undefined;
}): Promise<void> {
  const { container } = options;
  if (!options.production || !container) return Promise.resolve();

  if ((options.setting ?? "").trim().toLowerCase() === "off") {
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
