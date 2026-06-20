# Slides Theme Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-brand the two default slide themes, move the Wafflebase brand palette into one dedicated theme, and expand the built-in catalog to 23 Google-Slides-parity themes — pure data, no model/UI change.

**Architecture:** Each theme is a `Theme` literal in `packages/slides/src/themes/`. `BUILT_IN_THEMES` (in `themes/index.ts`) is an ordered array the picker renders flat. `default-light`/`default-dark` are rewritten to neutral palettes; the waffle palette moves to a new `wafflebase` module. Validity, contrast, and font-availability are guarded by tests. Visual regression snapshots a 6-theme representative subset.

**Tech Stack:** TypeScript, Vitest (slides + frontend unit tests), `@wafflebase/tokens` (brand palette), the frontend harness visual lane.

## Global Constraints

- Theme `id`s for `default-light`, `default-dark`, `streamline`, `focus`, `material` MUST NOT change (avoids Yorkie remap).
- `Theme`, `ColorScheme`, `FontScheme` types are unchanged — no model edits (`packages/slides/src/model/theme.ts`).
- All `ColorScheme` slot values are `#RRGGBB` uppercase hex, except `wafflebase` which binds to `@wafflebase/tokens`.
- All theme fonts MUST exist as a `family` in `packages/frontend/src/components/text-formatting/font-catalog.data.ts`.
- `BUILT_IN_THEMES` order: `default-light`, `default-dark` first; `wafflebase` last.
- `slides` package MUST NOT import from `frontend` — the font-availability test therefore lives in `frontend`.
- Each commit passes `pnpm verify:fast`.

---

### Task 1: De-brand defaults + add `wafflebase` brand theme

**Files:**
- Modify: `packages/slides/src/themes/default-light.ts`
- Modify: `packages/slides/src/themes/default-dark.ts`
- Create: `packages/slides/src/themes/wafflebase.ts`
- Modify: `packages/slides/src/themes/index.ts`
- Test: `packages/slides/src/themes/debrand.test.ts`

**Interfaces:**
- Consumes: `Theme` from `../model/theme`; `palette`, `typography` from `@wafflebase/tokens`; `firstFamily` from `./font-stack`.
- Produces: `defaultLight`, `defaultDark` (now neutral), `wafflebase` (brand) theme literals; `wafflebase` exported and present in `BUILT_IN_THEMES`.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/src/themes/debrand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { palette } from '@wafflebase/tokens';
import { defaultLight, defaultDark, wafflebase } from './index';

describe('de-branded defaults', () => {
  it('default-light uses a neutral blue accent, not the brand syrup', () => {
    expect(defaultLight.colors.accent1).toBe('#1A73E8');
    expect(defaultLight.colors.accent1).not.toBe(palette.syrup);
  });

  it('default-dark uses a neutral accent, not the brand syrup', () => {
    expect(defaultDark.colors.accent1).toBe('#8AB4F8');
  });

  it('wafflebase carries the brand palette', () => {
    expect(wafflebase.id).toBe('wafflebase');
    expect(wafflebase.colors.accent1).toBe(palette.syrup);
    expect(wafflebase.colors.accent2).toBe(palette.butter);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- debrand`
Expected: FAIL — `wafflebase` is not exported from `./index`; `defaultLight.colors.accent1` is still `palette.syrup`.

- [ ] **Step 3: Rewrite the two defaults to neutral palettes**

Replace the whole body of `packages/slides/src/themes/default-light.ts` with:

```ts
import type { Theme } from '../model/theme';

export const defaultLight: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: '#1A1A1A',
    background: '#FFFFFF',
    textSecondary: '#5F6368',
    backgroundAlt: '#F1F3F4',
    accent1: '#1A73E8',
    accent2: '#5F6368',
    accent3: '#34A853',
    accent4: '#FBBC04',
    accent5: '#EA4335',
    accent6: '#A142F4',
    hyperlink: '#1A73E8',
    visitedHyperlink: '#681DA8',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
```

Replace the whole body of `packages/slides/src/themes/default-dark.ts` with:

```ts
import type { Theme } from '../model/theme';

export const defaultDark: Theme = {
  id: 'default-dark',
  name: 'Simple Dark',
  colors: {
    text: '#E8EAED',
    background: '#202124',
    textSecondary: '#9AA0A6',
    backgroundAlt: '#303134',
    accent1: '#8AB4F8',
    accent2: '#9AA0A6',
    accent3: '#81C995',
    accent4: '#FDD663',
    accent5: '#F28B82',
    accent6: '#C58AF9',
    hyperlink: '#8AB4F8',
    visitedHyperlink: '#C58AF9',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
```

- [ ] **Step 4: Create the `wafflebase` brand theme (verbatim move of the old default-light body)**

Create `packages/slides/src/themes/wafflebase.ts`:

```ts
import type { Theme } from '../model/theme';
import { palette, typography } from '@wafflebase/tokens';
import { firstFamily } from './font-stack';

/**
 * The Wafflebase brand theme — the waffle palette (syrup / butter /
 * berry / leaf) and brand display/body fonts that used to be baked into
 * `default-light`. Kept as a one-click choice so the prior default look
 * is reproducible, while new decks default to the neutral Simple Light.
 */
export const wafflebase: Theme = {
  id: 'wafflebase',
  name: 'Wafflebase',
  colors: {
    text: palette.neutrals.light.ink,
    background: palette.neutrals.light.paper,
    textSecondary: palette.neutrals.light.sub,
    backgroundAlt: palette.neutrals.light.bg,
    accent1: palette.syrup,
    accent2: palette.butter,
    accent3: palette.berry,
    accent4: palette.leaf,
    accent5: palette.syrupDeep,
    accent6: palette.berryBright,
    hyperlink: palette.syrup,
    visitedHyperlink: palette.berry,
  },
  fonts: {
    heading: firstFamily(typography.display),
    body: firstFamily(typography.body),
  },
};
```

- [ ] **Step 5: Register `wafflebase` in the index**

In `packages/slides/src/themes/index.ts`, add the import and re-export, and append `wafflebase` to `BUILT_IN_THEMES` (final ordering lands in Task 2):

```ts
import { wafflebase } from './wafflebase';
// ...add `wafflebase` to the existing `export { ... }` line...
// ...append `wafflebase` as the last element of BUILT_IN_THEMES...
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- debrand`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/themes/default-light.ts packages/slides/src/themes/default-dark.ts packages/slides/src/themes/wafflebase.ts packages/slides/src/themes/index.ts packages/slides/src/themes/debrand.test.ts
git commit -m "feat(slides): de-brand default themes, add wafflebase brand theme"
```

---

### Task 2: Add 18 Google-Slides-parity themes + finalize ordering

**Files:**
- Create: `packages/slides/src/themes/swiss.ts`, `paradigm.ts`, `shift.ts`, `momentum.ts`, `luxe.ts`, `modern-writer.ts`, `coral.ts`, `spearmint.ts`, `pop.ts`, `tropic.ts`, `marina.ts`, `geometric.ts`, `plum.ts`, `slate.ts`, `forest.ts`, `spotlight.ts`, `beach-day.ts` (and `streamline`/`focus`/`material` already exist) — 17 new files (`pop` listed once).
- Modify: `packages/slides/src/themes/index.ts`
- Test: `packages/slides/src/themes/count.test.ts`

> Note: 18 themes are added to the catalog vs. today's 5; `streamline`, `focus`, `material` already exist, so this task **creates 17 new modules** and re-orders the array.

**Interfaces:**
- Consumes: `Theme` from `../model/theme`.
- Produces: 17 new theme literals; `BUILT_IN_THEMES` is the final 23-entry ordered array.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/src/themes/count.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES } from './index';

const EXPECTED_ORDER = [
  'default-light', 'default-dark', 'streamline', 'swiss', 'paradigm',
  'material', 'shift', 'momentum', 'focus', 'luxe', 'modern-writer',
  'coral', 'spearmint', 'pop', 'tropic', 'marina', 'geometric', 'plum',
  'slate', 'forest', 'spotlight', 'beach-day', 'wafflebase',
];

describe('catalog ordering', () => {
  it('has 23 themes in the Google-Slides-parity order', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual(EXPECTED_ORDER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- count`
Expected: FAIL — array currently has 6 entries (5 original + wafflebase).

- [ ] **Step 3: Create the 17 new theme modules**

Each file is `packages/slides/src/themes/<id>.ts` with this shape (only `id`, `name`, the 12 color slots, and the two fonts differ):

`swiss.ts`:
```ts
import type { Theme } from '../model/theme';
export const swiss: Theme = {
  id: 'swiss', name: 'Swiss',
  colors: { text: '#111111', background: '#FFFFFF', textSecondary: '#555555', backgroundAlt: '#F2F2F2', accent1: '#E2231A', accent2: '#111111', accent3: '#7A7A7A', accent4: '#C4C4C4', accent5: '#E2231A', accent6: '#000000', hyperlink: '#E2231A', visitedHyperlink: '#9A1812' },
  fonts: { heading: 'Archivo', body: 'Inter' },
};
```

`paradigm.ts`:
```ts
import type { Theme } from '../model/theme';
export const paradigm: Theme = {
  id: 'paradigm', name: 'Paradigm',
  colors: { text: '#1B2A33', background: '#FFFFFF', textSecondary: '#4A5D68', backgroundAlt: '#EDF2F4', accent1: '#0F8B8D', accent2: '#143642', accent3: '#14746F', accent4: '#A2D6D4', accent5: '#EC9A29', accent6: '#0B5563', hyperlink: '#0F8B8D', visitedHyperlink: '#143642' },
  fonts: { heading: 'Montserrat', body: 'Lato' },
};
```

`shift.ts`:
```ts
import type { Theme } from '../model/theme';
export const shift: Theme = {
  id: 'shift', name: 'Shift',
  colors: { text: '#1E1B2E', background: '#FBFAFF', textSecondary: '#5B5670', backgroundAlt: '#EEEBFA', accent1: '#5E35B1', accent2: '#3949AB', accent3: '#7E57C2', accent4: '#B39DDB', accent5: '#9575CD', accent6: '#311B92', hyperlink: '#5E35B1', visitedHyperlink: '#311B92' },
  fonts: { heading: 'DM Sans', body: 'DM Sans' },
};
```

`momentum.ts`:
```ts
import type { Theme } from '../model/theme';
export const momentum: Theme = {
  id: 'momentum', name: 'Momentum',
  colors: { text: '#1F2421', background: '#FFFFFF', textSecondary: '#5A6B5D', backgroundAlt: '#EEF2EE', accent1: '#2E7D32', accent2: '#43A047', accent3: '#66BB6A', accent4: '#A5D6A7', accent5: '#1B5E20', accent6: '#81C784', hyperlink: '#2E7D32', visitedHyperlink: '#1B5E20' },
  fonts: { heading: 'Poppins', body: 'PT Sans' },
};
```

`luxe.ts`:
```ts
import type { Theme } from '../model/theme';
export const luxe: Theme = {
  id: 'luxe', name: 'Luxe',
  colors: { text: '#1C1C1C', background: '#FAFAF8', textSecondary: '#6B6B68', backgroundAlt: '#ECEAE3', accent1: '#B08D57', accent2: '#1C1C1C', accent3: '#8C6D3F', accent4: '#D4AF7A', accent5: '#5C5C5C', accent6: '#A38B6D', hyperlink: '#B08D57', visitedHyperlink: '#8C6D3F' },
  fonts: { heading: 'Playfair Display', body: 'Lato' },
};
```

`modern-writer.ts`:
```ts
import type { Theme } from '../model/theme';
export const modernWriter: Theme = {
  id: 'modern-writer', name: 'Modern Writer',
  colors: { text: '#2B2B2B', background: '#FCFBF7', textSecondary: '#6E6A60', backgroundAlt: '#EFEDE4', accent1: '#3D5A80', accent2: '#98623C', accent3: '#5C7A5C', accent4: '#BFA15B', accent5: '#2B2B2B', accent6: '#7D6B53', hyperlink: '#3D5A80', visitedHyperlink: '#98623C' },
  fonts: { heading: 'EB Garamond', body: 'PT Serif' },
};
```

`coral.ts`:
```ts
import type { Theme } from '../model/theme';
export const coral: Theme = {
  id: 'coral', name: 'Coral',
  colors: { text: '#3A2C2C', background: '#FFF7F3', textSecondary: '#8A6F6A', backgroundAlt: '#FBE6DD', accent1: '#FF6B6B', accent2: '#FF8E72', accent3: '#FFA987', accent4: '#F4A259', accent5: '#C44536', accent6: '#FFB4A2', hyperlink: '#FF6B6B', visitedHyperlink: '#C44536' },
  fonts: { heading: 'Poppins', body: 'Nunito' },
};
```

`spearmint.ts`:
```ts
import type { Theme } from '../model/theme';
export const spearmint: Theme = {
  id: 'spearmint', name: 'Spearmint',
  colors: { text: '#14302A', background: '#F4FBF8', textSecondary: '#4E7268', backgroundAlt: '#DCF0E8', accent1: '#11998E', accent2: '#1DBF73', accent3: '#2DD4BF', accent4: '#88E0C0', accent5: '#0B7A6E', accent6: '#38EF7D', hyperlink: '#11998E', visitedHyperlink: '#0B7A6E' },
  fonts: { heading: 'Rubik', body: 'Rubik' },
};
```

`pop.ts`:
```ts
import type { Theme } from '../model/theme';
export const pop: Theme = {
  id: 'pop', name: 'Pop',
  colors: { text: '#16161A', background: '#FFFFFF', textSecondary: '#55555F', backgroundAlt: '#F0F0F3', accent1: '#FF2E63', accent2: '#08D9D6', accent3: '#FFD460', accent4: '#6A2C70', accent5: '#00ADB5', accent6: '#FF5722', hyperlink: '#FF2E63', visitedHyperlink: '#6A2C70' },
  fonts: { heading: 'Montserrat', body: 'Open Sans' },
};
```

`tropic.ts`:
```ts
import type { Theme } from '../model/theme';
export const tropic: Theme = {
  id: 'tropic', name: 'Tropic',
  colors: { text: '#102A2E', background: '#FFFFFF', textSecondary: '#4C6B6E', backgroundAlt: '#E6F2F1', accent1: '#00897B', accent2: '#FB8C00', accent3: '#26A69A', accent4: '#FFB74D', accent5: '#00695C', accent6: '#FF7043', hyperlink: '#00897B', visitedHyperlink: '#00695C' },
  fonts: { heading: 'Poppins', body: 'Mulish' },
};
```

`marina.ts`:
```ts
import type { Theme } from '../model/theme';
export const marina: Theme = {
  id: 'marina', name: 'Marina',
  colors: { text: '#0D1B2A', background: '#F7FAFC', textSecondary: '#495867', backgroundAlt: '#DCE7F0', accent1: '#1B6CA8', accent2: '#0E4D70', accent3: '#3B8EC4', accent4: '#7FB2D6', accent5: '#143A52', accent6: '#5BA3CF', hyperlink: '#1B6CA8', visitedHyperlink: '#0E4D70' },
  fonts: { heading: 'Raleway', body: 'Lato' },
};
```

`geometric.ts`:
```ts
import type { Theme } from '../model/theme';
export const geometric: Theme = {
  id: 'geometric', name: 'Geometric',
  colors: { text: '#1A1A1A', background: '#FFFFFF', textSecondary: '#595959', backgroundAlt: '#F0F0F0', accent1: '#E63946', accent2: '#1D3557', accent3: '#F1A208', accent4: '#2A9D8F', accent5: '#457B9D', accent6: '#6D597A', hyperlink: '#1D3557', visitedHyperlink: '#6D597A' },
  fonts: { heading: 'Oswald', body: 'Work Sans' },
};
```

`plum.ts`:
```ts
import type { Theme } from '../model/theme';
export const plum: Theme = {
  id: 'plum', name: 'Plum',
  colors: { text: '#2A1A2E', background: '#FBF7FC', textSecondary: '#6E5A72', backgroundAlt: '#F0E4F2', accent1: '#8E24AA', accent2: '#C2185B', accent3: '#AB47BC', accent4: '#E1BEE7', accent5: '#6A1B9A', accent6: '#D81B60', hyperlink: '#8E24AA', visitedHyperlink: '#6A1B9A' },
  fonts: { heading: 'Manrope', body: 'Manrope' },
};
```

`slate.ts`:
```ts
import type { Theme } from '../model/theme';
export const slate: Theme = {
  id: 'slate', name: 'Slate',
  colors: { text: '#E2E8F0', background: '#1E293B', textSecondary: '#94A3B8', backgroundAlt: '#334155', accent1: '#38BDF8', accent2: '#22D3EE', accent3: '#818CF8', accent4: '#A78BFA', accent5: '#2DD4BF', accent6: '#60A5FA', hyperlink: '#38BDF8', visitedHyperlink: '#A78BFA' },
  fonts: { heading: 'Inter', body: 'Inter' },
};
```

`forest.ts`:
```ts
import type { Theme } from '../model/theme';
export const forest: Theme = {
  id: 'forest', name: 'Forest',
  colors: { text: '#E8EDE6', background: '#1B2A20', textSecondary: '#9BB0A0', backgroundAlt: '#2C4133', accent1: '#74C69D', accent2: '#B7E4C7', accent3: '#D9A05B', accent4: '#95D5B2', accent5: '#52B788', accent6: '#E9C46A', hyperlink: '#74C69D', visitedHyperlink: '#52B788' },
  fonts: { heading: 'Bitter', body: 'Source Sans 3' },
};
```

`spotlight.ts`:
```ts
import type { Theme } from '../model/theme';
export const spotlight: Theme = {
  id: 'spotlight', name: 'Spotlight',
  colors: { text: '#F5F5F5', background: '#0D0D0D', textSecondary: '#A0A0A0', backgroundAlt: '#1A1A1A', accent1: '#FFD60A', accent2: '#F5F5F5', accent3: '#FFC300', accent4: '#6E6E6E', accent5: '#FFD60A', accent6: '#FFFFFF', hyperlink: '#FFD60A', visitedHyperlink: '#FFC300' },
  fonts: { heading: 'Oswald', body: 'Inter' },
};
```

`beach-day.ts`:
```ts
import type { Theme } from '../model/theme';
export const beachDay: Theme = {
  id: 'beach-day', name: 'Beach Day',
  colors: { text: '#2B3A42', background: '#FBFCFD', textSecondary: '#5E7682', backgroundAlt: '#E4F1F6', accent1: '#00A8CC', accent2: '#F4D35E', accent3: '#EE964B', accent4: '#00B4D8', accent5: '#0077B6', accent6: '#F7A072', hyperlink: '#00A8CC', visitedHyperlink: '#0077B6' },
  fonts: { heading: 'Quicksand', body: 'Nunito' },
};
```

- [ ] **Step 4: Rewrite `index.ts` with the full ordered catalog**

Replace `packages/slides/src/themes/index.ts` with:

```ts
import type { Theme } from '../model/theme';
import { defaultLight } from './default-light';
import { defaultDark } from './default-dark';
import { streamline } from './streamline';
import { swiss } from './swiss';
import { paradigm } from './paradigm';
import { material } from './material';
import { shift } from './shift';
import { momentum } from './momentum';
import { focus } from './focus';
import { luxe } from './luxe';
import { modernWriter } from './modern-writer';
import { coral } from './coral';
import { spearmint } from './spearmint';
import { pop } from './pop';
import { tropic } from './tropic';
import { marina } from './marina';
import { geometric } from './geometric';
import { plum } from './plum';
import { slate } from './slate';
import { forest } from './forest';
import { spotlight } from './spotlight';
import { beachDay } from './beach-day';
import { wafflebase } from './wafflebase';

export {
  defaultLight, defaultDark, streamline, swiss, paradigm, material, shift,
  momentum, focus, luxe, modernWriter, coral, spearmint, pop, tropic,
  marina, geometric, plum, slate, forest, spotlight, beachDay, wafflebase,
};

/**
 * Built-in theme registry. Order is the order they appear in the theme
 * picker side panel: neutral defaults first, then light professional,
 * warm/editorial, vibrant, dark, with the Wafflebase brand theme last.
 * `default-light` is the baseline and the fallback for unknown ids.
 */
export const BUILT_IN_THEMES: Theme[] = [
  defaultLight, defaultDark, streamline, swiss, paradigm, material, shift,
  momentum, focus, luxe, modernWriter, coral, spearmint, pop, tropic,
  marina, geometric, plum, slate, forest, spotlight, beachDay, wafflebase,
];

/**
 * Look up a built-in theme by id. Falls back to `defaultLight` for
 * unknown ids — keeps render paths from throwing when a deck references
 * a theme that hasn't been ported yet.
 */
export function getBuiltInTheme(id: string): Theme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? defaultLight;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test -- count debrand`
Expected: PASS — ordering matches the 23-entry list; de-brand tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/themes/
git commit -m "feat(slides): add 18 Google-Slides-parity built-in themes"
```

---

### Task 3: Catalog validity + WCAG-AA contrast test

**Files:**
- Test: `packages/slides/src/themes/catalog.test.ts`

**Interfaces:**
- Consumes: `BUILT_IN_THEMES`, `getBuiltInTheme` from `./index`; `ColorScheme` from `../model/theme`.
- Produces: nothing (test-only).

- [ ] **Step 1: Write the failing test**

Create `packages/slides/src/themes/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES, getBuiltInTheme } from './index';
import type { ColorScheme } from '../model/theme';

const HEX = /^#[0-9A-F]{6}$/;
const SLOTS: (keyof ColorScheme)[] = [
  'text', 'background', 'textSecondary', 'backgroundAlt',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hyperlink', 'visitedHyperlink',
];

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('theme catalog validity', () => {
  it('has unique ids; defaults first; wafflebase last', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('default-light');
    expect(ids[1]).toBe('default-dark');
    expect(ids[ids.length - 1]).toBe('wafflebase');
  });

  it('every theme has 12 valid uppercase hex slots and two non-empty fonts', () => {
    for (const t of BUILT_IN_THEMES) {
      for (const slot of SLOTS) {
        expect(t.colors[slot], `${t.id}.${slot}`).toMatch(HEX);
      }
      expect(t.fonts.heading, `${t.id} heading`).toBeTruthy();
      expect(t.fonts.body, `${t.id} body`).toBeTruthy();
    }
  });

  it('text passes WCAG-AA (>=4.5) over background and backgroundAlt', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(contrast(t.colors.text, t.colors.background), `${t.id} text/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.colors.text, t.colors.backgroundAlt), `${t.id} text/bgAlt`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to default-light for unknown ids', () => {
    expect(getBuiltInTheme('does-not-exist').id).toBe('default-light');
  });
});
```

Note: `wafflebase` resolves its token bindings to literal hex at module load, so it satisfies the `HEX` regex like every other theme.

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm --filter @wafflebase/slides test -- catalog`
Expected: PASS if all palettes are valid. If the contrast assertion FAILS for any theme, darken that theme's `text` (or lighten its `background`/`backgroundAlt`) in the theme module until `contrast >= 4.5`, then re-run. Record any adjustment in the lessons file.

- [ ] **Step 3: Commit**

```bash
git add packages/slides/src/themes/catalog.test.ts
git commit -m "test(slides): theme catalog validity + WCAG-AA contrast guard"
```

---

### Task 4: Font-availability test (frontend)

**Files:**
- Test: `packages/frontend/src/app/slides/theme-fonts.test.ts`

**Interfaces:**
- Consumes: `BUILT_IN_THEMES` from `@wafflebase/slides`; `FONT_CATALOG_DATA` from `../../components/text-formatting/font-catalog.data`.
- Produces: nothing (test-only).

This test lives in `frontend` (not `slides`) because the font catalog is a frontend module and `slides` must not depend on `frontend`.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/app/slides/theme-fonts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES } from '@wafflebase/slides';
import { FONT_CATALOG_DATA } from '../../components/text-formatting/font-catalog.data';

describe('theme fonts are in the catalog', () => {
  const families = new Set(FONT_CATALOG_DATA.map((f) => f.family));

  it('every theme heading and body font exists in the font catalog', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(families.has(t.fonts.heading), `${t.id} heading "${t.fonts.heading}"`).toBe(true);
      expect(families.has(t.fonts.body), `${t.id} body "${t.fonts.body}"`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- theme-fonts`
Expected: PASS. If a family is missing, the message names the theme and font — either fix the theme to use a catalogued family or confirm the family string exactly matches the catalog `family` (case-sensitive).

Note: this test imports the built `@wafflebase/slides` dist. If it cannot resolve the new themes, rebuild the producer package first: `pnpm --filter @wafflebase/slides build`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/theme-fonts.test.ts
git commit -m "test(frontend): assert all slide theme fonts exist in the catalog"
```

---

### Task 5: Retarget visual snapshots to a 6-theme subset

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx:899-930`
- Delete baselines: `packages/frontend/tests/visual/baselines/harness-visual.browser.slides-canvas-streamline.png`, `...slides-canvas-material.png`
- Add baselines: `...slides-canvas-pop.png`, `...slides-canvas-slate.png`, `...slides-canvas-wafflebase.png`

**Interfaces:**
- Consumes: `makeThemedDoc(themeId)` (existing helper at `slides-scenarios.tsx:46`).
- Produces: scenarios `slides-canvas-pop`, `slides-canvas-slate`, `slides-canvas-wafflebase`.

The representative subset (per the design) is: `default-light`, `default-dark`, `focus`, `pop`, `slate`, `wafflebase`. `default-light`, `default-dark`, `focus` scenarios already exist and stay; `streamline` and `material` scenarios are replaced; `wafflebase` is added.

- [ ] **Step 1: Edit the scenario registrations**

In `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`, replace the `slides-canvas-streamline` and `slides-canvas-material` scenario objects (lines ~913-930) with:

```tsx
  {
    id: "slides-canvas-pop",
    title: "Theme — Pop",
    description: "Same slide under the vibrant pop theme.",
    render: () => <SlideCanvas doc={makeThemedDoc("pop")} />,
  },
  {
    id: "slides-canvas-slate",
    title: "Theme — Slate",
    description: "Same slide under the dark slate theme — light text on a dark background.",
    render: () => <SlideCanvas doc={makeThemedDoc("slate")} />,
  },
  {
    id: "slides-canvas-wafflebase",
    title: "Theme — Wafflebase",
    description: "Same slide under the Wafflebase brand theme (syrup/butter/berry palette).",
    render: () => <SlideCanvas doc={makeThemedDoc("wafflebase")} />,
  },
```

(Keep `slides-canvas-default-light`, `slides-canvas-default-dark`, and `slides-canvas-focus` unchanged.)

- [ ] **Step 2: Delete the stale baselines**

```bash
git rm packages/frontend/tests/visual/baselines/harness-visual.browser.slides-canvas-streamline.png packages/frontend/tests/visual/baselines/harness-visual.browser.slides-canvas-material.png
```

- [ ] **Step 3: Regenerate baselines for the new subset**

Run the Docker visual lane in update mode (the repo's baseline-update flow):

Run: `pnpm verify:browser:docker`
Expected: FAIL the first time for the three new scenarios (no baseline). Re-run with the project's baseline-update flag (check `packages/frontend` scripts for the `--update`/`UPDATE_SNAPSHOTS` flow) to write `slides-canvas-pop.png`, `slides-canvas-slate.png`, `slides-canvas-wafflebase.png`. Also confirm `slides-canvas-default-light` and `slides-canvas-default-dark` baselines are regenerated (their colors changed during de-branding) and committed.

- [ ] **Step 4: Re-run to verify clean**

Run: `pnpm verify:browser:docker`
Expected: PASS — all six slides theme scenarios match their baselines.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/harness/visual/slides-scenarios.tsx packages/frontend/tests/visual/baselines/
git commit -m "test(frontend): retarget slides theme snapshots to 6-theme subset"
```

---

### Task 6: Full verification + docs

**Files:**
- Modify: `docs/tasks/active/20260620-slides-theme-catalog-todo.md` (check off items, add Review section)
- Modify: `docs/tasks/active/20260620-slides-theme-catalog-lessons.md` (fill bundle delta + any contrast adjustments)

- [ ] **Step 1: Run the self gate**

Run: `pnpm verify:self`
Expected: PASS — lint, all unit tests (including the new theme tests), and all builds. Note the frontend chunk-gate result; record the delta in the lessons file.

- [ ] **Step 2: Manual smoke**

Run: `pnpm dev`, open a deck, open the Theme panel. Confirm the list scrolls all 23 themes, the two defaults are neutral (no waffle colors), applying `wafflebase` restores the brand look, and applying `slate` renders correctly (light text on dark). Note any issue.

- [ ] **Step 3: Fill the todo Review + lessons, then commit**

```bash
git add docs/tasks/active/20260620-slides-theme-catalog-todo.md docs/tasks/active/20260620-slides-theme-catalog-lessons.md
git commit -m "docs: slides theme catalog task review + lessons"
```

---

## Self-Review

**Spec coverage:**
- De-brand defaults → Task 1. ✅
- Move brand palette into one `wafflebase` theme, last in order → Task 1 (module) + Task 2 (ordering). ✅
- Expand to 23 GS-parity themes → Task 2. ✅
- Keep ids stable / flat list / no model change → Global Constraints + Task 2 (`index.ts` unchanged model). ✅
- Full palettes match the design table → Task 2 literals copied from the design's palette table. ✅
- Font reuse from catalog → Task 4 enforces it. ✅
- Catalog validity + AA contrast → Task 3. ✅
- Migration note (existing decks shift color, intended) → no code; documented in design + verified by manual smoke (Task 6 step 2). ✅
- Visual: representative 6-theme subset → Task 5. ✅
- Rollout commits → one per task, matching the design's 4-commit layering plus tests. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete literals/tests. The only open value is the baseline-update flag in Task 5 step 3 (project-specific), which is described as "check `packages/frontend` scripts" rather than guessed.

**Type consistency:** All literals satisfy `Theme` (`id`, `name`, `colors: ColorScheme`, `fonts: FontScheme`). Export names are camelCase (`modernWriter`, `beachDay`) while ids are kebab-case (`modern-writer`, `beach-day`) — consistent between the module `export const` and the `index.ts` import/array. `EXPECTED_ORDER` in Task 2 matches the `BUILT_IN_THEMES` array order in `index.ts`.
