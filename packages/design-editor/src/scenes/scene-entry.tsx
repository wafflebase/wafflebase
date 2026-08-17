/**
 * The scene frame's entry, served by the CONSUMER's dev server.
 *
 * NOT PART OF THE SHELL BUNDLE, and that is the whole point. `index.html` is
 * prebuilt with our React so the consumer's Tailwind cannot restyle our chrome;
 * this file is the inverse case — it renders the consumer's components, imports
 * `virtual:wb-scenes`, and needs their `plugin-react` for fast refresh. So it stays
 * source, and `shellServer` points `scene.html` at it.
 *
 * `.tsx` rather than `.ts` even though 11a's body has no JSX: the extension is what
 * routes the file through `plugin-react`, and keeping it stable means the transform
 * path is exercised now rather than first discovered when 11b adds the JSX.
 *
 * WHY IT DOES NOT IMPORT REACT YET. `react` resolved from a file inside our own
 * package would find OUR copy — a devDependency the shell build needs — before the
 * consumer's, and two Reacts in the scene frame breaks hooks in the components
 * under review. The fix (a peer dependency plus `resolve.dedupe`) belongs with the
 * code that needs React, where it can be probed against a consumer that has one.
 * 11a proves the serve path; 11b takes the resolution question.
 */

import { installFetchGuard, installHmrStatePreservation } from './index.ts';

const root = document.getElementById('wb-scene-root');

if (!root) {
  throw new Error('[design-editor] #wb-scene-root missing from the scene document');
}

/**
 * The guard goes in FIRST, before any scene module is imported.
 *
 * Real API modules compute base URLs at module scope and real pages fire queries on
 * mount, so a guard installed after the import has already lost the race — and a
 * request that escapes reaches the consumer's actual backend from inside a frame
 * whose whole premise is that it does not.
 *
 * 11a has no fixtures to serve yet, so every request misses and says so by name.
 * That is the correct behaviour for an empty table, not a placeholder: a scene
 * whose data silently 401s is indistinguishable from a scene that is broken.
 */
installFetchGuard({
  fixtures: {},
  onMiss: (url, method) => {
    // eslint-disable-next-line no-console -- the frame has no other channel until
    // the host connection lands in 11b, and swallowing this is what made the
    // prototype's dead-namespace passthrough invisible for so long.
    console.warn(`[design-editor] scene made an unmocked request: ${method} ${url}`);
  },
});

installHmrStatePreservation();

root.textContent = 'Scene runtime lands in PR 11b.';
root.setAttribute('data-wb-scene-placeholder', '');
