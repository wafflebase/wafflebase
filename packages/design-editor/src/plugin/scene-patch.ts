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
import type { MutateRequest, FrameSide } from './protocol';
import { planFiles } from './protocol';
import { fileOf, frameOf, stripFrameQuery, withFrameQuery, type ModuleClassifier } from './frame';
import type { PathGuard } from './paths';
import type { IntentContext } from './intents';
import { applyIntentToCache } from './intents';

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
  stampSource: (text: string, file: string) => Promise<string>;
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
        text = await deps.stampSource(text, rel);
      }
      return text;
    },
  };
}
