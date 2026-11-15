import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { palette, semantic } from '../../src/tokens';
import { contrastRatio } from '../../src/tokens/contrast';

/**
 * The VitePress docs site (`packages/documentation`) is a brand surface, but
 * its theme copies the brand colors as hex rather than importing
 * `tokens.css` (DESIGN.md, Colors → Neutral). A copy drifts silently — the
 * brand refresh left the site on the retired cream for exactly that reason —
 * so this test pins the copy to the palette, and holds every contrast ratio
 * the theme's comments claim.
 */
const AA_NORMAL = 4.5;

const themeCss = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../documentation/.vitepress/theme/style.css',
  ),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const start = themeCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`docs theme: no "${selector}" block`);
  const body = themeCss.slice(start, themeCss.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
}

const light = block(':root');
const themes = {
  light,
  // `.dark` only overrides; anything it leaves alone falls through to :root.
  dark: { ...light, ...block('.dark') },
};

type Vars = Record<string, string>;

function resolveVar(vars: Vars, name: string): string {
  let value = vars[name];
  for (let hops = 0; value?.startsWith('var('); hops++) {
    if (hops > 8) throw new Error(`docs theme: --${name} does not resolve`);
    value = vars[value.slice(6, -1).trim()];
  }
  if (!value) throw new Error(`docs theme: --${name} is not set`);
  return value;
}

/** An opaque `#rrggbb` for `--name`, compositing an rgba() over `under`. */
function color(vars: Vars, name: string, under?: string): string {
  const value = resolveVar(vars, name);
  const rgba = value.match(/^rgba\(([^)]+)\)$/);
  if (!rgba) return value.toUpperCase();
  if (!under) throw new Error(`docs theme: --${name} is translucent`);
  const [r, g, b, a] = rgba[1].split(',').map((p) => parseFloat(p));
  const base = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
  return (
    '#' +
    [r, g, b]
      .map((c, i) => Math.round(a * c + (1 - a) * base[i]))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

describe('docs site theme', () => {
  it.each(['light', 'dark'] as const)(
    'takes its surfaces and text from brandNeutrals in %s mode',
    (mode) => {
      const vars = themes[mode];
      const n = palette.brandNeutrals[mode];
      expect(color(vars, 'vp-c-bg')).toBe(n.bg);
      expect(color(vars, 'vp-c-bg-alt')).toBe(n.paper);
      expect(color(vars, 'vp-c-bg-elv')).toBe(n.paper);
      expect(color(vars, 'vp-c-bg-soft')).toBe(n.wash);
      expect(color(vars, 'vp-c-text-1')).toBe(n.ink);
      expect(color(vars, 'vp-c-text-2')).toBe(n.sub);
      expect(color(vars, 'vp-c-divider')).toBe(n.rule);
    },
  );

  it.each(['light', 'dark'] as const)(
    'uses the app primary pair as its brand in %s mode',
    (mode) => {
      const vars = themes[mode];
      expect(color(vars, 'vp-c-brand-1')).toBe(semantic[mode].primary.toUpperCase());
      expect(color(vars, 'vp-c-brand-2')).toBe(semantic[mode].primaryHover.toUpperCase());
    },
  );

  it.each(['light', 'dark'] as const)(
    'text tiers and links pass AA on page and paper in %s mode',
    (mode) => {
      const vars = themes[mode];
      for (const surface of ['vp-c-bg', 'vp-c-bg-alt']) {
        for (const text of ['vp-c-text-1', 'vp-c-text-2', 'vp-c-text-3', 'vp-c-brand-1']) {
          expect(
            contrastRatio(color(vars, text), color(vars, surface)),
            `${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'brand button label passes AA at rest and on hover in %s mode',
    (mode) => {
      const vars = themes[mode];
      const label = color(vars, 'vp-button-brand-text');
      expect(contrastRatio(label, color(vars, 'vp-button-brand-bg'))).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(
        contrastRatio(label, color(vars, 'vp-button-brand-hover-bg')),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  /**
   * A callout's links and inline code take `<kind>-1` on the callout's tint;
   * a code chip lays the same tint down a second time.
   */
  it.each(['light', 'dark'] as const)(
    'important and warning callout text passes AA on its code chip in %s mode',
    (mode) => {
      const vars = themes[mode];
      const page = color(vars, 'vp-c-bg');
      for (const kind of ['important', 'warning']) {
        const callout = color(vars, `vp-c-${kind}-soft`, page);
        const chip = color(vars, `vp-c-${kind}-soft`, callout);
        expect(
          contrastRatio(color(vars, `vp-c-${kind}-1`), chip),
          `${kind} on its chip`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );

  it.each(['light', 'dark'] as const)('inline code passes AA in %s mode', (mode) => {
    const vars = themes[mode];
    const chip = color(vars, 'vp-code-bg', color(vars, 'vp-c-bg'));
    expect(contrastRatio(color(vars, 'vp-code-color'), chip)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
