/**
 * `wafflebaseCore()` — the `TokenAdapter` for wafflebase's own four-file token pipeline.
 *
 * THIS IS THE IMPLEMENTATION THE SEAM WAS BUILT FOR. `design-editor-local-plugin.md` §4
 * argues the seam from this pipeline's shape: a token lives in four TypeScript files, its
 * value may be an expression rather than a literal, and creating one is a coordinated
 * write across THREE files. Every part of the contract that looked like over-generality
 * in 8b — `plan()` returning a list, `TokenWrite.required`, `regenerate()` existing at all
 * — is here because of something below. Two of them are exercised for real for the first
 * time in this file: 8b could only reach them through a fake adapter, because
 * `cssVariables` writes one file and has no emitter to re-run.
 *
 * THE PIPELINE, per family:
 *
 *   source const (`packages/core/src/tokens/*.ts`)
 *     → emitter list (`packages/core/scripts/build-css.ts`)
 *       → `@theme inline` alias (`packages/frontend/src/index.css`)
 *
 * The first two are load-bearing and the third is best-effort, which is exactly the
 * `required` distinction: without the const the file does not typecheck, without the
 * emitter entry the token never reaches `tokens.css`, and without the alias the token
 * exists and simply is not reachable as a utility class.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PORT CORRECTED, and how it was found.
 *
 * The prototype's `FAMILY` table wrote emitter expressions as `` radius.${camel} `` and
 * `` typography.${camel} ``. Both COMPILE and both produce a correct `tokens.css` on a
 * real build, so nothing fails loudly — `build-css.ts` imports all four token objects at
 * module level, so the bare identifier resolves.
 *
 * But the emitters also receive those objects as a `src` PARAMETER, and that is the
 * distinction: `src` is the text `preview-tokens.mts` was handed, while the module import
 * is the file on disk. Measured, patching `radius.base` to `9rem` and rendering:
 * `['--radius', src.radius.base]` previews `9rem`, and a bare `radius.base` would have
 * previewed the on-disk `0.3rem`. So a token created with the prototype's expression
 * previews its PRE-EDIT value — and for a token that does not exist on disk yet, that is
 * `undefined`. The preview silently stops agreeing with what a save writes, which is the
 * one property `preview-tokens.mts` exists to guarantee.
 *
 * The correct prefix therefore comes from each emitter's own body, not from the token's
 * name — checked against `build-css.ts` rather than inferred:
 *
 *   | emitter          | in scope                      | prefix         |
 *   | ---------------- | ----------------------------- | -------------- |
 *   | `semanticBlock`  | `const m = src.semantic[mode]` | `m.`           |
 *   | `paletteBlock`   | `const { palette } = src`      | `palette.`     |
 *   | `rootOnlyBlock`  | `src` only                     | `src.radius.`  |
 *   |                  |                                | `src.typography.` |
 *
 * The prototype was right for two of four — `paletteBlock` destructures FROM `src`, so
 * its bare-looking `palette.` is patched-correct by luck of the destructuring, and
 * `semanticBlock`'s `m.` was already the parameter form.
 * ---------------------------------------------------------------------------
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { normaliseSource } from '@wafflebase/design-editor';
import type {
  TokenAdapter,
  TokenBinding,
  TokenEdit,
  TokenEmitResult,
  TokenFamily,
  TokenFamilyMeta,
  TokenRef,
  TokenRegenResult,
  TokenTree,
  TokenWrite,
  TokenWriteResult,
} from '@wafflebase/design-editor';
import { createPreviewWorker, type PreviewSources, type PreviewWorker } from './preview-worker';

const execFileAsync = promisify(execFile);

/**
 * The token half of the AST mutator, as this adapter uses it.
 *
 * Declared locally and cast, rather than imported with types. `inject.mjs` ships no
 * declaration file on purpose — an adjacent `.d.mts` SHADOWS its implementation, so tsc
 * loads the declaration, drops the implementation from the program, and the file's own
 * `// @ts-check` silently stops running (measured: a planted type error gave 0 errors
 * with the declaration present, 3 without it). So a TypeScript consumer states the subset
 * it depends on, which `cssVariables` already does for the `@theme` helpers and which has
 * the useful side effect of documenting exactly how much of the mutator is reachable from
 * here.
 */
interface Injector {
  applyTokenValue(
    text: string,
    i: { constName: string; path: string[]; value: string; valueKind: 'literal' | 'expression' },
  ): TokenWriteResult;
  insertSemanticToken(text: string, i: { camelKey: string; value: string }): TokenWriteResult;
  removeSemanticToken(text: string, i: { camelKey: string }): TokenWriteResult;
  insertConstMember(
    text: string,
    i: { constName: string; key: string; value: string },
  ): TokenWriteResult;
  removeConstMember(text: string, i: { constName: string; key: string }): TokenWriteResult;
  insertBlockEmit(
    text: string,
    i: { fnName: string; cssVar: string; expr: string },
  ): TokenWriteResult;
  removeBlockEmit(text: string, i: { fnName: string; cssVar: string }): TokenWriteResult;
  insertThemeMapping(text: string, i: { cssVar: string; mapTo: string }): TokenWriteResult;
  removeThemeMapping(text: string, i: { cssVar: string }): TokenWriteResult;
  readSemanticBindings(text: string): {
    located: boolean;
    bindings?: Record<'light' | 'dark', Record<string, { kind: string; value?: string; ref?: string }>>;
    reason?: string;
  };
  readPaletteColors(text: string): { located: boolean; colors?: TokenRef[]; reason?: string };
  readConstLeaves(
    text: string,
    constName: string,
  ): { located: boolean; leaves?: { path: string[]; value: string }[]; reason?: string };
  readThemeMappings(text: string): { located: boolean; mappings?: string[]; reason?: string };
}

/** Root-relative paths of the pipeline. Wafflebase's own layout, by definition. */
const PATHS = {
  semantic: 'packages/core/src/tokens/semantic.ts',
  palette: 'packages/core/src/tokens/palette.ts',
  radius: 'packages/core/src/tokens/radius.ts',
  typography: 'packages/core/src/tokens/typography.ts',
  /** The generator. A new token must be registered here or it never reaches the CSS. */
  buildCss: 'packages/core/scripts/build-css.ts',
  /** The app's Tailwind theme map — where a variable becomes a utility class. */
  themeCss: 'packages/frontend/src/index.css',
  /** Where both child processes run. */
  corePackage: 'packages/core',
  /** What `regenerate()` produces, and therefore what the plugin must push. */
  tokensCss: 'packages/core/dist/tokens.css',
} as const;

/** The four whose text the emitter evaluates, in the worker's own protocol order. */
const SOURCE_KEYS = ['palette', 'semantic', 'radius', 'typography'] as const;
type SourceKey = (typeof SOURCE_KEYS)[number];

interface FamilyPipeline {
  /** Which of the four source files holds this family. */
  sourceKey: SourceKey;
  /**
   * The const a value edit addresses, or `null` where it depends on the theme.
   *
   * `semantic.ts` is `export const semantic = { light, dark }` built from two SEPARATE
   * top-level consts, so a semantic value edit targets `light` or `dark` by name. That is
   * why the prototype took `constName` from the client — and taking it from the theme
   * instead is what removes the client's last say over where a write lands, which is the
   * rule 8b established for `file` and §6 records as the coupling this enumeration missed.
   */
  constName: string | null;
  /** Emitter function in `build-css.ts` the token must be listed in. */
  emitFn: string;
  /** Prefix for the emitter expression. See this file's header for why each is what it is. */
  exprPrefix: string;
  /** Everything the client needs to author in this family, minus the file. */
  meta: Omit<TokenFamilyMeta, 'file'>;
}

const FAMILIES: Record<TokenFamily, FamilyPipeline> = {
  semantic: {
    sourceKey: 'semantic',
    constName: null,
    emitFn: 'semanticBlock',
    exprPrefix: 'm.',
    meta: {
      family: 'semantic',
      label: 'Color',
      cssVarPrefix: '--',
      themeVarPrefix: '--color-',
      utilityPrefix: 'bg-',
      placeholder: 'oklch(0.7 0.1 250)',
      defaultValue: 'oklch(0.7 0.1 250)',
    },
  },
  palette: {
    sourceKey: 'palette',
    constName: 'palette',
    emitFn: 'paletteBlock',
    exprPrefix: 'palette.',
    meta: {
      family: 'palette',
      label: 'Palette',
      cssVarPrefix: '--wb-',
      themeVarPrefix: '--color-wb-',
      utilityPrefix: 'bg-wb-',
      placeholder: '#B8651A',
      defaultValue: '#B8651A',
    },
  },
  radius: {
    sourceKey: 'radius',
    constName: 'radius',
    emitFn: 'rootOnlyBlock',
    exprPrefix: 'src.radius.',
    meta: {
      family: 'radius',
      label: 'Radius',
      cssVarPrefix: '--radius-',
      themeVarPrefix: '--radius-',
      utilityPrefix: 'rounded-',
      placeholder: '0.5rem',
      defaultValue: '0.5rem',
    },
  },
  typo: {
    sourceKey: 'typography',
    constName: 'typography',
    emitFn: 'rootOnlyBlock',
    exprPrefix: 'src.typography.',
    meta: {
      family: 'typo',
      label: 'Font',
      cssVarPrefix: '--font-',
      themeVarPrefix: '--font-',
      utilityPrefix: 'font-',
      placeholder: '"Inter", ui-sans-serif, system-ui, sans-serif',
      defaultValue: '"Inter", ui-sans-serif, system-ui, sans-serif',
    },
  },
};

export interface WafflebaseCoreOptions {
  /**
   * Absolute path to the repository root. REQUIRED.
   *
   * The plugin is told the same value through `designEditor({ root })`, and the
   * duplication is deliberate rather than a missing wire: `TokenAdapter` has no
   * initialisation hook, and giving it one so a value could be pushed in would add a
   * lifecycle method to the contract for the sake of a single argument. An adapter that
   * legitimately reads a different tree than the one being served is also expressible
   * this way and would not be if the root were injected.
   */
  root: string;
  /**
   * Executable that runs the two emitter scripts. Defaults to `pnpm`.
   *
   * Configurable only because it is the one part of this file that is about the machine
   * rather than about wafflebase, and because a test that wants to prove the failure path
   * needs a command that fails.
   */
  packageManager?: string;
  /** Per-preview-request ceiling in ms. Defaults to the worker's own 15 s. */
  previewTimeoutMs?: number;
}

/**
 * The adapter, narrowed by what this pipeline always has.
 *
 * `regenerate` is OPTIONAL on `TokenAdapter` because `cssVariables` genuinely has no
 * emitter to re-run — the write is the emission there. This pipeline always has one, so
 * saying so here means a caller holding a `WafflebaseCoreAdapter` never has to check;
 * leaving it optional made every call site in the tests assert non-null, which is the
 * type system pointing out that the narrower type was the true one.
 *
 * `dispose()` is NOT part of `TokenAdapter` at all: `cssVariables` owns nothing to dispose,
 * and adding a lifecycle method every adapter must implement to serve the one that spawns a
 * child process would put this pipeline's shape back into the generic contract — the
 * inversion §4 asks for, undone.
 */
export type WafflebaseCoreAdapter = TokenAdapter & {
  regenerate(): Promise<TokenRegenResult>;
  dispose(): void;
};

export function wafflebaseCore(options: WafflebaseCoreOptions): WafflebaseCoreAdapter {
  const root = path.resolve(options.root);
  const coreCwd = path.join(root, PATHS.corePackage);
  const pm = options.packageManager ?? 'pnpm';

  let injectorPromise: Promise<Injector> | null = null;
  const injector = (): Promise<Injector> =>
    (injectorPromise ??= import('@wafflebase/design-editor/injector') as unknown as Promise<Injector>);

  /**
   * Disposal is tracked HERE as well as in the worker, because `previewWorker()` is a
   * `??=` factory: clearing `worker` alone means the next `read()` or `emit()` spawns a
   * fresh child that nobody will ever dispose. A request can arrive after the dev server
   * closed — an in-flight `/tokens` during shutdown is the ordinary case — so refusing is
   * the difference between an answered error and an orphaned `tsx` process.
   */
  let disposed = false;
  const DISPOSED_ERROR = 'token adapter disposed';

  let worker: PreviewWorker | null = null;
  const previewWorker = (): PreviewWorker =>
    (worker ??= createPreviewWorker({
      cwd: coreCwd,
      command: pm,
      args: ['exec', 'tsx', 'scripts/preview-tokens.mts'],
      timeoutMs: options.previewTimeoutMs,
    }));

  /** `--primary-foreground` etc., from the family's prefix and the kebab key. */
  const propOf = (family: TokenFamily, kebabKey: string) =>
    `${FAMILIES[family].meta.cssVarPrefix}${kebabKey}`;
  const themeVarOf = (family: TokenFamily, kebabKey: string) =>
    `${FAMILIES[family].meta.themeVarPrefix}${kebabKey}`;
  const fileOf = (family: TokenFamily) => PATHS[FAMILIES[family].sourceKey];

  /**
   * The four texts the emitter evaluates, or the first one that is missing.
   *
   * Keyed through `normaliseSource`, the same function `sources()` maps over. The two
   * agree today only because these `PATHS` values happen to be normal form already; going
   * through the normalizer is what makes that a guarantee rather than a coincidence, since
   * the plugin compares these paths as strings and a mismatch fails every `emit()`.
   */
  const previewSources = (files: Record<string, string>): PreviewSources | { error: string } => {
    const out = {} as PreviewSources;
    for (const key of SOURCE_KEYS) {
      const rel = normaliseSource(PATHS[key]);
      const text = files[rel];
      if (text == null) return { error: `no text supplied for ${rel}` };
      out[key] = text;
    }
    return out;
  };

  return {
    /**
     * All six, not just the four the emitter reads.
     *
     * `sources()` is two things at once (see the contract): the external-change watch
     * list AND the CSS-regen gate. A member edit writes `build-css.ts` and `index.css`
     * too, so leaving either out would mean editing it in your own editor goes
     * unreported — and the next `add-member` then locates against text it never saw.
     */
    sources: () =>
      [
        PATHS.semantic,
        PATHS.palette,
        PATHS.radius,
        PATHS.typography,
        PATHS.buildCss,
        PATHS.themeCss,
      ].map(normaliseSource),

    /**
     * The tree, with values from the EMITTER rather than from the source text.
     *
     * A value in `semantic.ts` may be `palette.syrup` or a template literal, so reading
     * text would report an expression where the panel needs a colour. Running the real
     * emitter over the current sources is the same operation `emit()` performs on patched
     * ones, which is what keeps the panel's "current" and its "preview" comparable — if
     * they came from two different code paths, a no-op edit could appear to change
     * something.
     *
     * Throws when the worker cannot answer. The bridge's `GET /tokens` wraps this, so a
     * throw is reported to the client as an error; returning an empty tree instead would
     * render as "this project has no tokens", which is a lie about a fixable problem.
     */
    async read(readFile: (rel: string) => Promise<string>): Promise<TokenTree> {
      if (disposed) throw new Error(DISPOSED_ERROR);
      const [semantic, palette, radius, typography, themeCss] = await Promise.all([
        readFile(PATHS.semantic),
        readFile(PATHS.palette),
        readFile(PATHS.radius),
        readFile(PATHS.typography),
        readFile(PATHS.themeCss),
      ]);
      const inj = await injector();

      const rendered = await previewWorker().render({ palette, semantic, radius, typography });
      if (!rendered.ok) throw new Error(rendered.error ?? 'token preview failed');

      const sem = inj.readSemanticBindings(semantic);
      const pal = inj.readPaletteColors(palette);
      const theme = inj.readThemeMappings(themeCss);

      /**
       * A source read that could not find its const is a FAILURE, not an empty result.
       *
       * The same argument as the worker throw above, applied to the other half of `read()`:
       * these three carry `located` and `reason`, and swallowing them turns a renamed const
       * in `semantic.ts` into "this family has no bindings" — a lie about a fixable
       * problem, and one the panel would render as an empty list.
       *
       * `theme.mappings` below is deliberately NOT in this set. A project whose stylesheet
       * has no `@theme inline` block is valid: every token stays editable and none is
       * reachable as a utility class, which is exactly what `cssVariables` degrades to.
       */
      if (!sem.located) throw new Error(`semantic bindings not located: ${sem.reason ?? 'unknown'}`);
      if (!pal.located) throw new Error(`palette colours not located: ${pal.reason ?? 'unknown'}`);

      /**
       * Narrow the injector's four kinds onto the contract's three.
       *
       * `palette` is the only one that is safely REBINDABLE — the whole initializer is a
       * reference, so swapping it for another swatch preserves the meaning. `computed`
       * and `other` are expressions where a swatch may be an ingredient rather than the
       * value: wafflebase has exactly two, both
       * `` `rgba(${palette.butterRgb}, 0.30)` ``, and offering those as a rebind would
       * drop the alpha. They map to `expression`, which the contract defines as locked.
       *
       * The default branch is `expression`, so an injector kind added later is locked
       * rather than silently treated as rebindable — the safe direction to fail.
       */
      const bindingOf = (b: { kind: string; value?: string; ref?: string }): TokenBinding => {
        if (b.kind === 'literal') return { kind: 'literal', value: b.value ?? '' };
        if (b.kind === 'palette') return { kind: 'ref', value: b.ref ?? '' };
        return { kind: 'expression', value: b.value ?? b.ref ?? '' };
      };

      const themed = { light: {}, dark: {} } as Record<
        'light' | 'dark',
        Record<string, TokenBinding>
      >;
      for (const mode of ['light', 'dark'] as const) {
        for (const [key, b] of Object.entries(sem.bindings?.[mode] ?? {})) {
          themed[mode][key] = bindingOf(b);
        }
      }

      /**
       * Source values for members the emitter does not publish.
       *
       * `radius` carries `base`/`sm`/`md`/`lg`/`xl` and only `base` becomes `--radius`;
       * the rest are derived inside the app's `@theme` block. So four of the five have no
       * entry in `vars` at all, and a panel with only `vars` to read would show them
       * blank. Checked against `build-css.ts#rootOnlyBlock` and `index.css`, not assumed.
       */
      const leavesOf = (text: string, constName: string): Record<string, string> => {
        const r = inj.readConstLeaves(text, constName);
        // Same rule as the two reads above: a missing const is reported, not blanked.
        if (!r.located) throw new Error(`const ${constName} not located: ${r.reason ?? 'unknown'}`);
        return Object.fromEntries((r.leaves ?? []).map((l) => [l.path.join('.'), l.value]));
      };

      return {
        vars: { light: rendered.light ?? {}, dark: rendered.dark ?? {} },
        // Empty rather than absent when `index.css` has no `@theme` block — the same
        // degradation `cssVariables` reports, for the same reason: every token stays
        // editable, none is reachable as a class.
        utilities: theme.mappings ?? [],
        families: (Object.keys(FAMILIES) as TokenFamily[]).map((f) => ({
          ...FAMILIES[f].meta,
          file: fileOf(f),
        })),
        bindings: {
          themed,
          refs: (pal.colors ?? []).filter((c) => c.isColor),
          leaves: {
            radius: leavesOf(radius, 'radius'),
            typo: leavesOf(typography, 'typography'),
          },
        },
      } satisfies TokenTree;
    },

    /**
     * The three-point write, and the first plan in this codebase to span several FILES.
     *
     * Deterministic and filesystem-free, as the contract requires: it is called once to
     * resolve the file set and again to apply, and a plan that differed between the two
     * would have the plugin read one set of files and write another. Every branch below
     * is a pure function of `edit`, which is what makes that hold by construction rather
     * than by discipline.
     */
    plan(edit: TokenEdit): TokenWrite[] | { error: string } {
      const fam = FAMILIES[edit.family];
      if (!fam) return { error: `unknown token family: ${edit.family}` };

      if (edit.kind === 'set-value') {
        // Derived from the theme, never taken from `edit.constName`. For semantic that is
        // the `light`/`dark` const; for the other three the family has exactly one const
        // and the theme is irrelevant, because nobody ships a different border radius in
        // dark mode.
        const constName = fam.constName ?? edit.theme;
        if (!edit.path.length) return { error: 'set-value needs a path' };
        return [
          {
            file: fileOf(edit.family),
            required: true,
            label: `${constName}.${edit.path.join('.')}`,
            apply: async (text) =>
              (await injector()).applyTokenValue(text, {
                constName,
                path: edit.path,
                value: edit.value,
                valueKind: edit.valueKind,
              }),
          },
        ];
      }

      const adding = edit.kind === 'add-member';
      const cssVar = propOf(edit.family, edit.kebabKey);
      const themeVar = themeVarOf(edit.family, edit.kebabKey);
      const isSemantic = edit.family === 'semantic';

      return [
        {
          file: fileOf(edit.family),
          required: true,
          label: `${edit.camelKey} in ${fileOf(edit.family)}`,
          apply: async (text) => {
            const inj = await injector();
            // `semantic` needs the bespoke injector: its token has to be added to BOTH
            // the `light` and `dark` consts and to the `SemanticColorMap` type, which no
            // generic const-member insert expresses. The other three are one flat const.
            if (isSemantic) {
              return adding
                ? inj.insertSemanticToken(text, { camelKey: edit.camelKey, value: edit.value })
                : inj.removeSemanticToken(text, { camelKey: edit.camelKey });
            }
            const constName = fam.constName!;
            return adding
              ? inj.insertConstMember(text, { constName, key: edit.camelKey, value: edit.value })
              : inj.removeConstMember(text, { constName, key: edit.camelKey });
          },
        },
        {
          file: PATHS.buildCss,
          required: true,
          label: `${cssVar} in ${fam.emitFn}()`,
          apply: async (text) => {
            const inj = await injector();
            return adding
              ? inj.insertBlockEmit(text, {
                  fnName: fam.emitFn,
                  cssVar,
                  expr: `${fam.exprPrefix}${edit.camelKey}`,
                })
              : inj.removeBlockEmit(text, { fnName: fam.emitFn, cssVar });
          },
        },
        {
          // Optional, and the reason `required` exists. "Already mapped" is a legitimate
          // no-op on insert, a project with no `@theme` block is valid, and on removal a
          // partially-present token must stay removable — refusing there would leave the
          // half-created state permanently unfixable through this API.
          file: PATHS.themeCss,
          required: false,
          label: `${themeVar} alias`,
          apply: async (text) => {
            const inj = await injector();
            return adding
              ? inj.insertThemeMapping(text, { cssVar: themeVar, mapTo: cssVar })
              : inj.removeThemeMapping(text, { cssVar: themeVar });
          },
        },
      ];
    },

    /**
     * Render the variable map these source texts produce, without writing.
     *
     * The plugin supplies every `sources()` entry patched where an edit touched it; only
     * the four the emitter evaluates are forwarded. `build-css.ts` and `index.css` are
     * deliberately NOT: a patched emitter cannot be previewed, because the worker imports
     * `tokenBlocks` from the real module on disk. So a freshly created token has no
     * preview until the commit regenerates — a real limit of this pipeline, reported as
     * an absent variable rather than a wrong one.
     */
    async emit(files: Record<string, string>): Promise<TokenEmitResult> {
      // Returned rather than thrown, unlike `read()`: `emit()`'s contract is a result
      // object, and the preview path already reports every other failure that way.
      if (disposed) return { ok: false, error: DISPOSED_ERROR };
      const sources = previewSources(files);
      if ('error' in sources) return { ok: false, error: sources.error };
      return previewWorker().render(sources);
    },

    /**
     * Re-run the real generator.
     *
     * The method §4 says `emit()` cannot stand in for, and the half 8b could only fake.
     * `tokens.css` is generated from `.ts`, so the write is not the emission: without this
     * a saved token edit changes source, leaves the stylesheet the frontend actually
     * serves untouched, and reads as "I saved and nothing happened".
     *
     * The failure is RETURNED, not swallowed. The prototype's note on its own version is
     * the reason: it collapsed every failure into a bare `false`, which is precisely how
     * that symptom becomes silent.
     */
    async regenerate(): Promise<TokenRegenResult> {
      try {
        await execFileAsync(pm, ['exec', 'tsx', 'scripts/build-css.ts'], {
          cwd: coreCwd,
          // Bounded for the same reason the preview worker bounds a render: the bridge
          // AWAITS this during a save, so an emitter that hangs answers the client with
          // nothing at all rather than with a failure. A cold `tsx` start is ~2 s, so
          // this ceiling is generous by two orders of magnitude and only ever fires on a
          // genuinely stuck child.
          timeout: 120_000,
          // Node's default is 1 MB, and exceeding it rejects with ENOBUFS — which this
          // catch would report as "regeneration failed" even though the CSS was written.
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // First line only: `execFile`'s message carries the whole command line and the
        // child's output, and the client shows this in a toast.
        return { ok: false, error: `tokens.css regeneration failed: ${msg.split('\n')[0]}` };
      }
      // Absolute, per the contract. It lives in a `dist/` folder outside the Vite root,
      // which is exactly why the adapter has to name it: whether the Tailwind plugin
      // registered it as a watch dependency is not something to bet the preview loop on.
      return { ok: true, artifacts: [path.join(root, PATHS.tokensCss)] };
    },

    dispose() {
      // Set BEFORE tearing the worker down, so a request arriving during shutdown is
      // refused rather than racing the `??=` factory into a fresh child process.
      disposed = true;
      worker?.dispose();
      worker = null;
    },
  };
}

/** Root-relative paths this adapter reads and writes. Exported for the sandbox's tests. */
export const COREPATHS = PATHS;
