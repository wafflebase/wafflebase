/**
 * The scene-patch plugin: serve every scene module with the staged plan applied,
 * and stamped.
 *
 * `enforce: "pre"` for two independent reasons. Its `load()` must win over Vite's
 * own filesystem load, or the unpatched file is served; and the stamped JSX must
 * reach `@vitejs/plugin-react` AS JSX, which only happens if this runs before it.
 *
 * The frame query propagates through `resolveId`: when an importer is qualified,
 * everything first-party it imports is qualified to the same side. That is what
 * makes the two iframes two module graphs rather than two views of one.
 */

import type { Plugin } from 'vite';
import type { MutateRequest, FrameSide } from './protocol.ts';
import { planFiles } from './protocol.ts';
import { fileOf, frameOf, stripFrameQuery, withFrameQuery, type ModuleClassifier } from './frame.ts';
import type { PathGuard } from './paths.ts';
import type { IntentContext } from './intents.ts';
import { applyIntentToCache } from './intents.ts';

/**
 * Accessors, not values. The guard and classifier are rebuilt in `configResolved`
 * once Vite's root is known, so capturing them at plugin-construction time would
 * pin this hook to a `process.cwd()`-rooted guard for the server's whole life.
 */
export interface ScenePatchDeps {
  guard: () => PathGuard;
  classifier: () => ModuleClassifier;
  /** side → the staged layout intents that side's frame renders. */
  plans: Map<FrameSide, MutateRequest[]>;
  /** Lazily loaded so the engine modules are not imported until a scene mounts. */
  intentContext: () => Promise<IntentContext>;
  /**
   * Returns `{ text, stamped }`, not a bare string — `stamp.mjs` reports which nodes it
   * stamped alongside the rewritten source. Declaring it as `=> Promise<string>` was a
   * type LIE that `tsc` could not catch: the stamper is `.mjs` under `allowJs` without
   * `checkJs`, so the hand-written declaration in `plugin/index.ts` was trusted over the
   * JSDoc that contradicted it. See the `load` hook for what that cost.
   */
  stampSource: (text: string, file: string) => Promise<{ text: string; stamped: string[] }>;
  readFile: (abs: string) => Promise<string>;
}

export function scenePatch(deps: ScenePatchDeps): Plugin {
  return {
    name: 'wafflebase-design-editor:scene-patch',
    apply: 'serve',
    enforce: 'pre',

    /**
     * Propagate the importer's frame side onto everything first-party it imports.
     *
     * `skipSelf` is what stops the infinite recursion: `this.resolve` would call
     * back into this same hook with the id we just produced.
     */
    async resolveId(source, importer) {
      const side = frameOf(importer);
      if (!side) return null;
      // Already qualified — nothing to add, and re-qualifying would double the query.
      if (frameOf(source)) return null;

      const resolved = await this.resolve(stripFrameQuery(source), importer, { skipSelf: true });
      if (!resolved) return null;
      if (!deps.classifier().isFirstParty(resolved.id)) return null;
      return withFrameQuery(resolved.id, side);
    },

    async load(id) {
      const side = frameOf(id);
      if (!side) return null;
      const abs = fileOf(id);
      const classifier = deps.classifier();
      if (!classifier.isFirstParty(abs)) return null;

      let text = await deps.readFile(abs);

      // Apply only the intents that target THIS file. `planFiles` reads each
      // intent's anchor, so a plan touching three files patches exactly those three
      // and every other module is served verbatim.
      const plan = deps.plans.get(side) ?? [];
      const rel = deps.guard().relOf(abs);
      if (plan.length && planFiles(plan).has(rel)) {
        const ctx = await deps.intentContext();
        const cache = new Map<string, string>([[abs, text]]);
        for (const intent of plan) {
          const target = (intent.anchor ?? intent.parent)?.file;
          if (target !== rel) continue;
          // A failed locate is NOT fatal here: this is a preview, and refusing to
          // serve the module would blank the frame instead of showing the node the
          // edit could not be applied to. The bridge's `/validate` is what reports
          // the failure to the client.
          await applyIntentToCache(ctx, intent, cache);
        }
        text = cache.get(abs) ?? text;
      }

      // Stamp AFTER patching, so `data-wb-node` indices describe the tree the
      // browser actually renders. Stamping first would number the pre-edit tree and
      // every click after an insert would select the wrong node.
      if (classifier.isStampable(abs)) {
        // `.text`, because `stampSource` returns `{ text, stamped }`. Assigning the
        // whole object here made `load` return something Vite reads as `{ code, map }`
        // — with no `code`, so it treated the hook as having produced NOTHING, fell
        // back, and ultimately served the raw `.tsx` from disk as a static file: 200
        // OK, no error, and a browser that cannot parse JSX. The frame came up blank.
        //
        // Shipped in 8a and invisible until 11b, because nothing had ever mounted a
        // frame — the unit tests exercise `stampSource` directly and the live gate only
        // drove the JSON API.
        ({ text } = await deps.stampSource(text, rel));
      }
      return text;
    },
  };
}
