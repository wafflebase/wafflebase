/**
 * The one path the server and the browser client both need.
 *
 * It lived in `plugin/shell.ts`, which imports `node:fs` and `node:path`. The client
 * runs in the BROWSER, so importing it from there would pull Node builtins into a
 * browser bundle. Duplicating the string is the other option and the worse one: the
 * two copies drift and every request 404s with nothing to point at.
 */

/** Where the bridge and the shell live, so neither can collide with a real route. */
export const BASE = '/__design-editor';

/** Where the bridge's JSON API is mounted. */
export const API_BASE = `${BASE}/api`;
