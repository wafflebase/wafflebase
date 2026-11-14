import { describe, expect, it } from 'vitest';
import { semantic, palette } from '../../src/tokens';
import { contrastRatio } from '../../src/tokens/contrast';

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

describe('WCAG AA contrast', () => {
  it('foreground vs background passes AA in light mode', () => {
    const ratio = contrastRatio(semantic.light.foreground, semantic.light.background);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('foreground vs background passes AA in dark mode', () => {
    const ratio = contrastRatio(semantic.dark.foreground, semantic.dark.background);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  /**
   * Every surface primary sits on as text: the app chrome (`background`,
   * `card`, `popover`) and the cream brand page, where the homepage and
   * template gallery set `text-primary` links and the pill CTA.
   */
  const primaryTextSurfaces = {
    light: [
      semantic.light.background,
      semantic.light.card,
      semantic.light.popover,
      palette.neutrals.light.bg,
      palette.neutrals.light.paper,
      palette.brandNeutrals.light.bg,
      palette.brandNeutrals.light.paper,
    ],
    dark: [
      semantic.dark.background,
      semantic.dark.card,
      semantic.dark.popover,
      palette.neutrals.dark.bg,
      palette.neutrals.dark.paper,
      palette.brandNeutrals.dark.bg,
      palette.brandNeutrals.dark.paper,
    ],
  };

  it.each(['light', 'dark'] as const)(
    'primary label on its fill, at rest and on hover, passes AA in %s mode',
    (theme) => {
      const m = semantic[theme];
      expect(contrastRatio(m.primaryForeground, m.primary)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(m.primaryForeground, m.primaryHover)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(
        contrastRatio(m.sidebarPrimaryForeground, m.sidebarPrimary),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  it.each(['light', 'dark'] as const)(
    'primary hover presses darker than primary in %s mode',
    (theme) => {
      const m = semantic[theme];
      // Darker = lower luminance = more contrast against white.
      expect(contrastRatio(m.primaryHover, '#FFFFFF')).toBeGreaterThan(
        contrastRatio(m.primary, '#FFFFFF'),
      );
    },
  );

  it.each(['light', 'dark'] as const)(
    'primary and link as text pass AA on every %s surface',
    (theme) => {
      for (const surface of primaryTextSurfaces[theme]) {
        expect(
          contrastRatio(semantic[theme].primary, surface),
          `primary on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(
          contrastRatio(semantic[theme].link, surface),
          `link on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'input border clears the 3:1 non-text floor in %s mode',
    (theme) => {
      const m = semantic[theme];
      for (const surface of [m.background, m.popover]) {
        expect(contrastRatio(m.inputBorder, surface)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    },
  );

  it('sidebar foreground vs sidebar background passes AA in both modes', () => {
    expect(
      contrastRatio(semantic.light.sidebarForeground, semantic.light.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(semantic.dark.sidebarForeground, semantic.dark.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('butter chip text remains legible on butter background', () => {
    // butter is used as a header/chip background; dark ink sits on top of it.
    // light.ink is the warm dark brown used in light mode (#2A1E12).
    const ratio = contrastRatio(palette.neutrals.light.ink, palette.butter);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(['light', 'dark'] as const)(
    'brand ink, sub and deep-syrup text pass AA on page, paper and wash in %s mode',
    (theme) => {
      const n = palette.brandNeutrals[theme];
      const deep = theme === 'light' ? palette.syrupDeep : palette.syrupBright;
      for (const surface of [n.bg, n.paper, n.wash]) {
        expect(contrastRatio(n.ink, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrastRatio(n.sub, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrastRatio(deep, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );

  it.each(['fg', 'keyword', 'flag'] as const)(
    'terminal %s passes AA on the locked terminal background',
    (key) => {
      expect(
        contrastRatio(palette.terminal[key], palette.terminal.bg),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );

  it('rejects malformed hex inputs instead of returning NaN', () => {
    expect(() => contrastRatio('#fff', palette.butter)).toThrow(
      /unsupported hex format/,
    );
    expect(() => contrastRatio(palette.butter, 'not-a-color')).toThrow();
  });
});
