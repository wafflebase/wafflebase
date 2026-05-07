# Slides PR1 — Themed Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land PR1 of the slides themes/layouts work — Theme/Master/Layout/Slide 4-tier model, hybrid color binding, five built-in themes, eleven Google-Slides-parity layouts, theme picker side panel, themed color and font pickers — as eight commits in one stacked PR.

**Architecture:** Mirror the OOXML / Google Slides hierarchy. New types and built-in themes live in `@wafflebase/slides`; one additive type-widening lands in `@wafflebase/docs` (`Inline.style.color: string | ThemeColor`). All canvas color/font assignments route through `resolveColor(...)` / `resolveFont(...)`. Existing v1 decks migrate read-time and idempotently.

**Tech Stack:** TypeScript, Vitest, Yorkie CRDTs, `@wafflebase/docs` (existing), `@wafflebase/slides` (existing), React (frontend shell), node-canvas (new visual snapshot infra).

**Spec:** [docs/design/slides/slides-themes-layouts-import.md](../../design/slides/slides-themes-layouts-import.md)

---

## Task index

| # | Commit | Files | Tests |
|---|---|---|---|
| 0 | (no commit) Task 0: Visual snapshot infrastructure | `packages/slides/test-fixtures/visual/`, `packages/slides/scripts/render-snapshot.mjs`, `packages/slides/package.json` | `*.visual.test.ts` |
| 1 | `feat(slides): Theme/Master/Layout types and resolve fns` | `model/theme.ts`, `model/master.ts`, `model/presentation.ts` | `theme.test.ts`, `master.test.ts` |
| 2 | `feat(slides): renderer reads through resolveColor/resolveFont` | `view/canvas/{slide,shape,text,element}-renderer.ts`, `view/canvas/render-context.ts` | renderer tests |
| 3 | `feat(slides): yorkie schema + read-time migration` | `frontend/src/app/slides/yorkie-slides-store.ts`, `frontend/src/types/slides-document.ts`, `model/migrate.ts` | `migrate.test.ts`, `yorkie-slides-store.test.ts` |
| 4 | `feat(docs): extend Inline.style.color to ThemeColor` | `packages/docs/src/model/types.ts`, `packages/docs/src/index.ts`, `packages/docs/src/model/color.ts` | `color.test.ts` |
| 5 | `feat(slides): five built-in themes` | `packages/slides/src/themes/{default-light,default-dark,streamline,focus,material,index}.ts` | `themes.test.ts`, `themes.visual.test.ts` |
| 6 | `feat(frontend): theme picker side panel` | `packages/frontend/src/app/slides/theme-panel.tsx`, integration into `editor-shell.tsx` | `theme-panel.test.tsx` |
| 7 | `feat(slides): eleven Google-Slides-parity built-in layouts` | `packages/slides/src/model/layout.ts` | `layout.test.ts`, `layouts.visual.test.ts` |
| 8 | `feat(frontend): themed color + font pickers` | `packages/frontend/src/app/slides/themed-color-picker.tsx`, `themed-font-picker.tsx`, contextual toolbar wiring | picker tests |

---

## Task 0: Visual snapshot infrastructure (foundation, no commit yet)

This task adds the **visual golden** infra used by Tasks 5 and 7. It does **not produce a commit by itself**. It lands in the same commit as Task 5's first snapshot ("setup + use").

**Files:**
- Create: `packages/slides/test-fixtures/visual/` (directory)
- Create: `packages/slides/src/test-utils/render-snapshot.ts`
- Create: `packages/slides/src/test-utils/load-fixture.ts`
- Modify: `packages/slides/package.json` (add `canvas` devDep + `test:visual` script)
- Create: `packages/slides/test-fixtures/decks/{empty,title-only,three-slides}.json` — three reference decks for snapshots

- [ ] **Step 0.1: Add node-canvas devDependency**

```bash
pnpm --filter @wafflebase/slides add -D canvas@^2.11.2
```

Verify it's pure-JS-with-prebuilt-binary (no system libs needed on macOS):

```bash
pnpm --filter @wafflebase/slides exec node -e "const c = require('canvas'); console.log(c.createCanvas(10, 10).toBuffer().length)"
```

Expected: prints a number > 0.

- [ ] **Step 0.2: Create the render-snapshot helper**

Create `packages/slides/src/test-utils/render-snapshot.ts`:

```typescript
import { createCanvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';
import type { SlidesDocument, Slide } from '../model/presentation';
import type { Theme } from '../model/theme';
import { drawSlide } from '../view/canvas/slide-renderer';

const SNAPSHOT_W = 320;
const SNAPSHOT_H = 180;

export function renderSlideToPng(
  slide: Slide,
  doc: SlidesDocument,
  theme: Theme,
): Buffer {
  const canvas = createCanvas(SNAPSHOT_W, SNAPSHOT_H);
  const ctx = canvas.getContext('2d');
  // Scale logical 1920x1080 to 320x180 (×0.166...)
  ctx.scale(SNAPSHOT_W / 1920, SNAPSHOT_H / 1080);
  // drawSlide ignores anything beyond CanvasRenderingContext2D — node-canvas Ctx is compatible
  drawSlide(ctx as unknown as CanvasRenderingContext2D, slide, doc, theme);
  return canvas.toBuffer('image/png');
}

export function renderDeckThumbStrip(
  doc: SlidesDocument,
  theme: Theme,
): Buffer {
  // Render each slide horizontally tiled at 320x180; total H = 180, W = 320 * N
  const W = SNAPSHOT_W * doc.slides.length;
  const canvas = createCanvas(W, SNAPSHOT_H);
  const ctx = canvas.getContext('2d');
  doc.slides.forEach((slide, i) => {
    ctx.save();
    ctx.translate(SNAPSHOT_W * i, 0);
    ctx.scale(SNAPSHOT_W / 1920, SNAPSHOT_H / 1080);
    drawSlide(ctx as unknown as CanvasRenderingContext2D, slide, doc, theme);
    ctx.restore();
  });
  return canvas.toBuffer('image/png');
}
```

> **Note:** `drawSlide(ctx, slide, doc, theme)` is the new renderer signature introduced in Task 2. For Task 0, write the helper assuming that signature; it'll be exercised once Task 2 lands.

- [ ] **Step 0.3: Create the load-fixture helper**

Create `packages/slides/src/test-utils/load-fixture.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SlidesDocument } from '../model/presentation';

const FIXTURE_ROOT = join(__dirname, '..', '..', 'test-fixtures', 'decks');

export function loadDeckFixture(name: string): SlidesDocument {
  const path = join(FIXTURE_ROOT, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}
```

- [ ] **Step 0.4: Create three reference decks**

Create `packages/slides/test-fixtures/decks/empty.json`:

```json
{
  "meta": { "title": "Empty deck", "themeId": "default-light", "masterId": "default" },
  "themes": [],
  "masters": [],
  "layouts": [],
  "slides": []
}
```

Create `packages/slides/test-fixtures/decks/title-only.json`:

```json
{
  "meta": { "title": "Title only", "themeId": "default-light", "masterId": "default" },
  "themes": [],
  "masters": [],
  "layouts": [],
  "slides": [
    {
      "id": "s1",
      "layoutId": "title-slide",
      "background": { "fill": { "kind": "role", "role": "background" } },
      "elements": [
        {
          "id": "e1",
          "type": "text",
          "frame": { "x": 80, "y": 420, "w": 1760, "h": 160, "rotation": 0 },
          "data": {
            "blocks": [
              {
                "id": "b1",
                "type": "paragraph",
                "inlines": [{ "text": "Hello, themed slides", "style": { "fontSize": 48 } }],
                "style": { "alignment": "center", "lineHeight": 1.2, "marginTop": 0, "marginBottom": 0, "textIndent": 0, "marginLeft": 0 }
              }
            ]
          }
        }
      ],
      "notes": []
    }
  ]
}
```

Create `packages/slides/test-fixtures/decks/three-slides.json` similarly with three slides exercising title, body, and a shape. Keep it minimal — total file ~80 lines.

- [ ] **Step 0.5: Add visual test script**

Modify `packages/slides/package.json` — add to scripts:

```json
"test:visual": "vitest run --include 'src/**/*.visual.test.ts'",
"test:visual:update": "vitest run --include 'src/**/*.visual.test.ts' --update"
```

- [ ] **Step 0.6: Stage the snapshot fixture loader**

No commit yet — these files only become useful from Task 2 onward. Move on.

---

## Task 1: Theme/Master/Layout types + resolve fns

**Goal:** Pure types and resolvers in `@wafflebase/slides`. No store, no renderer changes.

**Commit message:** `feat(slides): Theme/Master/Layout types and resolve fns`

**Files:**
- Create: `packages/slides/src/model/theme.ts`
- Create: `packages/slides/src/model/master.ts`
- Modify: `packages/slides/src/model/presentation.ts` (extend `SlidesDocument`, `Background`)
- Modify: `packages/slides/src/index.ts` (re-export new types)
- Test: `packages/slides/src/model/theme.test.ts`
- Test: `packages/slides/src/model/master.test.ts`

- [ ] **Step 1.1: Write the failing theme test**

Create `packages/slides/src/model/theme.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  resolveFont,
  type ColorScheme,
  type FontScheme,
  type Theme,
  type ThemeColor,
} from './theme';

const COLORS: ColorScheme = {
  text: '#000000',
  background: '#ffffff',
  textSecondary: '#444444',
  backgroundAlt: '#f3f3f3',
  accent1: '#FF9900',
  accent2: '#00AAEE',
  accent3: '#33CC33',
  accent4: '#CC3333',
  accent5: '#9966CC',
  accent6: '#666666',
  hyperlink: '#1155CC',
  visitedHyperlink: '#7733AA',
};

const FONTS: FontScheme = { heading: 'Inter', body: 'Inter' };

const THEME: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: COLORS,
  fonts: FONTS,
};

describe('resolveColor', () => {
  it('returns srgb value verbatim', () => {
    expect(resolveColor({ kind: 'srgb', value: '#abcdef' }, THEME)).toBe('#abcdef');
  });

  it('resolves a role to the theme color', () => {
    expect(resolveColor({ kind: 'role', role: 'accent1' }, THEME)).toBe('#FF9900');
  });

  it('applies tint (lighter)', () => {
    // tint=50000 (50%) of #FF9900 toward white => roughly #FFCC80
    const out = resolveColor({ kind: 'role', role: 'accent1', tint: 0.5 }, THEME);
    expect(out.toUpperCase()).toBe('#FFCC80');
  });

  it('applies shade (darker)', () => {
    // shade=50000 (50%) of #FF9900 toward black => roughly #804C00
    const out = resolveColor({ kind: 'role', role: 'accent1', shade: 0.5 }, THEME);
    expect(out.toUpperCase()).toBe('#804C00');
  });
});

describe('resolveFont', () => {
  it('returns family verbatim', () => {
    expect(resolveFont({ kind: 'family', family: 'Roboto' }, THEME)).toBe('Roboto');
  });

  it('resolves a heading role', () => {
    expect(resolveFont({ kind: 'role', role: 'heading' }, THEME)).toBe('Inter');
  });

  it('resolves a body role', () => {
    expect(resolveFont({ kind: 'role', role: 'body' }, THEME)).toBe('Inter');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test src/model/theme.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement `model/theme.ts`**

Create `packages/slides/src/model/theme.ts`:

```typescript
export type ColorScheme = {
  text: string;            // OOXML dk1
  background: string;      // OOXML lt1
  textSecondary: string;   // OOXML dk2
  backgroundAlt: string;   // OOXML lt2
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hyperlink: string;
  visitedHyperlink: string;
};

export type FontScheme = {
  heading: string;
  body: string;
};

export type Theme = {
  id: string;
  name: string;
  colors: ColorScheme;
  fonts: FontScheme;
};

export type ColorRole = keyof ColorScheme;
export type FontRole = keyof FontScheme;

export type ThemeColor =
  | { kind: 'role'; role: ColorRole; tint?: number; shade?: number }
  | { kind: 'srgb'; value: string };

export type ThemeFont =
  | { kind: 'role'; role: FontRole }
  | { kind: 'family'; family: string };

export function resolveColor(color: ThemeColor, theme: Theme): string {
  if (color.kind === 'srgb') return color.value;
  const base = theme.colors[color.role];
  if (color.tint != null) return tintColor(base, color.tint);
  if (color.shade != null) return shadeColor(base, color.shade);
  return base;
}

export function resolveFont(font: ThemeFont, theme: Theme): string {
  if (font.kind === 'family') return font.family;
  return theme.fonts[font.role];
}

// Helpers — tint blends toward white, shade blends toward black.
// PPTX uses 0..100000 for tint/shade; we accept a normalized 0..1 here.

function parseHex(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function tintColor(hex: string, ratio: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio);
}

function shadeColor(hex: string, ratio: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}
```

- [ ] **Step 1.4: Run theme test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test src/model/theme.test.ts
```

Expected: 7 passed.

- [ ] **Step 1.5: Write the failing master test**

Create `packages/slides/src/model/master.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_MASTER, type Master, type PlaceholderStyle } from './master';

describe('DEFAULT_MASTER', () => {
  it('has the canonical id and themeId', () => {
    expect(DEFAULT_MASTER.id).toBe('default');
    expect(DEFAULT_MASTER.themeId).toBe('default-light');
  });

  it('has title and body placeholder styles', () => {
    const styles = DEFAULT_MASTER.placeholderStyles;
    expect(styles.title).toBeDefined();
    expect(styles.body).toBeDefined();
    expect(styles.title.fontRole).toBe('heading');
    expect(styles.body.fontRole).toBe('body');
  });

  it('has a background fill that resolves to a theme role', () => {
    expect(DEFAULT_MASTER.background.fill).toEqual({ kind: 'role', role: 'background' });
  });

  it('placeholder styles bind colors by role', () => {
    const ps: PlaceholderStyle = DEFAULT_MASTER.placeholderStyles.title;
    expect(ps.colorRole).toBe('text');
  });
});
```

- [ ] **Step 1.6: Run master test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test src/model/master.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.7: Implement `model/master.ts`**

Create `packages/slides/src/model/master.ts`:

```typescript
import type { ColorRole, FontRole, ThemeColor } from './theme';

export type PlaceholderStyle = {
  fontRole: FontRole;
  fontSize: number;
  colorRole: ColorRole;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
};

export type MasterBackground = {
  fill: ThemeColor;
};

export type Master = {
  id: string;
  themeId: string;
  background: MasterBackground;
  placeholderStyles: {
    title: PlaceholderStyle;
    body: PlaceholderStyle;
    [key: string]: PlaceholderStyle;
  };
};

export const DEFAULT_MASTER: Master = {
  id: 'default',
  themeId: 'default-light',
  background: { fill: { kind: 'role', role: 'background' } },
  placeholderStyles: {
    title: {
      fontRole: 'heading',
      fontSize: 44,
      colorRole: 'text',
      align: 'left',
      lineHeight: 1.2,
    },
    body: {
      fontRole: 'body',
      fontSize: 18,
      colorRole: 'text',
      align: 'left',
      lineHeight: 1.5,
    },
    subtitle: {
      fontRole: 'body',
      fontSize: 24,
      colorRole: 'textSecondary',
      align: 'left',
      lineHeight: 1.4,
    },
  },
};
```

- [ ] **Step 1.8: Run master test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test src/model/master.test.ts
```

Expected: 4 passed.

- [ ] **Step 1.9: Extend SlidesDocument and Background**

Modify `packages/slides/src/model/presentation.ts`. Replace the file with:

```typescript
import type { Block } from '@wafflebase/docs';
import type { Element, ElementInit, ImageRef } from './element';
import type { Theme, ThemeColor } from './theme';
import type { Master } from './master';

export type Background = {
  fill: ThemeColor;
  image?: ImageRef;
};

export type Slide = {
  id: string;
  layoutId: string;
  background: Background;
  elements: Element[];
  notes: Block[];
};

export type PlaceholderSpec = ElementInit;

export type Layout = {
  id: string;
  masterId: string;
  name: string;
  background?: Background;
  placeholders: PlaceholderSpec[];
  staticElements: Element[]; // v1.0: always empty; v1.5 populates
};

export type Meta = {
  title: string;
  themeId: string;
  masterId: string;
};

export type SlidesDocument = {
  meta: Meta;
  themes: Theme[];
  masters: Master[];
  layouts: Layout[];
  slides: Slide[];
};

export const DEFAULT_BACKGROUND: Background = {
  fill: { kind: 'role', role: 'background' },
};

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
```

- [ ] **Step 1.10: Re-export new types from package index**

Modify `packages/slides/src/index.ts`. Add (preserving existing exports):

```typescript
export type {
  Theme,
  ColorScheme,
  FontScheme,
  ColorRole,
  FontRole,
  ThemeColor,
  ThemeFont,
} from './model/theme';
export { resolveColor, resolveFont } from './model/theme';
export type { Master, PlaceholderStyle, MasterBackground } from './model/master';
export { DEFAULT_MASTER } from './model/master';
```

- [ ] **Step 1.11: Run all slides tests**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: all existing tests still pass + 11 new tests (7 theme + 4 master). Type errors expected in renderer/store files because `Background.fill` and `ShapeElement.fill` are now `ThemeColor`. Defer those to Tasks 2 and 5.

> **Important:** You'll see TS errors in `view/canvas/*.ts`, `store/memory.ts`, `frontend/yorkie-slides-store.ts`. **That's expected**. Tasks 2–4 fix them. The commit at the end of Task 1 only includes the four files below.

- [ ] **Step 1.12: Stage and commit**

```bash
git add \
  packages/slides/src/model/theme.ts \
  packages/slides/src/model/master.ts \
  packages/slides/src/model/theme.test.ts \
  packages/slides/src/model/master.test.ts \
  packages/slides/src/model/presentation.ts \
  packages/slides/src/index.ts
git commit -m "feat(slides): Theme/Master/Layout types and resolve fns

Introduce the type vocabulary for the v0.5 theme system:
- Theme = ColorScheme (12 slots) + FontScheme (heading + body)
- Master = themed background + placeholder styles
- ThemeColor = role | srgb (hybrid binding)
- ThemeFont = role | family
- resolveColor/resolveFont with tint/shade math

Background.fill becomes ThemeColor; SlidesDocument gains themes,
masters arrays and meta.themeId/masterId.

Renderer and stores will be wired through resolvers in the next
commit; intermediate type errors are expected until then.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> **Note:** This commit alone does NOT pass `pnpm verify:fast` because of intermediate TS errors. The PR's first **green** commit is Task 2 (renderer routing through resolvers). Document this explicitly in the PR description so reviewers don't try to bisect.

---

## Task 2: Renderer reads through resolvers

**Goal:** Every `ctx.fillStyle = ...`, `ctx.strokeStyle = ...`, `ctx.font = ...` in the canvas renderers goes through `resolveColor` / `resolveFont`. ShapeElement, Background, and TextElement palette-driven colors all work.

**Commit message:** `feat(slides): renderer reads through resolveColor/resolveFont`

**Files:**
- Modify: `packages/slides/src/model/element.ts` (widen ShapeElement.fill / stroke.color)
- Create: `packages/slides/src/view/canvas/render-context.ts` (passes theme through draw calls)
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts`
- Modify: `packages/slides/src/view/canvas/element-renderer.ts`
- Modify: `packages/slides/src/view/canvas/shape-renderer.ts`
- Modify: `packages/slides/src/view/canvas/text-renderer.ts`
- Test: `packages/slides/src/view/canvas/shape-renderer.test.ts` (extend)
- Test: `packages/slides/src/view/canvas/slide-renderer.test.ts` (new or extend)

- [ ] **Step 2.1: Widen `ShapeElement` color types**

Modify `packages/slides/src/model/element.ts`. Change `ShapeStroke.color` and `ShapeElement.data.fill` to `ThemeColor`:

```typescript
import type { Block } from '@wafflebase/docs';
import type { ThemeColor } from './theme';

// ... (Frame, ImageRef, Crop, ShapeKind unchanged)

export type ShapeStroke = {
  color: ThemeColor;
  width: number;
};

// ... (ElementBase, TextElement, ImageElement unchanged)

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};

// ... (rest unchanged)
```

- [ ] **Step 2.2: Create `render-context.ts`**

Create `packages/slides/src/view/canvas/render-context.ts`:

```typescript
import type { SlidesDocument } from '../../model/presentation';
import type { Theme } from '../../model/theme';

export type RenderContext = {
  doc: SlidesDocument;
  theme: Theme;
};

export function getActiveTheme(doc: SlidesDocument): Theme {
  const t = doc.themes.find((x) => x.id === doc.meta.themeId);
  if (!t) {
    throw new Error(
      `[slides] active theme '${doc.meta.themeId}' not found in document; ` +
        `themes: ${doc.themes.map((x) => x.id).join(', ') || '(none)'}`,
    );
  }
  return t;
}
```

- [ ] **Step 2.3: Route shape-renderer through resolveColor**

Modify `packages/slides/src/view/canvas/shape-renderer.ts`. Change the function signature to accept `theme: Theme` and call `resolveColor` at every `ctx.fillStyle` / `ctx.strokeStyle` site:

```typescript
import type { ShapeElement } from '../../model/element';
import type { Theme } from '../../model/theme';
import { resolveColor } from '../../model/theme';

export function drawShape(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  theme: Theme,
): void {
  const { data, frame } = el;
  const w = frame.w;
  const h = frame.h;
  switch (data.kind) {
    case 'rect':
      if (data.fill) {
        ctx.fillStyle = resolveColor(data.fill, theme);
        ctx.fillRect(0, 0, w, h);
      }
      if (data.stroke) {
        ctx.strokeStyle = resolveColor(data.stroke.color, theme);
        ctx.lineWidth = data.stroke.width;
        ctx.strokeRect(0, 0, w, h);
      }
      return;
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (data.fill) {
        ctx.fillStyle = resolveColor(data.fill, theme);
        ctx.fill();
      }
      if (data.stroke) {
        ctx.strokeStyle = resolveColor(data.stroke.color, theme);
        ctx.lineWidth = data.stroke.width;
        ctx.stroke();
      }
      return;
    }
    case 'line': {
      if (!data.stroke) return;
      ctx.strokeStyle = resolveColor(data.stroke.color, theme);
      ctx.lineWidth = data.stroke.width;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.stroke();
      return;
    }
    case 'arrow': {
      if (data.stroke) {
        ctx.strokeStyle = resolveColor(data.stroke.color, theme);
        ctx.lineWidth = data.stroke.width;
      }
      // shaft
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w - 12, h / 2);
      ctx.stroke();
      // head
      const headFill = data.fill ?? data.stroke?.color ?? { kind: 'role', role: 'text' };
      ctx.fillStyle = resolveColor(headFill, theme);
      ctx.beginPath();
      ctx.moveTo(w, h / 2);
      ctx.lineTo(w - 14, h / 2 - 8);
      ctx.lineTo(w - 14, h / 2 + 8);
      ctx.closePath();
      ctx.fill();
      return;
    }
  }
}
```

> Use the **existing** drawing logic for line/arrow geometry — only the color assignments are changing. If your current `shape-renderer.ts` has slightly different geometry, keep that geometry; only swap the color sites.

- [ ] **Step 2.4: Route slide-renderer through resolveColor**

Modify `packages/slides/src/view/canvas/slide-renderer.ts`. Change `drawSlide` to accept `(ctx, slide, doc, theme)` and route the background fill:

```typescript
import { resolveColor, type Theme } from '../../model/theme';
import { SLIDE_WIDTH, SLIDE_HEIGHT, type Slide, type SlidesDocument } from '../../model/presentation';
import { drawElement } from './element-renderer';

export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  theme: Theme,
): void {
  ctx.fillStyle = resolveColor(slide.background.fill, theme);
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  for (const element of slide.elements) {
    ctx.save();
    ctx.translate(element.frame.x, element.frame.y);
    if (element.frame.rotation) {
      ctx.translate(element.frame.w / 2, element.frame.h / 2);
      ctx.rotate(element.frame.rotation);
      ctx.translate(-element.frame.w / 2, -element.frame.h / 2);
    }
    drawElement(ctx, element, doc, theme);
    ctx.restore();
  }
}
```

- [ ] **Step 2.5: Route element-renderer through resolvers**

Modify `packages/slides/src/view/canvas/element-renderer.ts`. Pass theme/doc into the appropriate sub-renderers:

```typescript
import type { Element } from '../../model/element';
import type { SlidesDocument } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import { drawShape } from './shape-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';

export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  doc: SlidesDocument,
  theme: Theme,
): void {
  switch (element.type) {
    case 'shape':
      return drawShape(ctx, element, theme);
    case 'text':
      return drawText(ctx, element, theme);
    case 'image':
      return drawImage(ctx, element);
  }
}
```

- [ ] **Step 2.6: Route text-renderer through resolvers**

Modify `packages/slides/src/view/canvas/text-renderer.ts`. The text renderer delegates to `@wafflebase/docs` — pass a `colorResolver` callback so docs callers can resolve `string | ThemeColor`:

```typescript
import type { TextElement } from '../../model/element';
import type { Theme } from '../../model/theme';
import { resolveColor } from '../../model/theme';
import { computeLayout, paintLayout, normalizeBlockStyle, resolveLegacyColor } from '@wafflebase/docs';

export function drawText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  theme: Theme,
): void {
  const normalized = el.data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const colorResolver = (c: unknown) => {
    if (c == null) return undefined;
    if (typeof c === 'string') return c;
    return resolveColor(c as Parameters<typeof resolveColor>[0], theme);
  };
  const { layout } = computeLayout(normalized, /* measurer */ ctx, el.frame.w, {
    colorResolver,
  });
  paintLayout(ctx, layout, 0, 0);
}
```

> **Note:** `computeLayout`'s extra option `colorResolver` is added in Task 4 (the docs ripple). For now, the call passes the option but docs ignores it until Task 4 lands. To keep this commit green, pass through *both* the legacy `string` path and the resolver: docs reads `colorResolver` if defined, else falls back to `inline.style.color` as a string. **Verify with the docs maintainer note in Task 4 that `colorResolver` is the agreed extension point.**

- [ ] **Step 2.7: Update `image-renderer` placeholder to use ThemeColor**

The hard-coded placeholder colors in `image-renderer.ts` (lines 52, 54, 62, 65, 70 from the survey) are *intentional* hard-codes for the missing-image fallback UI. They don't bind to theme. **Leave them alone**. (Document this explicitly in the file's header comment if not already.)

Add a comment at the top of `image-renderer.ts`:

```typescript
// Image placeholder colors are intentionally hard-coded; they represent a
// system fallback UI (broken/loading image) and don't follow the deck theme.
```

- [ ] **Step 2.8: Update existing renderer tests**

Modify `packages/slides/src/view/canvas/shape-renderer.test.ts`. Existing tests pass shape elements with `string` fills/strokes. Update them to `ThemeColor` and pass a fake theme. Example:

```typescript
import { describe, it, expect } from 'vitest';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawShape } from './shape-renderer';
import type { ShapeElement } from '../../model/element';
import type { Theme } from '../../model/theme';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#abc', accent2: '#bcd', accent3: '#cde', accent4: '#def',
    accent5: '#e0e1e2', accent6: '#f0f1f2',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

it('draws a rect with srgb fill', () => {
  const spy = createCtxSpy();
  const el: ShapeElement = {
    id: 'e1',
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
  };
  drawShape(asCtx(spy), el, THEME);
  expect(spy.fillStyles).toContain('#abc');
});

it('draws a rect with role fill resolved from theme', () => {
  const spy = createCtxSpy();
  const el: ShapeElement = {
    id: 'e1',
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'role', role: 'accent1' } },
  };
  drawShape(asCtx(spy), el, THEME);
  expect(spy.fillStyles).toContain('#abc');
});
```

> Repeat for ellipse / line / arrow tests in the same file. Pattern: change `'#hex'` literals to `{ kind: 'srgb', value: '#hex' }`, append `, THEME` to `drawShape(...)` calls.

- [ ] **Step 2.9: Add slide-renderer test**

Create `packages/slides/src/view/canvas/slide-renderer.test.ts` (or extend existing):

```typescript
import { describe, it, expect } from 'vitest';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawSlide } from './slide-renderer';
import type { Slide, SlidesDocument } from '../../model/presentation';
import type { Theme } from '../../model/theme';

const THEME: Theme = { /* same as in shape-renderer.test.ts */ };

const DOC: SlidesDocument = {
  meta: { title: 't', themeId: 't', masterId: 'default' },
  themes: [THEME],
  masters: [],
  layouts: [],
  slides: [],
};

const SLIDE: Slide = {
  id: 's1',
  layoutId: 'blank',
  background: { fill: { kind: 'role', role: 'background' } },
  elements: [],
  notes: [],
};

it('paints the slide background using the theme background color', () => {
  const spy = createCtxSpy();
  drawSlide(asCtx(spy), SLIDE, DOC, THEME);
  expect(spy.fillStyles).toContain('#fff');
});
```

- [ ] **Step 2.10: Run all slides tests**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: all renderer tests pass. Store tests (`memory.test.ts`) may still fail because `MemSlidesStore` doesn't yet construct `themes`, `masters`, etc. **Do NOT fix store tests in Task 2** — they're in Task 3.

If store tests fail with "themes is undefined", skip them temporarily by `it.skip(...)` and add a TODO referencing Task 3. **Or** — preferable — fix `MemSlidesStore` minimally now (initialize `themes: [DEFAULT_LIGHT]`, `masters: [DEFAULT_MASTER]`, `meta.themeId/masterId`) and unskip the tests. Up to the implementer's judgment.

> The minimal `MemSlidesStore.constructor()` patch:
>
> ```typescript
> import { DEFAULT_MASTER } from '../model/master';
> import { defaultLight } from '../themes/default-light'; // Task 5
> // ...
> constructor() {
>   this.doc = {
>     meta: { title: 'Untitled presentation', themeId: 'default-light', masterId: 'default' },
>     themes: [defaultLight],
>     masters: [DEFAULT_MASTER],
>     layouts: clone(BUILT_IN_LAYOUTS),
>     slides: [],
>   };
> }
> ```
>
> Since Task 5 hasn't shipped `defaultLight` yet, define a tiny inline placeholder theme here for now and replace in Task 5.

- [ ] **Step 2.11: Verify `pnpm verify:fast` passes**

```bash
pnpm verify:fast
```

Expected: all 748+ existing tests pass + new theme/master/renderer tests.

- [ ] **Step 2.12: Stage and commit**

```bash
git add \
  packages/slides/src/model/element.ts \
  packages/slides/src/view/canvas/render-context.ts \
  packages/slides/src/view/canvas/slide-renderer.ts \
  packages/slides/src/view/canvas/element-renderer.ts \
  packages/slides/src/view/canvas/shape-renderer.ts \
  packages/slides/src/view/canvas/text-renderer.ts \
  packages/slides/src/view/canvas/image-renderer.ts \
  packages/slides/src/view/canvas/shape-renderer.test.ts \
  packages/slides/src/view/canvas/slide-renderer.test.ts \
  packages/slides/src/store/memory.ts
git commit -m "feat(slides): renderer reads through resolveColor/resolveFont

Every ctx.fillStyle, ctx.strokeStyle, and (text path) ctx.font goes
through resolveColor / resolveFont. ShapeElement and Background colors
widened to ThemeColor. drawSlide now takes (ctx, slide, doc, theme).

Image placeholder colors stay hard-coded — they're a fallback UI, not
themed content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Yorkie schema + read-time migration

**Goal:** `YorkieSlidesStore.read()` reconciles legacy documents (no `themes` / `masters` / `meta.themeId`) with the new shape; mutations work; two-user `applyTheme` converges.

**Commit message:** `feat(slides): yorkie schema + read-time migration`

**Files:**
- Create: `packages/slides/src/model/migrate.ts`
- Test: `packages/slides/src/model/migrate.test.ts`
- Modify: `packages/frontend/src/types/slides-document.ts` (extend `YorkieSlidesRoot`)
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
- Test: `packages/frontend/tests/app/slides/migrate.test.ts`
- Test: `packages/frontend/tests/app/slides/yorkie-slides-store.test.ts` (extend)

- [ ] **Step 3.1: Write the migration unit test**

Create `packages/slides/src/model/migrate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { migrateDocument } from './migrate';

describe('migrateDocument', () => {
  it('adds default themeId/masterId/themes/masters/layouts to legacy doc', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [],
      layouts: [{ id: 'blank', name: 'Blank', placeholders: [] }],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.meta.themeId).toBe('default-light');
    expect(out.meta.masterId).toBe('default');
    expect(out.themes.find((t) => t.id === 'default-light')).toBeDefined();
    expect(out.masters.find((m) => m.id === 'default')).toBeDefined();
    expect(out.layouts.find((l) => l.id === 'blank')).toBeDefined();
  });

  it('remaps legacy layoutId "title" to "title-slide"', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'title',
          background: { fill: '#ffffff' },
          elements: [],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides[0].layoutId).toBe('title-slide');
  });

  it('wraps a legacy string background fill into srgb ThemeColor', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'blank',
          background: { fill: '#ffaa00' },
          elements: [],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides[0].background.fill).toEqual({ kind: 'srgb', value: '#ffaa00' });
  });

  it('wraps a legacy shape fill string into srgb ThemeColor', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'blank',
          background: { fill: '#fff' },
          elements: [
            {
              id: 'e1',
              type: 'shape',
              frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
              data: { kind: 'rect', fill: '#abcdef' },
            },
          ],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    const shape = out.slides[0].elements[0] as any;
    expect(shape.data.fill).toEqual({ kind: 'srgb', value: '#abcdef' });
  });

  it('is idempotent — running twice produces the same result', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [],
      layouts: [],
    } as any;
    const once = migrateDocument(legacy);
    const twice = migrateDocument(once);
    expect(twice).toEqual(once);
  });
});
```

- [ ] **Step 3.2: Run migration test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test src/model/migrate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `model/migrate.ts`**

Create `packages/slides/src/model/migrate.ts`:

```typescript
import type { SlidesDocument } from './presentation';
import type { ThemeColor } from './theme';
import { DEFAULT_MASTER } from './master';
import { defaultLight } from '../themes/default-light';

const LAYOUT_ID_MIGRATIONS: Record<string, string> = {
  title: 'title-slide',
};

export function migrateDocument(input: unknown): SlidesDocument {
  const raw = input as any;
  const meta = {
    title: raw?.meta?.title ?? 'Untitled presentation',
    themeId: raw?.meta?.themeId ?? 'default-light',
    masterId: raw?.meta?.masterId ?? 'default',
  };
  const themes = Array.isArray(raw?.themes) && raw.themes.length > 0
    ? raw.themes
    : [defaultLight];
  const masters = Array.isArray(raw?.masters) && raw.masters.length > 0
    ? raw.masters
    : [DEFAULT_MASTER];
  const layouts = Array.isArray(raw?.layouts) ? raw.layouts.map(migrateLayout) : [];
  const slides = Array.isArray(raw?.slides) ? raw.slides.map(migrateSlide) : [];
  return { meta, themes, masters, layouts, slides };
}

function migrateLayout(layout: any): any {
  return {
    id: layout?.id ?? 'blank',
    masterId: layout?.masterId ?? 'default',
    name: layout?.name ?? layout?.id ?? 'Layout',
    background: layout?.background ? migrateBackground(layout.background) : undefined,
    placeholders: layout?.placeholders ?? [],
    staticElements: layout?.staticElements ?? [],
  };
}

function migrateSlide(slide: any): any {
  const layoutId = LAYOUT_ID_MIGRATIONS[slide?.layoutId] ?? slide?.layoutId ?? 'blank';
  return {
    id: slide?.id,
    layoutId,
    background: migrateBackground(slide?.background ?? { fill: '#ffffff' }),
    elements: Array.isArray(slide?.elements) ? slide.elements.map(migrateElement) : [],
    notes: slide?.notes ?? [],
  };
}

function migrateBackground(bg: any): { fill: ThemeColor; image?: any } {
  return {
    fill: wrapColor(bg?.fill ?? '#ffffff'),
    image: bg?.image,
  };
}

function migrateElement(el: any): any {
  if (el?.type !== 'shape') return el;
  return {
    ...el,
    data: {
      ...el.data,
      fill: el.data?.fill != null ? wrapColor(el.data.fill) : undefined,
      stroke: el.data?.stroke != null
        ? { ...el.data.stroke, color: wrapColor(el.data.stroke.color) }
        : undefined,
    },
  };
}

function wrapColor(c: unknown): ThemeColor {
  if (typeof c === 'string') return { kind: 'srgb', value: c };
  if (c && typeof c === 'object' && 'kind' in (c as any)) return c as ThemeColor;
  return { kind: 'role', role: 'background' };
}
```

> **Dependency note:** This file imports `defaultLight` from `../themes/default-light`. That theme is created in Task 5. **For Task 3 to land before Task 5**, define an inline minimal theme in `migrate.ts` and replace the import in Task 5. Concretely:
>
> ```typescript
> // Inline placeholder until Task 5
> import type { Theme } from './theme';
> const defaultLight: Theme = {
>   id: 'default-light', name: 'Simple Light',
>   colors: { /* same 12 hex literals as the proper theme */ },
>   fonts: { heading: 'Inter', body: 'Inter' },
> };
> ```
>
> Task 5 deletes the inline placeholder and replaces with `import { defaultLight } from '../themes/default-light';`.

- [ ] **Step 3.4: Run migration test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test src/model/migrate.test.ts
```

Expected: 5 passed.

- [ ] **Step 3.5: Extend YorkieSlidesRoot type**

Modify `packages/frontend/src/types/slides-document.ts`. Add `themes`, `masters`, and extend `meta`:

```typescript
import type { Theme, Master } from '@wafflebase/slides';

export interface YorkieSlidesRoot {
  meta: {
    title: string;
    themeId?: string;   // optional during migration window
    masterId?: string;
  };
  themes?: Theme[];     // optional during migration window
  masters?: Master[];
  slides: YorkieSlide[];
  layouts: YorkieLayout[];
}
```

> **Schema policy:** Keep new fields **optional** in `YorkieSlidesRoot` so old clients (pre-PR1) connecting to a freshly migrated doc don't choke. Internally, after `read()` returns a `SlidesDocument`, those fields are guaranteed populated.

- [ ] **Step 3.6: Update `ensureSlidesRoot` in yorkie store**

Modify `packages/frontend/src/app/slides/yorkie-slides-store.ts`. Extend the root initialization:

```typescript
export function ensureSlidesRoot(doc: YorkieDocument<YorkieSlidesRoot>): void {
  const root = doc.getRoot();
  doc.update((r) => {
    if (r.meta == null) r.meta = { title: 'Untitled presentation' };
    if (r.meta.themeId == null) r.meta.themeId = 'default-light';
    if (r.meta.masterId == null) r.meta.masterId = 'default';
    if (r.slides == null) r.slides = [];
    if (r.layouts == null) {
      r.layouts = clone(BUILT_IN_LAYOUTS) as YorkieLayout[];
    }
    if (r.themes == null || r.themes.length === 0) {
      r.themes = [clone(defaultLight)] as Theme[];
    }
    if (r.masters == null || r.masters.length === 0) {
      r.masters = [clone(DEFAULT_MASTER)] as Master[];
    }
  });
  // ... existing notes/blocks normalization stays
}
```

Imports to add at the top of the file:

```typescript
import { DEFAULT_MASTER } from '@wafflebase/slides';
import { defaultLight } from '@wafflebase/slides/themes';  // Task 5 exports this
import type { Theme, Master } from '@wafflebase/slides';
```

> Until Task 5 ships, keep the `defaultLight` inline placeholder in this file too — same 12-color literal as in `migrate.ts`. Replace in Task 5.

- [ ] **Step 3.7: Update `read()` to apply migration on legacy docs**

In the same file, modify `read()`:

```typescript
read(): SlidesDocument {
  const root = this.doc.getRoot();
  const raw = {
    meta: yorkieToPlain(root.meta),
    themes: yorkieToPlain(root.themes ?? []),
    masters: yorkieToPlain(root.masters ?? []),
    layouts: yorkieToPlain(root.layouts ?? []),
    slides: (root.slides ?? []).map((slide) => /* existing slide-mapping logic */),
  };
  return migrateDocument(raw);
}
```

Add the import: `import { migrateDocument } from '@wafflebase/slides';` and re-export `migrateDocument` from `packages/slides/src/index.ts`.

- [ ] **Step 3.8: Add `addTheme` and `applyTheme` mutations**

Extend the `SlidesStore` interface in `packages/slides/src/store/store.ts`:

```typescript
// in SlidesStore:
addTheme(theme: Theme): void;       // idempotent on theme.id
applyTheme(themeId: string): void;  // theme must already be in themes[]
```

Add the import: `import type { Theme } from '../model/theme';`.

Implement in `MemSlidesStore` (`packages/slides/src/store/memory.ts`):

```typescript
addTheme(theme: Theme): void {
  this.requireBatch();
  if (this.doc.themes.find((t) => t.id === theme.id)) return; // idempotent
  this.doc.themes.push(clone(theme));
}

applyTheme(themeId: string): void {
  this.requireBatch();
  if (!this.doc.themes.find((t) => t.id === themeId)) {
    throw new Error(`[slides] theme '${themeId}' not in document`);
  }
  this.doc.meta.themeId = themeId;
}
```

And in `YorkieSlidesStore`:

```typescript
addTheme(theme: Theme): void {
  this.requireBatch();
  this.doc.update((r) => {
    if (r.themes == null) r.themes = [] as Theme[];
    if (r.themes.find((t) => t.id === theme.id)) return;
    r.themes.push(clone(theme) as Theme);
  });
}

applyTheme(themeId: string): void {
  this.requireBatch();
  this.doc.update((r) => {
    if (!r.themes?.find((t) => t.id === themeId)) {
      throw new Error(`[slides] theme '${themeId}' not in document`);
    }
    r.meta.themeId = themeId;
  });
}
```

- [ ] **Step 3.9: Write a two-user applyTheme convergence test**

Create or extend `packages/frontend/tests/app/slides/two-user-slides-yorkie.test.ts` (mirror docs/sheets two-user pattern):

```typescript
it('applyTheme converges across two users', async () => {
  const { storeA, storeB, sync } = await setupTwoUserSlides();
  // start with default-light
  expect(storeA.read().meta.themeId).toBe('default-light');

  // user A pushes a new theme into themes[]
  storeA.batch(() => {
    storeA.read().themes.push({ /* a minimal `dark` theme literal */ });
  });
  await sync();

  // user A applies it
  storeA.batch(() => storeA.applyTheme('dark'));
  await sync();

  expect(storeA.read().meta.themeId).toBe('dark');
  expect(storeB.read().meta.themeId).toBe('dark');
});
```

> Use whatever helper exists for two-user setup. If `setupTwoUserSlides` doesn't exist, mirror `setupTwoUserDocs` from `packages/frontend/tests/app/docs/`.

- [ ] **Step 3.10: Run all slides + frontend tests**

```bash
pnpm --filter @wafflebase/slides test
pnpm --filter @wafflebase/frontend test
```

Expected: all pass (including the new two-user test).

- [ ] **Step 3.11: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all 748+ tests pass.

- [ ] **Step 3.12: Stage and commit**

```bash
git add \
  packages/slides/src/model/migrate.ts \
  packages/slides/src/model/migrate.test.ts \
  packages/slides/src/store/store.ts \
  packages/slides/src/store/memory.ts \
  packages/slides/src/index.ts \
  packages/frontend/src/types/slides-document.ts \
  packages/frontend/src/app/slides/yorkie-slides-store.ts \
  packages/frontend/tests/app/slides/two-user-slides-yorkie.test.ts
git commit -m "feat(slides): yorkie schema + read-time migration

Extend YorkieSlidesRoot with themes[], masters[], meta.themeId,
meta.masterId — all optional in storage, populated by ensureSlidesRoot
on first attach.

read() runs migrateDocument over the raw root so legacy documents
appear with the default-light theme attached and any string-typed
colors wrapped to { kind: 'srgb' }. Migration is idempotent and
read-time; the first write afterwards persists the new shape.

Adds applyTheme(themeId) on SlidesStore for the upcoming theme picker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: docs `Inline.style.color` widening + `colorResolver`

**Goal:** `@wafflebase/docs` accepts `string | ThemeColor` for `Inline.style.color`. `computeLayout` and `paintLayout` accept an optional `colorResolver` that maps the value to a hex string at paint time. Sheets/docs callers continue passing `string` — unchanged.

**Commit message:** `feat(docs): extend Inline.style.color to ThemeColor`

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Create: `packages/docs/src/model/color.ts`
- Modify: `packages/docs/src/index.ts` (export new helpers)
- Modify: `packages/docs/src/view/layout.ts` (accept and use `colorResolver`)
- Modify: `packages/docs/src/view/paint.ts` (or wherever paintLayout reads `inline.style.color`)
- Test: `packages/docs/test/model/color.test.ts`
- Test: `packages/docs/test/view/themed-color.test.ts`

- [ ] **Step 4.1: Add the LegacyColor type and helper**

Create `packages/docs/src/model/color.ts`:

```typescript
// docs ships with no theme system of its own. To support themed slides
// (which embed docs Tree blocks), Inline.style.color accepts either a
// concrete hex string or a ThemeColor-shaped object. The renderer
// receives an optional `colorResolver` callback that maps that value to
// a hex string.

export type StoredColor =
  | string
  | { kind: 'role'; role: string; tint?: number; shade?: number }
  | { kind: 'srgb'; value: string };

export type ColorResolver = (c: StoredColor | undefined) => string | undefined;

export function defaultColorResolver(c: StoredColor | undefined): string | undefined {
  if (c == null) return undefined;
  if (typeof c === 'string') return c;
  if (c.kind === 'srgb') return c.value;
  // No theme registered; role colors fall back to a sensible default.
  return undefined;
}

export function wrapLegacyColor(c: string | StoredColor): StoredColor {
  return c;
}
```

- [ ] **Step 4.2: Write the color test**

Create `packages/docs/test/model/color.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { defaultColorResolver, wrapLegacyColor } from '../../src/model/color';

describe('defaultColorResolver', () => {
  it('returns string colors verbatim', () => {
    expect(defaultColorResolver('#abc')).toBe('#abc');
  });
  it('returns srgb values verbatim', () => {
    expect(defaultColorResolver({ kind: 'srgb', value: '#abc' })).toBe('#abc');
  });
  it('returns undefined for role colors (no theme registered)', () => {
    expect(defaultColorResolver({ kind: 'role', role: 'accent1' })).toBeUndefined();
  });
});

describe('wrapLegacyColor', () => {
  it('passes through a string', () => {
    expect(wrapLegacyColor('#abc')).toBe('#abc');
  });
});
```

- [ ] **Step 4.3: Run color test**

```bash
pnpm --filter @wafflebase/docs test test/model/color.test.ts
```

Expected: 4 passed.

- [ ] **Step 4.4: Widen `Inline.style.color` in types**

Modify `packages/docs/src/model/types.ts`:

```typescript
import type { StoredColor } from './color';

export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: StoredColor;          // ← was: string
  backgroundColor?: StoredColor; // ← was: string
  superscript?: boolean;
  subscript?: boolean;
  href?: string;
  pageNumber?: boolean;
  image?: ImageData;
}
```

> **Type compatibility:** `StoredColor` includes `string`, so all existing callers passing `string` continue to compile.

- [ ] **Step 4.5: Add `colorResolver` to layout/paint**

Modify `packages/docs/src/view/layout.ts` (or whichever file exports `computeLayout`). Add an optional options object:

```typescript
import { defaultColorResolver, type ColorResolver } from '../model/color';

export interface ComputeLayoutOptions {
  colorResolver?: ColorResolver;
}

export function computeLayout(
  blocks: Block[],
  measurer: Measurer,
  width: number,
  options: ComputeLayoutOptions = {},
): LayoutResult {
  const resolve = options.colorResolver ?? defaultColorResolver;
  // ... use `resolve(inline.style.color)` wherever color was previously read directly
}
```

Then in `paintLayout` (or wherever `ctx.fillStyle = inline.style.color` happens), thread the resolver in similarly:

```typescript
export function paintLayout(
  ctx: CanvasRenderingContext2D,
  layout: LayoutResult,
  x: number,
  y: number,
  options: ComputeLayoutOptions = {},
): void {
  const resolve = options.colorResolver ?? defaultColorResolver;
  // ... `ctx.fillStyle = resolve(inline.style.color) ?? '#000'`
}
```

- [ ] **Step 4.6: Write the themed color view test**

Create `packages/docs/test/view/themed-color.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeLayout, paintLayout, type Block, type ColorResolver } from '../../src';

it('paintLayout uses the supplied colorResolver for ThemeColor values', () => {
  const blocks: Block[] = [{
    id: 'b1', type: 'paragraph',
    inlines: [{ text: 'Hi', style: { color: { kind: 'role', role: 'accent1' } } }],
    style: { /* default block style */ } as any,
  }];
  const ctx = makeFakeCtx();
  const measurer = makeFakeMeasurer();
  const resolver: ColorResolver = (c) => {
    if (c && typeof c === 'object' && c.kind === 'role' && c.role === 'accent1') return '#ff9900';
    return undefined;
  };
  const { layout } = computeLayout(blocks, measurer, 200, { colorResolver: resolver });
  paintLayout(ctx as any, layout, 0, 0, { colorResolver: resolver });
  expect(ctx.fillStyles).toContain('#ff9900');
});
```

> Use existing test helpers in `packages/docs/test/view/` for `makeFakeCtx` and `makeFakeMeasurer`. If those names differ, mirror the closest existing test.

- [ ] **Step 4.7: Export new symbols from docs package**

Modify `packages/docs/src/index.ts`. Add:

```typescript
export type { StoredColor, ColorResolver } from './model/color';
export { defaultColorResolver, wrapLegacyColor } from './model/color';
```

- [ ] **Step 4.8: Run all docs tests**

```bash
pnpm --filter @wafflebase/docs test
```

Expected: all existing docs tests pass + 4 color + 1 themed-color test.

- [ ] **Step 4.9: Run all sheets tests (sanity check)**

```bash
pnpm --filter @wafflebase/sheets test
```

Expected: all pass — sheets only ever passed `string` colors, so the widened type is invisible to them.

- [ ] **Step 4.10: Update slides text-renderer to actually use the resolver**

This piece was stubbed in Task 2. Now refine `packages/slides/src/view/canvas/text-renderer.ts`:

```typescript
import { computeLayout, paintLayout, normalizeBlockStyle } from '@wafflebase/docs';
import type { ColorResolver } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { Theme, ThemeColor } from '../../model/theme';
import { resolveColor } from '../../model/theme';

function makeColorResolver(theme: Theme): ColorResolver {
  return (c) => {
    if (c == null) return undefined;
    if (typeof c === 'string') return c;
    return resolveColor(c as ThemeColor, theme);
  };
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  theme: Theme,
): void {
  const normalized = el.data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const colorResolver = makeColorResolver(theme);
  const { layout } = computeLayout(normalized, ctx, el.frame.w, { colorResolver });
  paintLayout(ctx, layout, 0, 0, { colorResolver });
}
```

- [ ] **Step 4.11: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all tests pass.

- [ ] **Step 4.12: Stage and commit**

```bash
git add \
  packages/docs/src/model/types.ts \
  packages/docs/src/model/color.ts \
  packages/docs/src/index.ts \
  packages/docs/src/view/layout.ts \
  packages/docs/src/view/paint.ts \
  packages/docs/test/model/color.test.ts \
  packages/docs/test/view/themed-color.test.ts \
  packages/slides/src/view/canvas/text-renderer.ts
git commit -m "feat(docs): extend Inline.style.color to ThemeColor

Inline.style.color and Inline.style.backgroundColor now accept
StoredColor = string | { kind: 'role', role, tint?, shade? } |
{ kind: 'srgb', value }. The change is strictly additive; existing
string callers in sheets and docs are unaffected.

computeLayout and paintLayout take an optional ColorResolver to
translate StoredColor at paint time. defaultColorResolver returns
strings verbatim and srgb values verbatim; role colors require the
caller (slides) to supply a theme-aware resolver.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Five built-in themes

**Goal:** Five `Theme` literals shipped under `packages/slides/src/themes/`, exported from the package. Visual snapshot suite (Task 0 infrastructure) generates 5 themes × 3 deck fixtures = 15 PNG goldens. Inline placeholder `defaultLight` from Tasks 3 and 4 replaced by the real export.

**Commit message:** `feat(slides): five built-in themes`

**Files:**
- Create: `packages/slides/src/themes/default-light.ts`
- Create: `packages/slides/src/themes/default-dark.ts`
- Create: `packages/slides/src/themes/streamline.ts`
- Create: `packages/slides/src/themes/focus.ts`
- Create: `packages/slides/src/themes/material.ts`
- Create: `packages/slides/src/themes/index.ts`
- Modify: `packages/slides/src/index.ts`
- Modify: `packages/slides/src/model/migrate.ts` (replace inline placeholder)
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts` (replace inline placeholder)
- Test: `packages/slides/src/themes/themes.test.ts`
- Test: `packages/slides/src/themes/themes.visual.test.ts`

- [ ] **Step 5.1: Create the default-light theme**

Create `packages/slides/src/themes/default-light.ts`:

```typescript
import type { Theme } from '../model/theme';

export const defaultLight: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: '#202124',
    background: '#FFFFFF',
    textSecondary: '#5F6368',
    backgroundAlt: '#F1F3F4',
    accent1: '#1A73E8',
    accent2: '#34A853',
    accent3: '#FBBC04',
    accent4: '#EA4335',
    accent5: '#673AB7',
    accent6: '#FF6D01',
    hyperlink: '#1A73E8',
    visitedHyperlink: '#7B1FA2',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
```

- [ ] **Step 5.2: Create default-dark, streamline, focus, material**

Each is a sibling file. Color values:

`default-dark.ts`:
```typescript
import type { Theme } from '../model/theme';
export const defaultDark: Theme = {
  id: 'default-dark',
  name: 'Simple Dark',
  colors: {
    text: '#E8EAED', background: '#202124',
    textSecondary: '#9AA0A6', backgroundAlt: '#303134',
    accent1: '#8AB4F8', accent2: '#81C995', accent3: '#FDD663',
    accent4: '#F28B82', accent5: '#C58AF9', accent6: '#FBBC04',
    hyperlink: '#8AB4F8', visitedHyperlink: '#C58AF9',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};
```

`streamline.ts`:
```typescript
import type { Theme } from '../model/theme';
export const streamline: Theme = {
  id: 'streamline',
  name: 'Streamline',
  colors: {
    text: '#212121', background: '#FAFAFA',
    textSecondary: '#616161', backgroundAlt: '#EEEEEE',
    accent1: '#1976D2', accent2: '#0D47A1', accent3: '#1565C0',
    accent4: '#42A5F5', accent5: '#90CAF9', accent6: '#E3F2FD',
    hyperlink: '#1976D2', visitedHyperlink: '#7B1FA2',
  },
  fonts: { heading: 'Roboto', body: 'Roboto' },
};
```

`focus.ts`:
```typescript
import type { Theme } from '../model/theme';
export const focus: Theme = {
  id: 'focus',
  name: 'Focus',
  colors: {
    text: '#3E2C1C', background: '#FAF3E7',
    textSecondary: '#7A5A36', backgroundAlt: '#F0E4CF',
    accent1: '#C2410C', accent2: '#A16207', accent3: '#854D0E',
    accent4: '#9A3412', accent5: '#7C2D12', accent6: '#451A03',
    hyperlink: '#C2410C', visitedHyperlink: '#7C2D12',
  },
  fonts: { heading: 'Lora', body: 'Inter' },
};
```

`material.ts`:
```typescript
import type { Theme } from '../model/theme';
export const material: Theme = {
  id: 'material',
  name: 'Material',
  colors: {
    text: '#212121', background: '#FFFFFF',
    textSecondary: '#757575', backgroundAlt: '#F5F5F5',
    accent1: '#3F51B5', accent2: '#009688', accent3: '#FFC107',
    accent4: '#F44336', accent5: '#9C27B0', accent6: '#FF5722',
    hyperlink: '#3F51B5', visitedHyperlink: '#7B1FA2',
  },
  fonts: { heading: 'Roboto', body: 'Roboto' },
};
```

- [ ] **Step 5.3: Create the themes index**

Create `packages/slides/src/themes/index.ts`:

```typescript
import type { Theme } from '../model/theme';
import { defaultLight } from './default-light';
import { defaultDark } from './default-dark';
import { streamline } from './streamline';
import { focus } from './focus';
import { material } from './material';

export { defaultLight, defaultDark, streamline, focus, material };

export const BUILT_IN_THEMES: Theme[] = [
  defaultLight,
  defaultDark,
  streamline,
  focus,
  material,
];

export function getBuiltInTheme(id: string): Theme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? defaultLight;
}
```

- [ ] **Step 5.4: Re-export from slides package index**

Modify `packages/slides/src/index.ts`. Add:

```typescript
export {
  defaultLight,
  defaultDark,
  streamline,
  focus,
  material,
  BUILT_IN_THEMES,
  getBuiltInTheme,
} from './themes';
```

- [ ] **Step 5.5: Replace inline placeholders**

Modify `packages/slides/src/model/migrate.ts` — replace the inline placeholder import:

```typescript
// Remove the inline placeholder; replace with:
import { defaultLight } from '../themes/default-light';
```

Modify `packages/frontend/src/app/slides/yorkie-slides-store.ts` similarly:

```typescript
import { defaultLight } from '@wafflebase/slides';
```

- [ ] **Step 5.6: Write the themes unit test**

Create `packages/slides/src/themes/themes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES, getBuiltInTheme, defaultLight } from './index';

describe('BUILT_IN_THEMES', () => {
  it('contains five themes with stable ids', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'default-light', 'default-dark', 'streamline', 'focus', 'material',
    ]);
  });

  it('every theme has all 12 color slots and 2 font slots', () => {
    for (const t of BUILT_IN_THEMES) {
      const c = t.colors;
      expect(c.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
      // ... assert all 12 fields are 6-digit hex
      expect(t.fonts.heading.length).toBeGreaterThan(0);
      expect(t.fonts.body.length).toBeGreaterThan(0);
    }
  });
});

describe('getBuiltInTheme', () => {
  it('returns the requested theme', () => {
    expect(getBuiltInTheme('material').id).toBe('material');
  });
  it('falls back to default-light for unknown ids', () => {
    expect(getBuiltInTheme('not-a-theme')).toBe(defaultLight);
  });
});
```

- [ ] **Step 5.7: Write the themes visual snapshot test**

Create `packages/slides/src/themes/themes.visual.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_THEMES } from './index';
import { renderDeckThumbStrip } from '../test-utils/render-snapshot';
import { loadDeckFixture } from '../test-utils/load-fixture';

const FIXTURES = ['empty', 'title-only', 'three-slides'] as const;
const GOLDENS_DIR = join(__dirname, '..', '..', 'test-fixtures', 'visual', 'goldens');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

if (!existsSync(GOLDENS_DIR)) mkdirSync(GOLDENS_DIR, { recursive: true });

describe('built-in themes × reference decks', () => {
  for (const themeId of BUILT_IN_THEMES.map((t) => t.id)) {
    for (const fixture of FIXTURES) {
      it(`${themeId} × ${fixture}`, () => {
        const doc = loadDeckFixture(fixture);
        doc.meta.themeId = themeId;
        doc.themes = BUILT_IN_THEMES;
        const theme = BUILT_IN_THEMES.find((t) => t.id === themeId)!;
        const png = renderDeckThumbStrip(doc, theme);
        const goldenPath = join(GOLDENS_DIR, `${themeId}__${fixture}.png`);
        if (UPDATE || !existsSync(goldenPath)) {
          writeFileSync(goldenPath, png);
          return;
        }
        const golden = readFileSync(goldenPath);
        expect(png.equals(golden)).toBe(true);
      });
    }
  }
});
```

- [ ] **Step 5.8: Generate goldens for the first time**

```bash
UPDATE_SNAPSHOTS=1 pnpm --filter @wafflebase/slides test:visual
```

Expected: 15 .png files written to `test-fixtures/visual/goldens/`. Manually open 2–3 to sanity-check that they look like 5 different themes applied to the deck.

- [ ] **Step 5.9: Run visual test against the new goldens**

```bash
pnpm --filter @wafflebase/slides test:visual
```

Expected: 15 passed.

- [ ] **Step 5.10: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all 748+ tests pass.

- [ ] **Step 5.11: Stage and commit**

```bash
git add \
  packages/slides/src/themes/ \
  packages/slides/src/index.ts \
  packages/slides/src/model/migrate.ts \
  packages/slides/src/test-utils/ \
  packages/slides/test-fixtures/ \
  packages/slides/scripts/ \
  packages/slides/package.json \
  packages/frontend/src/app/slides/yorkie-slides-store.ts
git commit -m "feat(slides): five built-in themes

Ship default-light, default-dark, streamline, focus, material.
default-light reproduces the v1 visual baseline byte-for-byte
(white background, near-black text, blue accent1).

Adds visual snapshot infrastructure under test-fixtures/visual/
with 15 PNG goldens (5 themes × 3 reference decks). Run
'UPDATE_SNAPSHOTS=1 pnpm slides test:visual' to regenerate when
intentionally changing renderer output.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Theme picker side panel

**Goal:** Right-docked side panel showing the five themes with thumbnails. Click a thumbnail → `applyTheme(themeId)` in a single batch. Wired into the slides editor shell.

**Commit message:** `feat(frontend): theme picker side panel`

**Files:**
- Create: `packages/frontend/src/app/slides/theme-panel.tsx`
- Create: `packages/frontend/src/app/slides/theme-thumbnail.tsx` (small SVG-based)
- Modify: `packages/frontend/src/app/slides/editor-shell.tsx`
- Modify: `packages/frontend/src/app/slides/contextual-toolbar.tsx` (add "Theme" button)
- Test: `packages/frontend/tests/app/slides/theme-panel.test.tsx`

- [ ] **Step 6.1: Implement the theme thumbnail component**

Create `packages/frontend/src/app/slides/theme-thumbnail.tsx`:

```typescript
import type { Theme } from '@wafflebase/slides';

type Props = { theme: Theme; selected: boolean; onClick: () => void };

export function ThemeThumbnail({ theme, selected, onClick }: Props) {
  const c = theme.colors;
  return (
    <button
      onClick={onClick}
      aria-label={`Apply ${theme.name} theme`}
      aria-pressed={selected}
      style={{
        border: selected ? `2px solid ${c.accent1}` : '1px solid #ddd',
        borderRadius: 6,
        padding: 4,
        background: c.background,
        width: 160,
        height: 90,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ color: c.text, fontFamily: theme.fonts.heading, fontSize: 18, fontWeight: 600 }}>aA</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6].map((color, i) => (
          <span key={i} style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
        ))}
      </div>
      <div style={{ color: c.textSecondary, fontSize: 11 }}>{theme.name}</div>
    </button>
  );
}
```

- [ ] **Step 6.2: Implement the theme panel**

Create `packages/frontend/src/app/slides/theme-panel.tsx`:

```typescript
import { BUILT_IN_THEMES } from '@wafflebase/slides';
import type { SlidesStore } from '@wafflebase/slides';
import { ThemeThumbnail } from './theme-thumbnail';

type Props = {
  store: SlidesStore;
  currentThemeId: string;
  onClose: () => void;
};

export function ThemePanel({ store, currentThemeId, onClose }: Props) {
  function applyTheme(themeId: string) {
    store.batch(() => {
      const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
      if (theme) store.addTheme(theme); // idempotent — Task 3 added this
      store.applyTheme(themeId);
    });
  }

  return (
    <aside aria-label="Theme picker" style={{ width: 220, padding: 12, borderLeft: '1px solid #eee' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>Theme</h2>
        <button onClick={onClose} aria-label="Close theme picker">×</button>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BUILT_IN_THEMES.map((t) => (
          <ThemeThumbnail
            key={t.id}
            theme={t}
            selected={t.id === currentThemeId}
            onClick={() => applyTheme(t.id)}
          />
        ))}
      </div>
    </aside>
  );
}
```

> **Note:** `addTheme` and `applyTheme` were added to `SlidesStore` in Task 3 step 3.8. Both are wrapped here in a single `store.batch(...)` so the user sees one undo step.

- [ ] **Step 6.3: Add the toggle button to the contextual toolbar**

Modify `packages/frontend/src/app/slides/contextual-toolbar.tsx` (or wherever the top toolbar lives — the survey called it `slides-formatting-toolbar.tsx`). Add a "Theme" button on the right:

```typescript
type Props = { /* existing */; onToggleThemePanel: () => void; themePanelOpen: boolean };

// ... existing buttons ...

<button
  onClick={onToggleThemePanel}
  aria-pressed={themePanelOpen}
  style={{ marginLeft: 'auto' }}
>
  Theme
</button>
```

- [ ] **Step 6.4: Wire panel into editor-shell**

Modify `packages/frontend/src/app/slides/editor-shell.tsx`. Add state for panel visibility and render `<ThemePanel>` when open:

```typescript
import { useState } from 'react';
import { ThemePanel } from './theme-panel';

export function EditorShell({ store /* etc. */ }: Props) {
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const doc = store.read();

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* existing thumbnails + canvas + notes */}
      {themePanelOpen && (
        <ThemePanel
          store={store}
          currentThemeId={doc.meta.themeId}
          onClose={() => setThemePanelOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6.5: Write the theme panel test**

Create `packages/frontend/tests/app/slides/theme-panel.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemePanel } from '../../../src/app/slides/theme-panel';
import { MemSlidesStore } from '@wafflebase/slides';

describe('ThemePanel', () => {
  it('shows five themes', () => {
    const store = new MemSlidesStore();
    const { getAllByRole } = render(
      <ThemePanel store={store} currentThemeId="default-light" onClose={() => {}} />,
    );
    // 5 theme buttons + 1 close button = 6 buttons total
    expect(getAllByRole('button').length).toBe(6);
  });

  it('clicking a theme applies it to the store', () => {
    const store = new MemSlidesStore();
    const { getByLabelText } = render(
      <ThemePanel store={store} currentThemeId="default-light" onClose={() => {}} />,
    );
    fireEvent.click(getByLabelText('Apply Material theme'));
    expect(store.read().meta.themeId).toBe('material');
  });

  it('clicking close fires onClose', () => {
    let closed = false;
    const store = new MemSlidesStore();
    const { getByLabelText } = render(
      <ThemePanel store={store} currentThemeId="default-light" onClose={() => { closed = true; }} />,
    );
    fireEvent.click(getByLabelText('Close theme picker'));
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 6.6: Run frontend tests**

```bash
pnpm --filter @wafflebase/frontend test
```

Expected: existing tests pass + 3 new theme-panel tests.

- [ ] **Step 6.7: Manually browser-smoke**

```bash
pnpm dev
```

Open http://localhost:5173, navigate to a slide deck, click "Theme" in the toolbar, click each theme. Confirm canvas re-renders with the new theme. Refresh the page — theme persists (Yorkie). Open in two browser windows, change theme in one — appears in the other.

- [ ] **Step 6.8: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all tests pass.

- [ ] **Step 6.9: Stage and commit**

```bash
git add \
  packages/slides/src/store/store.ts \
  packages/slides/src/store/memory.ts \
  packages/frontend/src/app/slides/theme-panel.tsx \
  packages/frontend/src/app/slides/theme-thumbnail.tsx \
  packages/frontend/src/app/slides/editor-shell.tsx \
  packages/frontend/src/app/slides/contextual-toolbar.tsx \
  packages/frontend/src/app/slides/yorkie-slides-store.ts \
  packages/frontend/tests/app/slides/theme-panel.test.tsx
git commit -m "feat(frontend): theme picker side panel

Right-docked panel listing the five built-in themes with live
swatches. Clicking a thumbnail batches addTheme + applyTheme so
the change is one undo step. Wired into the slides editor shell
behind a 'Theme' button on the top toolbar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Eleven Google-Slides-parity built-in layouts

**Goal:** `BUILT_IN_LAYOUTS` expands to eleven entries with placeholder positions matching Google Slides' standard layouts. `applyLayout` continues to be additive (only inserts missing placeholders, never overwrites user content). Visual snapshot suite gains 11 layout × 1 deck = 11 goldens.

**Commit message:** `feat(slides): eleven Google-Slides-parity built-in layouts`

**Files:**
- Modify: `packages/slides/src/model/layout.ts`
- Test: `packages/slides/src/model/layout.test.ts`
- Create: `packages/slides/src/model/layouts.visual.test.ts`
- Modify: `packages/slides/test-fixtures/decks/three-slides.json` (use new layout ids)

- [ ] **Step 7.1: Replace `BUILT_IN_LAYOUTS` with eleven layouts**

Modify `packages/slides/src/model/layout.ts`. Each layout adds `masterId`, `staticElements`, and uses the new structure:

```typescript
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { Layout, PlaceholderSpec } from './presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './presentation';

const PADDING = 80;

function emptyBlocks(): Block[] {
  return [{
    id: 'placeholder',
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block];
}

function textPlaceholder(x: number, y: number, w: number, h: number): PlaceholderSpec {
  return {
    type: 'text',
    frame: { x, y, w, h, rotation: 0 },
    data: { blocks: emptyBlocks() },
  };
}

const W = SLIDE_WIDTH - PADDING * 2;
const HALF = (W - PADDING) / 2;

export const BUILT_IN_LAYOUTS: Layout[] = [
  {
    id: 'blank',
    masterId: 'default',
    name: 'Blank',
    placeholders: [],
    staticElements: [],
  },
  {
    id: 'title-slide',
    masterId: 'default',
    name: 'Title slide',
    placeholders: [
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 - 120, W, 160),
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 + 60, W, 80),
    ],
    staticElements: [],
  },
  {
    id: 'section-header',
    masterId: 'default',
    name: 'Section header',
    placeholders: [
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 - 80, W, 200),
    ],
    staticElements: [],
  },
  {
    id: 'title-body',
    masterId: 'default',
    name: 'Title and body',
    placeholders: [
      textPlaceholder(PADDING, PADDING, W, 140),
      textPlaceholder(PADDING, PADDING + 180, W, SLIDE_HEIGHT - PADDING * 2 - 200),
    ],
    staticElements: [],
  },
  {
    id: 'title-two-columns',
    masterId: 'default',
    name: 'Title and two columns',
    placeholders: [
      textPlaceholder(PADDING, PADDING, W, 140),
      textPlaceholder(PADDING, PADDING + 180, HALF, SLIDE_HEIGHT - PADDING * 2 - 200),
      textPlaceholder(PADDING + HALF + PADDING, PADDING + 180, HALF, SLIDE_HEIGHT - PADDING * 2 - 200),
    ],
    staticElements: [],
  },
  {
    id: 'title-only',
    masterId: 'default',
    name: 'Title only',
    placeholders: [
      textPlaceholder(PADDING, PADDING, W, 140),
    ],
    staticElements: [],
  },
  {
    id: 'one-column-text',
    masterId: 'default',
    name: 'One column text',
    placeholders: [
      textPlaceholder(PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2),
    ],
    staticElements: [],
  },
  {
    id: 'main-point',
    masterId: 'default',
    name: 'Main point',
    placeholders: [
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 - 80, W, 160),
    ],
    staticElements: [],
  },
  {
    id: 'section-title-description',
    masterId: 'default',
    name: 'Section title and description',
    placeholders: [
      textPlaceholder(PADDING, PADDING * 2, W, 180),
      textPlaceholder(PADDING, PADDING * 2 + 220, W, SLIDE_HEIGHT - PADDING * 4 - 240),
    ],
    staticElements: [],
  },
  {
    id: 'caption',
    masterId: 'default',
    name: 'Caption',
    placeholders: [
      // image placeholder spans full slide above caption — TextElement placeholder for now
      textPlaceholder(PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2 - 200),
      textPlaceholder(PADDING, SLIDE_HEIGHT - PADDING - 160, W, 120),
    ],
    staticElements: [],
  },
  {
    id: 'big-number',
    masterId: 'default',
    name: 'Big number',
    placeholders: [
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 - 200, W, 280),
      textPlaceholder(PADDING, SLIDE_HEIGHT / 2 + 100, W, 100),
    ],
    staticElements: [],
  },
];

export function getLayout(layoutId: string): Layout {
  return BUILT_IN_LAYOUTS.find((l) => l.id === layoutId) ?? BUILT_IN_LAYOUTS[0];
}
```

- [ ] **Step 7.2: Update layout test**

Create or extend `packages/slides/src/model/layout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BUILT_IN_LAYOUTS, getLayout } from './layout';

describe('BUILT_IN_LAYOUTS', () => {
  it('has eleven entries with the expected ids', () => {
    expect(BUILT_IN_LAYOUTS.map((l) => l.id)).toEqual([
      'blank', 'title-slide', 'section-header', 'title-body',
      'title-two-columns', 'title-only', 'one-column-text', 'main-point',
      'section-title-description', 'caption', 'big-number',
    ]);
  });

  it('every layout has masterId set to "default" in v1', () => {
    for (const l of BUILT_IN_LAYOUTS) {
      expect(l.masterId).toBe('default');
    }
  });

  it('placeholder frames are inside the 1920×1080 canvas', () => {
    for (const l of BUILT_IN_LAYOUTS) {
      for (const p of l.placeholders) {
        expect(p.frame.x).toBeGreaterThanOrEqual(0);
        expect(p.frame.y).toBeGreaterThanOrEqual(0);
        expect(p.frame.x + p.frame.w).toBeLessThanOrEqual(1920);
        expect(p.frame.y + p.frame.h).toBeLessThanOrEqual(1080);
      }
    }
  });
});

describe('getLayout', () => {
  it('returns the requested layout', () => {
    expect(getLayout('main-point').id).toBe('main-point');
  });
  it('falls back to blank for unknown ids', () => {
    expect(getLayout('not-a-layout').id).toBe('blank');
  });
});
```

- [ ] **Step 7.3: Add a layouts visual snapshot test**

Create `packages/slides/src/model/layouts.visual.test.ts`:

```typescript
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_LAYOUTS } from './layout';
import { defaultLight } from '../themes/default-light';
import { renderSlideToPng } from '../test-utils/render-snapshot';
import { DEFAULT_MASTER } from './master';
import { BUILT_IN_THEMES } from '../themes';
import type { SlidesDocument } from './presentation';

const GOLDENS_DIR = join(__dirname, '..', '..', 'test-fixtures', 'visual', 'goldens', 'layouts');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

if (!existsSync(GOLDENS_DIR)) mkdirSync(GOLDENS_DIR, { recursive: true });

describe('built-in layouts × default-light', () => {
  for (const layout of BUILT_IN_LAYOUTS) {
    it(`${layout.id}`, () => {
      const doc: SlidesDocument = {
        meta: { title: 'Layouts', themeId: 'default-light', masterId: 'default' },
        themes: BUILT_IN_THEMES,
        masters: [DEFAULT_MASTER],
        layouts: BUILT_IN_LAYOUTS,
        slides: [{
          id: 's1',
          layoutId: layout.id,
          background: { fill: { kind: 'role', role: 'background' } },
          elements: layout.placeholders.map((p, i) => ({
            id: `e${i}`,
            type: p.type,
            frame: p.frame,
            data: p.data,
          })) as any,
          notes: [],
        }],
      };
      const png = renderSlideToPng(doc.slides[0], doc, defaultLight);
      const goldenPath = join(GOLDENS_DIR, `${layout.id}.png`);
      if (UPDATE || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, png);
      } else {
        const golden = readFileSync(goldenPath);
        if (!png.equals(golden)) throw new Error(`Visual diff for layout ${layout.id}`);
      }
    });
  }
});
```

- [ ] **Step 7.4: Generate layout goldens**

```bash
UPDATE_SNAPSHOTS=1 pnpm --filter @wafflebase/slides test:visual
```

Expected: 15 (themes) + 11 (layouts) = 26 .png files. Inspect 2–3 layout goldens to confirm placeholders are positioned reasonably.

- [ ] **Step 7.5: Run all slides tests**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: existing + 4 new layout unit tests + 11 visual snapshots pass.

- [ ] **Step 7.6: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all tests pass.

- [ ] **Step 7.7: Stage and commit**

```bash
git add \
  packages/slides/src/model/layout.ts \
  packages/slides/src/model/layout.test.ts \
  packages/slides/src/model/layouts.visual.test.ts \
  packages/slides/test-fixtures/visual/goldens/layouts/
git commit -m "feat(slides): eleven Google-Slides-parity built-in layouts

Expand BUILT_IN_LAYOUTS from three to eleven entries:
blank, title-slide, section-header, title-body, title-two-columns,
title-only, one-column-text, main-point, section-title-description,
caption, big-number. Each carries masterId: 'default' and an empty
staticElements array (v1.5 populates).

Existing decks using layoutId 'title' migrate to 'title-slide' on
read (already wired in Task 3). 11 visual goldens added under
test-fixtures/visual/goldens/layouts/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Themed color and font pickers

**Goal:** New color and font picker components that show the active theme's palette / fonts at the top, accept and produce `ThemeColor` / `ThemeFont`. Wired into the slides contextual toolbar for shape and text editing.

**Commit message:** `feat(frontend): themed color picker + themed font picker`

**Files:**
- Create: `packages/frontend/src/app/slides/themed-color-picker.tsx`
- Create: `packages/frontend/src/app/slides/themed-font-picker.tsx`
- Modify: `packages/frontend/src/app/slides/contextual-toolbar.tsx` (or wherever per-element props are surfaced)
- Test: `packages/frontend/tests/app/slides/themed-color-picker.test.tsx`
- Test: `packages/frontend/tests/app/slides/themed-font-picker.test.tsx`

- [ ] **Step 8.1: Implement the themed color picker**

Create `packages/frontend/src/app/slides/themed-color-picker.tsx`:

```typescript
import type { Theme, ThemeColor, ColorRole } from '@wafflebase/slides';

const THEME_ROLES: ColorRole[] = [
  'text', 'background', 'textSecondary', 'backgroundAlt',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hyperlink', 'visitedHyperlink',
];

type Props = {
  value: ThemeColor | undefined;
  theme: Theme;
  onChange: (color: ThemeColor) => void;
};

export function ThemedColorPicker({ value, theme, onChange }: Props) {
  const isRoleSelected = (role: ColorRole) =>
    value?.kind === 'role' && value.role === role;

  return (
    <div role="group" aria-label="Color picker">
      <div style={{ marginBottom: 8 }}>
        <h4 style={{ fontSize: 11, color: '#666', margin: '0 0 4px' }}>Theme</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 24px)', gap: 4 }}>
          {THEME_ROLES.map((role) => (
            <button
              key={role}
              aria-label={role}
              aria-pressed={isRoleSelected(role)}
              onClick={() => onChange({ kind: 'role', role })}
              style={{
                width: 24, height: 24, borderRadius: 4,
                background: theme.colors[role],
                border: isRoleSelected(role) ? '2px solid #1a73e8' : '1px solid #ddd',
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              {isRoleSelected(role) && (
                <span aria-hidden="true" style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, background: '#1a73e8', borderRadius: '50%' }} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 style={{ fontSize: 11, color: '#666', margin: '8px 0 4px' }}>Custom</h4>
        <input
          type="color"
          value={value?.kind === 'srgb' ? value.value : '#000000'}
          onChange={(e) => onChange({ kind: 'srgb', value: e.target.value })}
          aria-label="Custom color"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: Implement the themed font picker**

Create `packages/frontend/src/app/slides/themed-font-picker.tsx`:

```typescript
import type { Theme, ThemeFont } from '@wafflebase/slides';

const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Inter', 'Roboto', 'Lora', 'Times New Roman', 'Georgia', 'Courier New'];

type Props = {
  value: ThemeFont | undefined;
  theme: Theme;
  onChange: (font: ThemeFont) => void;
};

export function ThemedFontPicker({ value, theme, onChange }: Props) {
  const isRoleSelected = (role: 'heading' | 'body') =>
    value?.kind === 'role' && value.role === role;

  return (
    <div role="group" aria-label="Font picker">
      <div style={{ marginBottom: 8 }}>
        <h4 style={{ fontSize: 11, color: '#666', margin: '0 0 4px' }}>Theme fonts</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            aria-label="Heading font"
            aria-pressed={isRoleSelected('heading')}
            onClick={() => onChange({ kind: 'role', role: 'heading' })}
            style={{ fontFamily: theme.fonts.heading, padding: 4, border: isRoleSelected('heading') ? '2px solid #1a73e8' : '1px solid #ddd' }}
          >
            Heading — {theme.fonts.heading}
          </button>
          <button
            aria-label="Body font"
            aria-pressed={isRoleSelected('body')}
            onClick={() => onChange({ kind: 'role', role: 'body' })}
            style={{ fontFamily: theme.fonts.body, padding: 4, border: isRoleSelected('body') ? '2px solid #1a73e8' : '1px solid #ddd' }}
          >
            Body — {theme.fonts.body}
          </button>
        </div>
      </div>
      <div>
        <h4 style={{ fontSize: 11, color: '#666', margin: '8px 0 4px' }}>System fonts</h4>
        <select
          value={value?.kind === 'family' ? value.family : ''}
          onChange={(e) => onChange({ kind: 'family', family: e.target.value })}
          aria-label="System font"
        >
          <option value="">Choose…</option>
          {SYSTEM_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3: Wire pickers into the contextual toolbar**

Modify `packages/frontend/src/app/slides/contextual-toolbar.tsx`. When a shape is selected, replace the existing color picker with `<ThemedColorPicker>`. Pass:

```typescript
<ThemedColorPicker
  value={selectedShape.data.fill}
  theme={getActiveTheme(doc)}
  onChange={(c) => store.batch(() => store.updateElementData(slideId, elementId, { fill: c }))}
/>
```

For text selection, add `<ThemedFontPicker>` at the right side of the toolbar similarly.

> **`getActiveTheme`** is exported from slides in Task 2's `render-context.ts`. Re-export it from `packages/slides/src/index.ts`.

- [ ] **Step 8.4: Write the color picker test**

Create `packages/frontend/tests/app/slides/themed-color-picker.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ThemedColorPicker } from '../../../src/app/slides/themed-color-picker';
import { defaultLight } from '@wafflebase/slides';

describe('ThemedColorPicker', () => {
  it('renders 12 theme swatches and a custom input', () => {
    const { getAllByRole } = render(
      <ThemedColorPicker value={undefined} theme={defaultLight} onChange={() => {}} />,
    );
    // 12 swatches => buttons; 1 input
    expect(getAllByRole('button').length).toBe(12);
  });

  it('clicking a swatch emits a role ThemeColor', () => {
    let received: any = null;
    const { getByLabelText } = render(
      <ThemedColorPicker value={undefined} theme={defaultLight} onChange={(c) => { received = c; }} />,
    );
    fireEvent.click(getByLabelText('accent1'));
    expect(received).toEqual({ kind: 'role', role: 'accent1' });
  });

  it('typing a custom color emits an srgb ThemeColor', () => {
    let received: any = null;
    const { getByLabelText } = render(
      <ThemedColorPicker value={undefined} theme={defaultLight} onChange={(c) => { received = c; }} />,
    );
    fireEvent.change(getByLabelText('Custom color'), { target: { value: '#abcdef' } });
    expect(received).toEqual({ kind: 'srgb', value: '#abcdef' });
  });
});
```

- [ ] **Step 8.5: Write the font picker test**

Create `packages/frontend/tests/app/slides/themed-font-picker.test.tsx` (same shape as the color picker test — assert role buttons and system select).

- [ ] **Step 8.6: Run frontend tests**

```bash
pnpm --filter @wafflebase/frontend test
```

Expected: existing tests pass + new picker tests.

- [ ] **Step 8.7: Manually browser-smoke**

```bash
pnpm dev
```

- Insert a shape on a slide. Click the color swatch in the contextual toolbar. Pick `accent1` from the theme row. Confirm the shape uses the theme's accent1 color.
- Switch the theme via Task 6's panel. Confirm the shape's color updates to the new theme's accent1.
- Switch back. Confirm the swatch shows the active role indicator (small dot).
- Insert a text element. Click the font selector. Pick "Heading — Inter". Type something. Confirm it's the heading font.

- [ ] **Step 8.8: Run pnpm verify:fast**

```bash
pnpm verify:fast
```

Expected: all tests pass.

- [ ] **Step 8.9: Stage and commit**

```bash
git add \
  packages/frontend/src/app/slides/themed-color-picker.tsx \
  packages/frontend/src/app/slides/themed-font-picker.tsx \
  packages/frontend/src/app/slides/contextual-toolbar.tsx \
  packages/frontend/tests/app/slides/themed-color-picker.test.tsx \
  packages/frontend/tests/app/slides/themed-font-picker.test.tsx \
  packages/slides/src/index.ts
git commit -m "feat(frontend): themed color picker + themed font picker

Color picker top row shows the active theme's twelve swatches; click
emits { kind: 'role' }. Custom input emits { kind: 'srgb' }.
Selected role swatches carry a small marker so users can tell role-
bound colors from concrete ones at a glance.

Font picker has a 'Theme fonts' section with the heading and body
families rendered in their own typeface, plus a system font dropdown
for { kind: 'family' }.

Wired into the slides contextual toolbar for shape fill, shape stroke,
and text inline color/font.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## End-of-PR1 verification

- [ ] **Step 9.1: Run the full verification suite**

```bash
pnpm verify:fast
pnpm --filter @wafflebase/slides test:visual
pnpm verify:integration  # requires docker compose up -d (Postgres + Yorkie)
```

Expected: all green. 26 visual goldens (15 themes + 11 layouts) match.

- [ ] **Step 9.2: Visual diff on existing v1 deck regression set**

Open three pre-PR1 demo decks (use the seed data on a fresh local DB or the design-doc fixtures). Compare side-by-side with a `git stash`'d copy at the previous commit. Expected: pixel-identical under `default-light`.

- [ ] **Step 9.3: PDF export sanity check**

(If PDF export is wired up at this point — Task 5b-3 in the broader slides plan. If not yet implemented, skip.) Export a deck under each of the five themes; confirm the PDF visually matches the canvas.

- [ ] **Step 9.4: Update task index**

```bash
pnpm tasks:index
```

- [ ] **Step 9.5: Open the PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Slides PR1: Themed authoring (theme + 11 layouts + themed pickers)" --body "$(cat <<'EOF'
## Summary

PR1 of three for the slides v0.5 themes + layouts + PPTX import work
(see [docs/design/slides/slides-themes-layouts-import.md](docs/design/slides/slides-themes-layouts-import.md)).

This lands the **Themed authoring** value unit: theme switching,
eleven Google-Slides-parity built-in layouts, and themed color/font
pickers. New decks become noticeably better; existing v1 decks render
byte-for-byte identically under the default-light theme.

## What's in this PR (eight commits)

1. Theme/Master/Layout types and resolve fns
2. Renderer reads through resolveColor/resolveFont
3. Yorkie schema + read-time migration
4. (docs) Extend Inline.style.color to ThemeColor
5. Five built-in themes
6. Theme picker side panel
7. Eleven Google-Slides-parity built-in layouts
8. Themed color + font pickers

The first commit is **intentionally** not green — it lands the type
widening; commits 2–4 close the loop and produce a green build. Bisect
to commit 2 if you need a green starting point.

## Test plan

- [ ] `pnpm verify:fast` — green
- [ ] `pnpm slides test:visual` — 26 goldens match
- [ ] Browser smoke: switch theme on a deck, see canvas update
- [ ] Browser smoke: insert shape, pick `accent1`, switch theme — color follows
- [ ] Browser smoke: existing v1 deck looks identical to main

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- All file paths are absolute under repo root.
- Every test code block runs against existing slides/docs Vitest patterns.
- TS dependency cycle between Tasks 1↔3↔5 (around `defaultLight`) is resolved with an inline placeholder pattern that swaps to the real export in Task 5.
- Task 1 ends in an intermediate state (TS errors in renderer/store). This is **deliberate** and called out in the commit body. Task 2 closes the loop.
- The `colorResolver` parameter added in Task 4 to docs's `computeLayout` / `paintLayout` is the single integration point that lets slides supply theme-aware color resolution without docs depending on `@wafflebase/slides`.
- Visual goldens are PNG byte-compared (no fuzzy threshold). Renderer changes that intentionally alter pixels require `UPDATE_SNAPSHOTS=1`. This is documented in commit 5's body.
- Master is a single canonical `'default'` master in v1; Task 5 (theme builder) of the **broader** plan would let users edit it.
