/**
 * `cssVariables()` — the default `TokenAdapter`, for projects whose tokens are plain
 * CSS custom properties in one stylesheet.
 *
 * THIS IS THE ONE PART OF THE TOKEN HALF WITH NO PROTOTYPE TO PORT.
 * `design-editor-local-plugin.md` §4 and §6 both flag it: `feat/design-system` has
 * only wafflebase's four-file TypeScript pipeline, so nothing here could be verified
 * by diffing against existing behaviour. Two consequences, both deliberate:
 *
 *   - the CSS primitive it stands on (`./css-decls`) is a separate module with its own
 *     direct tests, rather than being reachable only through this adapter;
 *   - every non-obvious behaviour below was probed against REAL stylesheets — the
 *     generated `packages/core/dist/tokens.css` and a shadcn-CLI-shaped `index.css` —
 *     before it was written, and the findings are recorded as comments where they
 *     apply rather than summarised somewhere else.
 *
 * It covers the shadcn population, which §4 identifies as the common case and, notably,
 * the SIMPLER one: one stylesheet, `:root` / `.dark` blocks, `@theme inline` aliases,
 * and no generator — so `regenerate()` is absent and the write itself is the emission.
 */

import {
  declMap,
  insertDecl,
  isSafeDeclarationValue,
  readDecls,
  removeDecl,
  setDecl,
  type CssEditResult,
} from './css-decls';
import { normaliseSource } from './adapter';
import type {
  TokenAdapter,
  TokenEdit,
  TokenEmitResult,
  TokenFamily,
  TokenFamilyMeta,
  TokenTree,
  TokenWrite,
} from './adapter';

export interface CssVariablesOptions {
  /**
   * The stylesheet holding the token blocks, root-relative.
   *
   * One file, because that is what the population this adapter targets actually has.
   * A project that splits tokens across several stylesheets is a `TokenAdapter` of its
   * own — which is the entire point of the seam.
   */
  stylesheet: string;
  /** Selector for the base theme. Defaults to `:root`. */
  rootSelector?: string;
  /**
   * Selector for the dark theme. Defaults to `.dark`.
   *
   * A CLASS, matching what shadcn's CLI generates and what `@custom-variant dark
   * (&:is(.dark *))` expects. A project using `@media (prefers-color-scheme: dark)`
   * instead reads as having no dark theme — see `./css-decls`, which scans top-level
   * blocks only. That is a documented limit, not a silent failure: the dark map comes
   * back empty rather than wrong.
   */
  darkSelector?: string;
}

/**
 * The `@theme inline` helpers come from the JSX/TS injector, which sounds wrong and
 * is not: `readThemeMappings`, `insertThemeMapping` and `removeThemeMapping` operate
 * on CSS text, not on a TypeScript AST, and were written for this exact block. Probed
 * against a shadcn stylesheet they locate, insert, remove and round-trip byte-exactly.
 * Reimplementing them here would be a second copy of a working thing.
 */
interface ThemeHelpers {
  readThemeMappings(css: string): { located: boolean; mappings?: string[]; reason?: string };
  insertThemeMapping(css: string, i: { cssVar: string; mapTo: string }): CssEditResult;
  removeThemeMapping(css: string, i: { cssVar: string }): CssEditResult;
}

let helpersPromise: Promise<ThemeHelpers> | null = null;
const themeHelpers = (): Promise<ThemeHelpers> =>
  (helpersPromise ??= import('../server/inject.mjs') as unknown as Promise<ThemeHelpers>);

/**
 * The four families, all pointing at the one stylesheet.
 *
 * The prefixes reproduce shadcn's own conventions, which are also Tailwind v4's
 * `@theme` namespaces: a color is `--x` aliased as `--color-x`, a radius `--radius-x`
 * aliased as itself, a font `--font-x` likewise. `palette` has no shadcn analogue — it
 * is wafflebase's raw-swatch layer — so it maps onto the same flat namespace as
 * `semantic` rather than inventing a `--wb-` prefix a consumer never asked for.
 */
const FAMILIES: Record<TokenFamily, Omit<TokenFamilyMeta, 'file'>> = {
  semantic: {
    family: 'semantic',
    label: 'Color',
    cssVarPrefix: '--',
    themeVarPrefix: '--color-',
    utilityPrefix: 'bg-',
    placeholder: 'oklch(0.7 0.1 250)',
    defaultValue: 'oklch(0.7 0.1 250)',
  },
  palette: {
    family: 'palette',
    label: 'Palette',
    cssVarPrefix: '--',
    themeVarPrefix: '--color-',
    utilityPrefix: 'bg-',
    placeholder: '#B8651A',
    defaultValue: '#B8651A',
  },
  radius: {
    family: 'radius',
    label: 'Radius',
    cssVarPrefix: '--radius-',
    themeVarPrefix: '--radius-',
    utilityPrefix: 'rounded-',
    placeholder: '0.5rem',
    defaultValue: '0.5rem',
  },
  typo: {
    family: 'typo',
    label: 'Font',
    cssVarPrefix: '--font-',
    themeVarPrefix: '--font-',
    utilityPrefix: 'font-',
    placeholder: 'ui-sans-serif, system-ui, sans-serif',
    defaultValue: 'ui-sans-serif, system-ui, sans-serif',
  },
};

/**
 * Which theme block a family's values live in.
 *
 * Colors are per-theme; a radius and a font are not — nobody ships a different border
 * radius in dark mode, and both pipelines store them in the base block only. Routing a
 * radius edit to `.dark` would create a dark-only override of a token that has no
 * light counterpart there, which resolves to nothing in light mode.
 */
const isThemed = (family: TokenFamily): boolean => family === 'semantic' || family === 'palette';

export function cssVariables(options: CssVariablesOptions): TokenAdapter {
  // Normalised once, here. `sources()` is compared by string against the root-relative
  // paths the plugin derives from what it wrote, so the documented `'./src/index.css'`
  // form matched nothing: the regen gate never fired and `/preview-tokens` never patched
  // the stylesheet it had just edited.
  const stylesheet = normaliseSource(options.stylesheet);
  const rootSelector = options.rootSelector ?? ':root';
  const darkSelector = options.darkSelector ?? '.dark';

  /** The custom property an edit addresses, from its family and kebab key. */
  const propOf = (family: TokenFamily, kebabKey: string) =>
    `${FAMILIES[family].cssVarPrefix}${kebabKey}`;

  const selectorFor = (family: TokenFamily, theme: 'light' | 'dark') =>
    isThemed(family) && theme === 'dark' ? darkSelector : rootSelector;

  return {
    sources: () => [stylesheet],

    async read(readFile) {
      const css = await readFile(stylesheet);
      const helpers = await themeHelpers();
      const theme = helpers.readThemeMappings(css);
      const families: TokenFamilyMeta[] = (
        Object.keys(FAMILIES) as TokenFamily[]
      ).map((f) => ({ ...FAMILIES[f], file: stylesheet }));

      return {
        vars: {
          light: declMap(readDecls(css, rootSelector)),
          dark: declMap(readDecls(css, darkSelector)),
        },
        // Empty rather than absent when the project has no `@theme` block. Probed:
        // `readThemeMappings` reports `located: false` there, and a shadcn project
        // without one is perfectly valid — it simply has no utility aliases, so every
        // token is editable but none is reachable as a class.
        utilities: theme.mappings ?? [],
        families,
      } satisfies TokenTree;
    },

    plan(edit: TokenEdit): TokenWrite[] | { error: string } {
      const family = edit.family;
      if (!FAMILIES[family]) return { error: `unknown token family: ${family}` };

      // Refused before anything is planned, for both the value and member paths: the
      // value is spliced into the stylesheet verbatim, so a bare `;` or `}` does not
      // produce a wrong colour but a structurally different file.
      if (edit.kind !== 'remove-member') {
        const safe = isSafeDeclarationValue(edit.value);
        if (safe !== true) return { error: `invalid CSS value: ${safe}` };
      }

      if (edit.kind === 'set-value') {
        // `expression` is a palette REBIND — "point this token at that swatch" — which
        // only means anything where tokens are TypeScript and one can reference another.
        // In a stylesheet the equivalent is `var(--other)`, and the client has no way to
        // express which, so refusing is the honest answer rather than writing the
        // expression text into CSS where it would be an invalid value.
        if (edit.valueKind === 'expression') {
          return {
            error:
              'this project stores tokens as CSS custom properties, which cannot ' +
              'reference another token by expression — edit the value directly',
          };
        }
        const prop = propOf(family, edit.kebabKey);
        const selector = selectorFor(family, edit.theme);
        return [
          {
            file: stylesheet,
            required: true,
            label: `${prop} in ${selector}`,
            apply: (text) => setDecl(text, selector, prop, edit.value),
          },
        ];
      }

      const prop = propOf(family, edit.kebabKey);
      const themeVar = `${FAMILIES[family].themeVarPrefix}${edit.kebabKey}`;

      if (edit.kind === 'add-member') {
        const writes: TokenWrite[] = [
          {
            file: stylesheet,
            required: true,
            label: `${prop} in ${rootSelector}`,
            apply: (text) => insertDecl(text, rootSelector, prop, edit.value),
          },
        ];
        // The SAME value in both themes, matching `insertSemanticToken`'s own comment —
        // "so the token is valid across themes from the moment it exists". Optional,
        // because a light-only project has no dark block and refusing there would make
        // the token uncreatable in a perfectly valid stylesheet.
        if (isThemed(family)) {
          writes.push({
            file: stylesheet,
            required: false,
            label: `${prop} in ${darkSelector}`,
            apply: (text) => insertDecl(text, darkSelector, prop, edit.value),
          });
        }
        writes.push({
          file: stylesheet,
          required: false,
          label: `${themeVar} alias`,
          apply: (text) => applyTheme(text, 'insert', { cssVar: themeVar, mapTo: prop }),
        });
        return writes;
      }

      // remove-member. The base-block removal is REQUIRED: a property absent from
      // `:root` is not a token in this pipeline, and treating that as a no-op would
      // report a successful removal of something that was never there. The dark
      // override and the alias are optional, matching `removeSemanticToken`, which
      // "tolerates a PARTIAL presence … because refusing would leave the half-created
      // state permanently unfixable through this API".
      const writes: TokenWrite[] = [
        {
          file: stylesheet,
          required: true,
          label: `${prop} in ${rootSelector}`,
          apply: (text) => removeDecl(text, rootSelector, prop),
        },
      ];
      if (isThemed(family)) {
        writes.push({
          file: stylesheet,
          required: false,
          label: `${prop} in ${darkSelector}`,
          apply: (text) => removeDecl(text, darkSelector, prop),
        });
      }
      writes.push({
        file: stylesheet,
        required: false,
        label: `${themeVar} alias`,
        apply: (text) => applyTheme(text, 'remove', { cssVar: themeVar, mapTo: prop }),
      });
      return writes;
    },

    /**
     * No child process, no build step — parse the (possibly patched) stylesheet and
     * report its blocks.
     *
     * This is the simplification §4 predicts. Wafflebase must keep a warm `tsx` worker
     * alive to render its variable map, because its tokens are TypeScript that has to
     * be evaluated. Here the stylesheet already IS the variable map, so a preview is a
     * parse and the whole worker apparatus has no counterpart.
     */
    async emit(files: Record<string, string>): Promise<TokenEmitResult> {
      const css = files[stylesheet];
      if (css == null) return { ok: false, error: `no text supplied for ${stylesheet}` };
      return {
        ok: true,
        light: declMap(readDecls(css, rootSelector)),
        dark: declMap(readDecls(css, darkSelector)),
      };
    },

    // `regenerate` is deliberately ABSENT, not a no-op returning ok. The plugin tests
    // for the method's presence, so omitting it means "this pipeline has no emitter to
    // re-run" — the write reached the stylesheet the host already serves, and Vite's
    // own CSS HMR publishes it. A no-op implementation would claim a regeneration
    // happened and make the client show a step that never ran.
  };
}

/**
 * `@theme inline` mutation, awaiting the dynamically imported helpers.
 *
 * `TokenWrite.apply` may be async precisely so this needs no module-level cache of the
 * resolved module. The import itself is memoised by `themeHelpers`, so this costs one
 * already-settled promise per write rather than a load.
 *
 * A failed import is reported as a refused write, not thrown. The alias write is optional
 * in every plan above, so degrading to a note keeps the token itself landing — where a
 * throw would escape `applyTokenPlan` and surface as a broken bridge.
 *
 * NOT COVERED BY THE SUITE: reaching the catch means making a static `import()` of a
 * sibling module fail, which needs module mocking for a path that only fires if the
 * package itself is broken on disk. Stated rather than implied.
 */
async function applyTheme(
  text: string,
  op: 'insert' | 'remove',
  intent: { cssVar: string; mapTo: string },
): Promise<CssEditResult> {
  let helpers: ThemeHelpers;
  try {
    helpers = await themeHelpers();
  } catch (err) {
    return { located: false, text, reason: `theme-alias helpers unavailable: ${String(err)}` };
  }
  return op === 'insert'
    ? helpers.insertThemeMapping(text, intent)
    : helpers.removeThemeMapping(text, { cssVar: intent.cssVar });
}
