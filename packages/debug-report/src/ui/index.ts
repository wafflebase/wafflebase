/**
 * The React half of the reporter: the overlay a person aims with, the preview
 * panel they confirm in, and the wiring between them.
 *
 * A SEPARATE ENTRY POINT (`@wafflebase/debug-report/react`) so React stays a
 * peer dependency of this half only. The core entry (`.`) is still free of it —
 * a host with its own UI, or no React at all, can implement `HostAdapter`
 * against the core and never load any of this.
 *
 * Nothing here names an application. The two facts a host has to supply are the
 * canvas locator (`locateOnCanvas` — only the mounted engine knows which cell a
 * point is) and the route it reports; both are parameters, not imports.
 */

export * from './appearance';
export * from './capture-item';
export * from './handover';
export * from './host';
export * from './locate';
export * from './overlay';
export * from './panel';
export * from './session-id';
export * from './use-debug-session';
