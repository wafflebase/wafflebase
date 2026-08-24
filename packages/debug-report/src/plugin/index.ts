/**
 * The dev-server half: two endpoints, installed as a Vite plugin.
 *
 * A SEPARATE ENTRY POINT (`@wafflebase/debug-report/plugin`) because this runs
 * in Node, reads a model credential and writes to disk — none of which belongs
 * in a module the browser can reach. A consumer installs it in `vite.config.ts`
 * and gets `POST /__wb_debug_report` and `POST /__wb_debug_draft`; the browser
 * half talks to those and nothing else.
 *
 * `.ts` extensions below, unlike the rest of this package: `vite.config.ts`
 * imports this entry and its resolution needs the real filename —
 * `@wafflebase/design-editor`'s plugin entry does the same for the same reason.
 * The browser entries reach their consumer through Vite's alias, which does not.
 */

export * from './report-endpoint.ts';
export * from './draft-endpoint.ts';
