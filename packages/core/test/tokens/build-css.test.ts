import { describe, expect, it } from 'vitest';
import { palette } from '../../src/tokens/palette';
import { radius } from '../../src/tokens/radius';
import { semantic } from '../../src/tokens/semantic';
import { typography } from '../../src/tokens/typography';
import {
  renderTokensCss,
  renderTokensCssFrom,
  tokenBlocks,
  type TokenSources,
} from '../../scripts/build-css';

/** The module's own imports — what the CLI path renders from. */
const OWN: TokenSources = { palette, semantic, radius, typography };

describe('renderTokensCss', () => {
  const css = renderTokensCss();

  it('contains a :root and a .dark block', () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it('emits the Butter & Maple palette variables under :root', () => {
    expect(css).toMatch(/--wb-bg:\s*#FBF6EC;/);
    expect(css).toMatch(/--wb-syrup:\s*#B8651A;/);
    expect(css).toMatch(/--wb-butter:\s*#F4C95D;/);
  });

  it('emits the semantic variables expected by the @theme block', () => {
    expect(css).toMatch(/--background:\s*oklch\(1 0 0\);/);
    expect(css).toMatch(/--primary:\s*#B8651A;/);
    expect(css).toMatch(/--ring:\s*#B8651A;/);
  });

  it('emits dark-mode overrides', () => {
    expect(css).toMatch(/\.dark\s*\{[^}]*--background:\s*oklch\(0\.141/s);
    expect(css).toMatch(/\.dark\s*\{[^}]*--wb-bg:\s*#1C1610;/s);
  });

  it('preserves the terminal palette as a constant across both modes', () => {
    // Same value emitted in :root only (no dark override needed).
    const matches = css.match(/--wb-terminal-bg:\s*#1C1610;/g);
    expect(matches?.length).toBe(1);
  });

  /**
   * The emitted stylesheet in full.
   *
   * `dist/tokens.css` is gitignored and generated, so nothing else in the repo
   * makes a token change VISIBLE in a diff — yet this output is the source of
   * every colour, radius and font in the frontend, sheets, docs and slides. The
   * snapshot is the review surface: an unintended change to the emitter or to
   * any of the four token modules shows up here instead of shipping silently.
   */
  it('renders the whole stylesheet identically', () => {
    expect(css).toMatchSnapshot();
  });
});

/**
 * `renderTokensCss()` was un-parameterized until the design-editor bridge needed
 * to render the same stylesheet from PATCHED sources without writing them to
 * disk. These cover the seam that refactor introduced.
 */
describe('renderTokensCssFrom', () => {
  it('is byte-identical to renderTokensCss() when given the module\'s own sources', () => {
    // The whole point of keeping `renderTokensCss()` as a wrapper: the CLI path
    // and every existing caller must be unaffected by the parameterization.
    expect(renderTokensCssFrom(OWN)).toBe(renderTokensCss());
  });

  it('substitutes a patched palette without disturbing anything else', () => {
    const patched = renderTokensCssFrom({
      ...OWN,
      palette: { ...palette, syrup: '#0000FF' },
    });

    expect(patched).toMatch(/--wb-syrup:\s*#0000FF;/);
    expect(patched).toMatch(/--wb-butter:\s*#F4C95D;/);

    // Same shape, and every line that moved carries the new value.
    const before = renderTokensCss().split('\n');
    const after = patched.split('\n');
    expect(after.length).toBe(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((l) => l.includes('#0000FF'))).toBe(true);
  });

  /**
   * THE CONSTRAINT THAT FORCES `preview-tokens.mts` TO EXIST.
   *
   * `semantic.ts` binds `primary: palette.syrup` at MODULE EVALUATION, so any
   * `semantic` map handed to this function already carries a RESOLVED colour.
   * Object substitution therefore cannot move a semantic role — only
   * re-evaluating `semantic.ts` against a patched `palette.ts` can.
   *
   * That is why the preview worker writes patched SOURCE TEXT to a fresh
   * scratch directory and re-imports all four modules, rather than passing
   * objects: a query-string cache bust on `semantic.ts` alone would still
   * resolve the cached `palette` and return pre-edit colours silently.
   *
   * If this test ever starts failing, the token model has changed to late-bound
   * references and the worker's scratch-directory machinery may be removable.
   */
  it('does NOT re-resolve semantic roles from a patched palette object', () => {
    const patched = renderTokensCssFrom({
      ...OWN,
      palette: { ...palette, syrup: '#0000FF' },
    });
    expect(patched).toMatch(/--primary:\s*#B8651A;/);
  });

  it('moves a semantic role when the semantic map itself is patched', () => {
    const patched = renderTokensCssFrom({
      ...OWN,
      semantic: { ...semantic, light: { ...semantic.light, primary: '#0000FF' } },
    });
    expect(patched).toMatch(/--primary:\s*#0000FF;/);
  });

  it('leaves dark mode alone when a light-only token is patched', () => {
    // `syrupBright`, not `syrup`, is what dark mode reads.
    const patched = renderTokensCssFrom({
      ...OWN,
      palette: { ...palette, syrup: '#0000FF' },
    });
    const darkBlock = patched.slice(patched.indexOf('.dark'));
    expect(darkBlock).not.toMatch(/#0000FF/);
  });
});

describe('tokenBlocks', () => {
  it('emits root-only tokens in the light block and never in dark', () => {
    // `format()` writes `:root` from `light` and `.dark` from `dark`, so a
    // root-only token leaking into `dark` would emit a redundant override.
    const { light, dark } = tokenBlocks(OWN);
    const names = (b: Array<[string, string]>) => b.map(([n]) => n);

    for (const rootOnly of ['--radius', '--font-body', '--wb-terminal-bg']) {
      expect(names(light)).toContain(rootOnly);
      expect(names(dark)).not.toContain(rootOnly);
    }
  });

  it('emits each variable at most once per block', () => {
    // The blocks are concatenated (root-only + palette + semantic); a duplicate
    // name would make the emitted order decide the winner silently.
    for (const block of Object.values(tokenBlocks(OWN))) {
      const names = block.map(([n]) => n);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
