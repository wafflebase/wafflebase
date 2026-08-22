/**
 * Vite's own client types, for `import.meta.hot`.
 *
 * `scenes/hmr-state.ts` wires capture/restore to Vite's HMR lifecycle, which is the
 * one place this package touches a Vite-injected global rather than a Vite API it
 * imported. `vite` is already a peer and dev dependency, so this reference costs no
 * new package — it only tells `tsc` the global exists.
 */
/// <reference types="vite/client" />
