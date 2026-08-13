/**
 * The scene manifest, and the virtual module the editor imports it through.
 *
 * A "scene" is one route of the consumer's app, mounted in an iframe so its UI can
 * be judged in real states. The manifest says which routes those are — and
 * `design-editor-local-plugin.md` §5 is explicit that authoring it, not the AST
 * work, is the real onboarding cliff.
 *
 * `virtual:wb-scenes` exists because the loaders must be STATICALLY ANALYSABLE.
 * A runtime `import(sceneFile)` built from a string would leave Vite's dependency
 * scanner blind to the scene's own subtree, and the first mount would trigger
 * "new dependencies optimized, reloading" — a full page reload of the frame
 * mid-session, which throws away the selection and reads as a crash. Generating a
 * module with literal `import()` specifiers is what makes the scan happen at
 * startup instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FrameSide } from './protocol.ts';

export interface SceneConfig {
  id: string;
  kind: 'dom' | 'canvas';
  label: string;
  /** Root-relative path to the route's source file. */
  file: string;
  export?: string;
  route?: string;
  /**
   * The router PATTERN to register, when it differs from the literal `route`.
   *
   * `route: "/w/ws-fixture"` is a navigable fixture path; `routePattern:
   * "/w/:workspaceId"` is what the page's own `useParams()` needs present in the
   * matched route to resolve at all. Registering the literal path as both meant a
   * page reading a param got `{}` back, and every param-gated data query
   * (`enabled: !!workspaceId`) silently disabled itself. Absent, falls back to
   * `route`.
   */
  routePattern?: string;
  /**
   * Mount the scene inside the app's own shell rather than bare.
   *
   * Not decoration: a route nested under a layout route is an `<Outlet/>` BODY,
   * and rendered bare it is a padded box floating in an empty viewport — every
   * judgement about width, gutters and the header relationship is then made
   * against the wrong container.
   */
  shell?: 'app';
  mocks?: string[];
  fixtures?: Record<string, string>;
  viewports?: string[];
  readOnly?: boolean;
  /**
   * Keep the entry and its notes, but generate no loader.
   *
   * For a scene that is a stated intent rather than something that can mount
   * today. Deleting the entry would lose the reasoning, and leaving it live is not
   * free even if never clicked: the specifier is statically analysable, so Vite's
   * scanner crawls a subtree that may not resolve — startup noise at best, and a
   * mid-session re-optimize plus frame reload at worst.
   */
  deferred?: boolean;
}

export interface ScenesManifest {
  components?: string[];
  scenes?: SceneConfig[];
}

export const SCENES_VIRTUAL_ID = 'virtual:wb-scenes';
export const SCENES_RESOLVED_ID = `\0${SCENES_VIRTUAL_ID}`;

/**
 * Read the manifest, tolerating absence.
 *
 * A missing or malformed manifest yields an EMPTY one rather than throwing. The
 * plugin is dev-only and the manifest is the consumer's to author, so a typo in it
 * must not take down their dev server — they get an editor with no scenes, which
 * says what is wrong far better than a stack trace during config resolution.
 *
 * `manifestPath` is null when the consumer configured no `scenes` at all, which is
 * the state of every project before onboarding.
 */
export function readManifest(manifestPath: string | null): ScenesManifest {
  // Silent for "not configured", which is every project before onboarding.
  if (!manifestPath) return { components: [], scenes: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ScenesManifest;
    return { components: raw.components ?? [], scenes: raw.scenes ?? [] };
  } catch (err) {
    // But NOT silent for a manifest that exists and does not parse. Returning empty
    // without saying so is how a typo becomes "the editor has no scenes and I cannot
    // tell why" — the failure mode this tolerance exists to avoid, inverted.
    console.warn(`[design-editor] could not read scene manifest ${manifestPath}: ${String(err)}`);
    return { components: [], scenes: [] };
  }
}

/**
 * The import specifier for one scene file, frame-qualified.
 *
 * ALWAYS `/@fs/`, which is a simplification the pivot earns. The prototype
 * preferred the consumer's `@` alias and fell back to `/@fs/`, because the alias
 * form also resolves under `vite build` — but the plugin is `apply: "serve"` and
 * a dev-only tool by declared Non-Goal, so there is no build for a specifier to
 * survive. Preferring an alias here would mean the plugin had to KNOW the
 * consumer's alias config, which is precisely the coupling §6 removes: the
 * prototype's version resolved every path against `packages/frontend/src`.
 *
 * Absolute POSIX separators, because `/@fs/` is a URL path and not a filesystem
 * path — on Windows the backslashes would not survive the round trip.
 */
export function sceneSpecifier(root: string, rel: string, side: FrameSide): string {
  const abs = path.resolve(root, rel);
  return `/@fs/${abs.split(path.sep).join('/')}?wbFrame=${side}`;
}

/** The same, for the consumer's providers module (absolute already). */
export function providersSpecifier(abs: string, side: FrameSide): string {
  return `/@fs/${abs.split(path.sep).join('/')}?wbFrame=${side}`;
}

/**
 * Generate the `virtual:wb-scenes` module body.
 *
 * Two loaders per scene, one per frame side, each importing the scene AND the
 * providers module at that side. Both have to be side-qualified: providers wrap
 * the scene, so a single shared providers module would put the two sides' trees in
 * one React realm, and the engines' module-level state would be shared between
 * "before" and "after".
 *
 * A scene with no providers configured still gets a loader — it renders bare,
 * which is wrong-looking for a nested route but is not a crash, and refusing to
 * generate anything would leave the editor with no scenes and no explanation.
 */
export function renderScenesModule(
  root: string,
  manifest: ScenesManifest,
  providersAbs: string | null,
): string {
  const mountable = (manifest.scenes ?? []).filter(
    (s) => (s.kind === 'dom' || s.kind === 'canvas') && !s.deferred,
  );

  // DE-DUPLICATE BY ID, first entry wins. The loader table is keyed by
  // `${id}|${side}`, so a duplicate id silently overwrote the earlier entry while
  // BOTH scenes stayed in the exported list: the outline showed two rows and one of
  // them loaded the other's file. Same rule as `findJsxRoots`' `ambiguous` set —
  // ambiguity is reported, not resolved by picking.
  const seen = new Set<string>();
  const scenes: SceneConfig[] = [];
  const duplicates: string[] = [];
  for (const s of mountable) {
    if (seen.has(s.id)) {
      duplicates.push(s.id);
      continue;
    }
    seen.add(s.id);
    scenes.push(s);
  }
  if (duplicates.length) {
    console.warn(
      `[design-editor] duplicate scene id(s) dropped: ${duplicates.join(', ')} — ` +
        'each id must be unique; the first entry was kept',
    );
  }

  const cases = scenes
    .flatMap((s) =>
      (['before', 'after'] as const).map((side) => {
        const imports = [`import(${JSON.stringify(sceneSpecifier(root, s.file, side))})`];
        if (providersAbs) {
          imports.push(`import(${JSON.stringify(providersSpecifier(providersAbs, side))})`);
        }
        return (
          `  ${JSON.stringify(`${s.id}|${side}`)}: () => Promise.all([\n` +
          imports.map((i) => `    ${i},`).join('\n') +
          `\n  ]),`
        );
      }),
    )
    .join('\n');

  return `// GENERATED by @wafflebase/design-editor — do not edit.
export const scenes = ${JSON.stringify(scenes, null, 2)};

const loaders = {
${cases}
};

export const loadScene = (id, side) => {
  const load = loaders[id + '|' + side];
  if (!load) return Promise.reject(new Error('no such scene: ' + id + ' (' + side + ')'));
  return load();
};

export const hasProviders = ${providersAbs ? 'true' : 'false'};
`;
}
