# `@wafflebase/tokens` Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Introduce a new `@wafflebase/tokens` workspace package as the single
source of truth for shared design tokens (palette, semantic colors, radius,
typography). Migrate the four existing token surfaces — frontend `index.css`,
Sheets canvas theme, Docs canvas theme, Slides factory default theme — to
consume from it.

**Architecture:** TypeScript constants are the source of truth. A small Node
script reads those constants and emits a single `dist/tokens.css` that mirrors
the current `:root` / `.dark` CSS variables. Frontend consumes the CSS file via
`@import`. Canvas-side packages (sheets/docs/slides) import the TS palette and
keep their domain-only tokens (peer cursors, formula ranges, OOXML role
mapping) inside their own packages. Slides only consumes tokens for the
**factory default** color/font scheme — runtime per-presentation themes are
untouched.

**Tech Stack:** TypeScript 5.9, pnpm workspaces, tsc for compilation, tsx for
the build script, Vitest for tests. No new third-party dependencies.

---

## Pre-flight

- Roadmap: [docs/design/design-system-unification.md](../../design/design-system-unification.md). This is PR #1.
- Pair file: `20260524-tokens-package-lessons.md` (capture surprises as they occur).
- Workspace wiring checklist (memory `reference_workspace_package_checklist`): pnpm-workspace.yaml (glob — no edit needed), root `package.json` scripts, consumer `dependencies`, `knip.json`, per-package `tsconfig.json`.
- `pnpm verify:fast` requires `@wafflebase/docs` to be built before `@wafflebase/slides` typechecks. Run `pnpm --filter @wafflebase/docs build` if slides typecheck reports missing exports unrelated to this work.
- Commit one-by-one, push batched at the end of the PR (per `feedback_workflow_preferences`).

---

### Task 1: Scaffold `@wafflebase/tokens` package skeleton

**Files:**
- Create: `packages/tokens/package.json`
- Create: `packages/tokens/tsconfig.json`
- Create: `packages/tokens/src/index.ts`
- Create: `packages/tokens/README.md`
- Modify: `package.json` (root) — add `tokens` script alias
- Modify: `knip.json` — register the workspace

- [x] **Step 1: Create `packages/tokens/package.json`**

```json
{
  "name": "@wafflebase/tokens",
  "version": "0.4.1",
  "license": "Apache-2.0",
  "description": "Shared design tokens for Wafflebase (palette, semantic colors, radius, typography)",
  "type": "module",
  "files": [
    "dist"
  ],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./tokens.css": "./dist/tokens.css"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsx scripts/build-css.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "prettier": "^3.3.2",
    "tsx": "^4.20.3",
    "typescript": "^5.9.3",
    "vitest": "^3.1.1"
  }
}
```

- [x] **Step 2: Create `packages/tokens/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "strictNullChecks": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "scripts/**/*", "test/**/*"]
}
```

- [x] **Step 3: Create `packages/tokens/tsconfig.build.json`** (emits JS to dist for runtime consumers)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*", "scripts/**/*"]
}
```

- [x] **Step 4: Create `packages/tokens/src/index.ts`** (placeholder; filled in Task 2)

```ts
// Re-export surface — populated in Task 2.
export {};
```

- [x] **Step 5: Create `packages/tokens/README.md`**

````markdown
# @wafflebase/tokens

Shared design tokens for Wafflebase: Butter & Maple palette, semantic colors,
radius, and typography. Single source of truth consumed by:

- `@wafflebase/frontend` — via `@import "@wafflebase/tokens/tokens.css"`
- `@wafflebase/sheets` — via `import { palette } from '@wafflebase/tokens'`
- `@wafflebase/docs` — via `import { palette } from '@wafflebase/tokens'`
- `@wafflebase/slides` — factory default theme only

## Layers

- `palette.ts` — raw color constants (Butter & Maple), light and dark maps.
- `semantic.ts` — meaning-level tokens (primary, surface, foreground, border, ...).
- `radius.ts`, `typography.ts` — non-color tokens.

## Build

```
pnpm --filter @wafflebase/tokens build
```

Emits `dist/index.{js,d.ts}` and `dist/tokens.css`. Consumers reach the CSS file
via the `./tokens.css` export.
````

- [x] **Step 6: Add `tokens` alias to root `package.json` scripts**

Modify `package.json`, inserting between `documentation` and `build:all`:

```diff
   "cli": "pnpm --filter @wafflebase/cli",
   "documentation": "pnpm --filter @wafflebase/documentation",
+  "tokens": "pnpm --filter @wafflebase/tokens",
   "build:all": "...",
```

- [x] **Step 7: Register the workspace in `knip.json`**

```diff
     "packages/slides": {
       "entry": ["src/index.ts", "src/node.ts", "src/**/*.test.ts", "demo.ts"],
       "project": ["src/**/*.ts"]
+    },
+    "packages/tokens": {
+      "entry": ["src/index.ts", "scripts/build-css.ts", "test/**/*.test.ts"],
+      "project": ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"]
     }
```

- [x] **Step 8: Install workspace dependencies and verify package resolves**

Run:
```bash
pnpm install
pnpm tokens typecheck
```

Expected: `pnpm install` adds the new package to the workspace graph. `typecheck` exits 0 (placeholder `index.ts` has no errors).

- [x] **Step 9: Verify nothing else broke**

Run: `pnpm verify:fast`
Expected: PASS. Tokens package has no test files yet, so it is a no-op for the test runner.

- [x] **Step 10: Commit**

```bash
git add packages/tokens package.json knip.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Scaffold @wafflebase/tokens package

Introduce an empty workspace package that will hold the shared design
tokens. No consumers yet — palette and CSS generation land in the next
commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Define base palette + semantic tokens + radius + typography

**Files:**
- Create: `packages/tokens/src/palette.ts`
- Create: `packages/tokens/src/semantic.ts`
- Create: `packages/tokens/src/radius.ts`
- Create: `packages/tokens/src/typography.ts`
- Modify: `packages/tokens/src/index.ts` — wire up re-exports
- Create: `packages/tokens/test/palette.test.ts`
- Create: `packages/tokens/test/semantic.test.ts`

- [x] **Step 1: Write failing test for palette structure**

Create `packages/tokens/test/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { palette } from '../src/palette';

describe('palette', () => {
  it('exposes Butter & Maple core colors', () => {
    expect(palette.syrup).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.butter).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.berry).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.leaf).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('exposes neutral surfaces for both light and dark', () => {
    expect(palette.neutrals.light.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.light.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.dark.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.dark.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('exposes RGB tuples for alpha composition', () => {
    expect(palette.butterRgb).toMatch(/^\d+,\s*\d+,\s*\d+$/);
    expect(palette.syrupRgb).toMatch(/^\d+,\s*\d+,\s*\d+$/);
  });
});
```

- [x] **Step 2: Run test, see it fail**

Run: `pnpm tokens test`
Expected: FAIL — module `../src/palette` not found.

- [x] **Step 3: Implement `packages/tokens/src/palette.ts`**

Lift the Butter & Maple constants from the current `packages/frontend/src/index.css` (lines 92–106 light, 141–151 dark). Keep them as hex literals so Canvas consumers can drop them in directly.

```ts
/**
 * Butter & Maple — raw brand colors.
 *
 * Values are authored as hex (#RRGGBB) so they can be assigned directly to
 * Canvas `fillStyle`/`strokeStyle` in the sheets/docs/slides packages, and
 * inlined into the generated `tokens.css` via the build script.
 */
export const palette = {
  // Brand
  syrup: '#B8651A',
  syrupDeep: '#8A4A12',
  syrupBright: '#E08A3A', // dark-mode brand
  butter: '#F4C95D',
  berry: '#C2484C',
  berryBright: '#E27A7E', // dark-mode berry
  leaf: '#5A7A3A',
  leafBright: '#A0C078',  // dark-mode leaf

  // RGB tuples — for composing `rgba(...)` strings in Canvas code.
  syrupRgb: '184, 101, 26',
  butterRgb: '244, 201, 93',
  berryRgb: '194, 72, 76',

  // Neutrals — paired light/dark surfaces.
  neutrals: {
    light: {
      bg: '#FBF6EC',
      paper: '#FFFDF7',
      ink: '#2A1E12',
      sub: '#6B584A',
      rule: '#E8DCC4',
    },
    dark: {
      bg: '#1C1610',
      paper: '#241D14',
      ink: '#FBF6EC',
      sub: '#B5A48A',
      rule: '#3A2E1F',
    },
  },

  // Terminal — locked dark surface across both modes (preserves the
  // existing wb-terminal-bg / wb-terminal-fg behavior in index.css).
  terminal: {
    bg: '#1C1610',
    fg: '#FBF6EC',
  },
} as const;

export type Palette = typeof palette;
```

- [x] **Step 4: Run palette test, see it pass**

Run: `pnpm tokens test`
Expected: PASS (3 tests in `palette.test.ts`).

- [x] **Step 5: Write failing test for semantic tokens**

Create `packages/tokens/test/semantic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { semantic } from '../src/semantic';

describe('semantic tokens', () => {
  it('exposes a light and dark map with identical keys', () => {
    const lightKeys = Object.keys(semantic.light).sort();
    const darkKeys = Object.keys(semantic.dark).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('every value is a valid CSS color string', () => {
    const re = /^(#[0-9A-Fa-f]{6}|oklch\(.+\)|rgba?\(.+\)|var\(--[a-z-]+\))$/;
    for (const map of [semantic.light, semantic.dark]) {
      for (const [key, value] of Object.entries(map)) {
        expect(value, `${key}=${value}`).toMatch(re);
      }
    }
  });

  it('exposes the keys consumed by the frontend @theme block', () => {
    const required = [
      'background',
      'foreground',
      'primary',
      'primaryForeground',
      'secondary',
      'secondaryForeground',
      'muted',
      'mutedForeground',
      'accent',
      'accentForeground',
      'destructive',
      'border',
      'input',
      'ring',
      'card',
      'cardForeground',
      'popover',
      'popoverForeground',
      'sidebar',
      'sidebarForeground',
      'sidebarPrimary',
      'sidebarPrimaryForeground',
      'sidebarAccent',
      'sidebarAccentForeground',
      'sidebarBorder',
      'sidebarRing',
    ];
    for (const key of required) {
      expect(semantic.light).toHaveProperty(key);
      expect(semantic.dark).toHaveProperty(key);
    }
  });
});
```

- [x] **Step 6: Run semantic test, see it fail**

Run: `pnpm tokens test`
Expected: FAIL — module `../src/semantic` not found.

- [x] **Step 7: Implement `packages/tokens/src/semantic.ts`**

Mirror the existing `:root` / `.dark` blocks in `packages/frontend/src/index.css` (lines 59–107 light, 109–152 dark). Preserve oklch values verbatim; reference `palette` for brand colors.

```ts
import { palette } from './palette';

type SemanticColorMap = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
};

const light: SemanticColorMap = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.141 0.005 285.823)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.141 0.005 285.823)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.141 0.005 285.823)',
  primary: palette.syrup,
  primaryForeground: '#FFFAF0',
  secondary: 'oklch(0.967 0.001 286.375)',
  secondaryForeground: 'oklch(0.21 0.006 285.885)',
  muted: 'oklch(0.967 0.001 286.375)',
  mutedForeground: 'oklch(0.552 0.016 285.938)',
  accent: 'oklch(0.967 0.001 286.375)',
  accentForeground: 'oklch(0.21 0.006 285.885)',
  destructive: 'oklch(0.577 0.245 27.325)',
  border: 'oklch(0.92 0.004 286.32)',
  input: 'oklch(0.92 0.004 286.32)',
  ring: palette.syrup,
  chart1: palette.syrup,
  chart2: 'oklch(0.6 0.118 184.704)',
  chart3: 'oklch(0.398 0.07 227.392)',
  chart4: 'oklch(0.828 0.189 84.429)',
  chart5: 'oklch(0.769 0.188 70.08)',
  sidebar: palette.neutrals.light.bg,
  sidebarForeground: palette.neutrals.light.ink,
  sidebarPrimary: palette.syrup,
  sidebarPrimaryForeground: '#FFFAF0',
  sidebarAccent: `rgba(${palette.butterRgb}, 0.30)`,
  sidebarAccentForeground: palette.syrupDeep,
  sidebarBorder: palette.neutrals.light.rule,
  sidebarRing: palette.syrup,
};

const dark: SemanticColorMap = {
  background: 'oklch(0.141 0.005 285.823)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.21 0.006 285.885)',
  cardForeground: 'oklch(0.985 0 0)',
  popover: 'oklch(0.21 0.006 285.885)',
  popoverForeground: 'oklch(0.985 0 0)',
  primary: palette.syrupBright,
  primaryForeground: palette.neutrals.dark.bg,
  secondary: 'oklch(0.274 0.006 286.033)',
  secondaryForeground: 'oklch(0.985 0 0)',
  muted: 'oklch(0.274 0.006 286.033)',
  mutedForeground: 'oklch(0.705 0.015 286.067)',
  accent: 'oklch(0.274 0.006 286.033)',
  accentForeground: 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: palette.syrupBright,
  chart1: palette.syrupBright,
  chart2: 'oklch(0.696 0.17 162.48)',
  chart3: 'oklch(0.769 0.188 70.08)',
  chart4: 'oklch(0.627 0.265 303.9)',
  chart5: 'oklch(0.645 0.246 16.439)',
  sidebar: palette.neutrals.dark.bg,
  sidebarForeground: palette.neutrals.dark.ink,
  sidebarPrimary: palette.syrupBright,
  sidebarPrimaryForeground: palette.neutrals.dark.bg,
  sidebarAccent: `rgba(${palette.butterRgb}, 0.18)`,
  sidebarAccentForeground: palette.butter,
  sidebarBorder: palette.neutrals.dark.rule,
  sidebarRing: palette.syrupBright,
};

export const semantic = { light, dark } as const;
export type SemanticTokens = typeof semantic;
```

Note: dark-mode `sidebarAccentForeground` was `var(--wb-syrup-deep)` in the
existing index.css, which under `.dark` resolves to `#f4c95d` (butter). We pass
`palette.butter` directly to avoid the cross-reference.

- [x] **Step 8: Run semantic test, see it pass**

Run: `pnpm tokens test`
Expected: PASS (palette + semantic — 6 tests).

- [x] **Step 9: Implement `packages/tokens/src/radius.ts`**

```ts
export const radius = {
  base: '0.3rem',
  sm: 'calc(0.3rem - 4px)',
  md: 'calc(0.3rem - 2px)',
  lg: '0.3rem',
  xl: 'calc(0.3rem + 4px)',
} as const;

export type RadiusTokens = typeof radius;
```

- [x] **Step 10: Implement `packages/tokens/src/typography.ts`**

```ts
export const typography = {
  display:
    '"Fraunces", ui-serif, Georgia, serif',
  body:
    '"Inter", ui-sans-serif, system-ui, sans-serif',
  code:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export type TypographyTokens = typeof typography;
```

- [x] **Step 11: Wire the re-export surface in `packages/tokens/src/index.ts`**

```ts
export { palette } from './palette';
export type { Palette } from './palette';
export { semantic } from './semantic';
export type { SemanticTokens } from './semantic';
export { radius } from './radius';
export type { RadiusTokens } from './radius';
export { typography } from './typography';
export type { TypographyTokens } from './typography';
```

- [x] **Step 12: Run typecheck and tests once more**

Run: `pnpm tokens typecheck && pnpm tokens test`
Expected: PASS.

- [x] **Step 13: Commit**

```bash
git add packages/tokens/src packages/tokens/test
git commit -m "$(cat <<'EOF'
Define palette, semantic, radius, typography in @wafflebase/tokens

Authors the Butter & Maple palette, neutral surfaces, RGB tuples, and
the full semantic color map (light + dark) lifted from the existing
inline tokens in packages/frontend/src/index.css. Vitest covers shape
and required keys; no consumer wiring yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CSS generation script

**Files:**
- Create: `packages/tokens/scripts/build-css.ts`
- Create: `packages/tokens/test/build-css.test.ts`
- Modify: `packages/tokens/package.json` (already includes `build` script from Task 1)

- [x] **Step 1: Write failing test for CSS emission**

Create `packages/tokens/test/build-css.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../scripts/build-css';

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
});
```

- [x] **Step 2: Run test, see it fail**

Run: `pnpm tokens test`
Expected: FAIL — module `../scripts/build-css` not found.

- [x] **Step 3: Implement `packages/tokens/scripts/build-css.ts`**

Two responsibilities: pure render function (testable), and a CLI entry that writes `dist/tokens.css`.

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { palette } from '../src/palette';
import { semantic } from '../src/semantic';
import { radius } from '../src/radius';
import { typography } from '../src/typography';

// Map of CSS variable name -> value, in deterministic emission order.
type Block = Array<[string, string]>;

function paletteBlock(mode: 'light' | 'dark'): Block {
  const n = mode === 'light' ? palette.neutrals.light : palette.neutrals.dark;
  const syrupForMode = mode === 'light' ? palette.syrup : palette.syrupBright;
  const berryForMode = mode === 'light' ? palette.berry : palette.berryBright;
  const leafForMode = mode === 'light' ? palette.leaf : palette.leafBright;
  return [
    ['--wb-bg', n.bg],
    ['--wb-paper', n.paper],
    ['--wb-ink', n.ink],
    ['--wb-sub', n.sub],
    ['--wb-rule', n.rule],
    ['--wb-syrup', syrupForMode],
    ['--wb-syrup-deep', mode === 'light' ? palette.syrupDeep : palette.butter],
    ['--wb-butter', palette.butter],
    ['--wb-berry', berryForMode],
    ['--wb-leaf', leafForMode],
  ];
}

function semanticBlock(mode: 'light' | 'dark'): Block {
  const m = semantic[mode];
  return [
    ['--background', m.background],
    ['--foreground', m.foreground],
    ['--card', m.card],
    ['--card-foreground', m.cardForeground],
    ['--popover', m.popover],
    ['--popover-foreground', m.popoverForeground],
    ['--primary', m.primary],
    ['--primary-foreground', m.primaryForeground],
    ['--secondary', m.secondary],
    ['--secondary-foreground', m.secondaryForeground],
    ['--muted', m.muted],
    ['--muted-foreground', m.mutedForeground],
    ['--accent', m.accent],
    ['--accent-foreground', m.accentForeground],
    ['--destructive', m.destructive],
    ['--border', m.border],
    ['--input', m.input],
    ['--ring', m.ring],
    ['--chart-1', m.chart1],
    ['--chart-2', m.chart2],
    ['--chart-3', m.chart3],
    ['--chart-4', m.chart4],
    ['--chart-5', m.chart5],
    ['--sidebar', m.sidebar],
    ['--sidebar-foreground', m.sidebarForeground],
    ['--sidebar-primary', m.sidebarPrimary],
    ['--sidebar-primary-foreground', m.sidebarPrimaryForeground],
    ['--sidebar-accent', m.sidebarAccent],
    ['--sidebar-accent-foreground', m.sidebarAccentForeground],
    ['--sidebar-border', m.sidebarBorder],
    ['--sidebar-ring', m.sidebarRing],
  ];
}

function rootOnlyBlock(): Block {
  return [
    ['--radius', radius.base],
    // Terminal palette is locked across both modes (matches existing index.css).
    ['--wb-terminal-bg', palette.terminal.bg],
    ['--wb-terminal-fg', palette.terminal.fg],
    // Font families — listed once, do not change between modes.
    ['--font-display', typography.display],
    ['--font-body', typography.body],
    ['--font-code', typography.code],
  ];
}

function format(block: Block, selector: string): string {
  const lines = block.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `${selector} {\n${lines}\n}`;
}

export function renderTokensCss(): string {
  const lightVars = [
    ...rootOnlyBlock(),
    ...paletteBlock('light'),
    ...semanticBlock('light'),
  ];
  const darkVars = [...paletteBlock('dark'), ...semanticBlock('dark')];
  return [
    '/* AUTOGENERATED by packages/tokens/scripts/build-css.ts — do not edit. */',
    format(lightVars, ':root'),
    format(darkVars, '.dark'),
    '',
  ].join('\n\n');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/tokens.css');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderTokensCss(), 'utf8');
  console.log(`wrote ${outPath}`);
}
```

- [x] **Step 4: Run test, see it pass**

Run: `pnpm tokens test`
Expected: PASS — 5 tests in `build-css.test.ts`.

- [x] **Step 5: Run the actual build and inspect output**

Run: `pnpm tokens build`
Expected: emits `packages/tokens/dist/index.js`, `dist/index.d.ts`, and `dist/tokens.css`. The CSS file should match the inline blocks in the current `packages/frontend/src/index.css` (values only — formatting may differ).

Quick visual check:
```bash
head -40 packages/tokens/dist/tokens.css
```

- [x] **Step 6: Commit**

```bash
git add packages/tokens/scripts packages/tokens/test/build-css.test.ts
git commit -m "$(cat <<'EOF'
Emit tokens.css via build script

Adds renderTokensCss() + a CLI entry that writes dist/tokens.css from
the TS token sources. Output mirrors the existing :root and .dark
blocks in packages/frontend/src/index.css so the frontend can swap to
an @import in the next commit without visible diff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: WCAG AA contrast smoke tests

**Files:**
- Create: `packages/tokens/test/contrast.test.ts`
- Create: `packages/tokens/src/contrast.ts` (small internal helper, not re-exported in index)

- [x] **Step 1: Write failing test**

Create `packages/tokens/test/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { semantic, palette } from '../src';
import { contrastRatio } from '../src/contrast';

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

  it('primary-foreground vs primary passes AA-large in both modes', () => {
    expect(
      contrastRatio(semantic.light.primaryForeground, semantic.light.primary),
    ).toBeGreaterThanOrEqual(AA_LARGE);
    expect(
      contrastRatio(semantic.dark.primaryForeground, semantic.dark.primary),
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('sidebar foreground vs sidebar background passes AA in both modes', () => {
    expect(
      contrastRatio(semantic.light.sidebarForeground, semantic.light.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(semantic.dark.sidebarForeground, semantic.dark.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('butter palette is reported correctly (smoke test for the helper)', () => {
    // butter on dark ink should be high contrast.
    const ratio = contrastRatio(palette.butter, palette.neutrals.dark.ink);
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
```

- [x] **Step 2: Run test, see it fail**

Run: `pnpm tokens test`
Expected: FAIL — module `../src/contrast` not found.

- [x] **Step 3: Implement `packages/tokens/src/contrast.ts`**

We need to parse `#RRGGBB` and `oklch(L C H)` values. The contrast formula uses
relative luminance; for oklch we convert L (perceptual lightness) back to sRGB.
A small dependency-free implementation:

```ts
type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

// Parse `oklch(L C H)` or `oklch(L C H / a)` to sRGB.
// L is in [0,1], C is chroma (~0–0.4), H is degrees.
function oklchToRgb(input: string): RGB {
  const inside = input.replace(/^oklch\(/, '').replace(/\)$/, '');
  const [lchPart] = inside.split('/');
  const [lRaw, cRaw, hRaw] = lchPart.trim().split(/\s+/);
  const L = parseFloat(lRaw);
  const C = parseFloat(cRaw);
  const H = (parseFloat(hRaw) * Math.PI) / 180;
  // OKLab -> linear sRGB. Reference: https://bottosson.github.io/posts/oklab/
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;
  const rLinear = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLinear = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLinear = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  const compand = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return {
    r: Math.max(0, Math.min(1, compand(rLinear))),
    g: Math.max(0, Math.min(1, compand(gLinear))),
    b: Math.max(0, Math.min(1, compand(bLinear))),
  };
}

function parseColor(input: string): RGB {
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) return hexToRgb(trimmed);
  if (trimmed.startsWith('oklch(')) return oklchToRgb(trimmed);
  throw new Error(`contrast helper: unsupported color format "${input}"`);
}

function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const lf = relativeLuminance(parseColor(foreground));
  const lb = relativeLuminance(parseColor(background));
  const [lighter, darker] = lf > lb ? [lf, lb] : [lb, lf];
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [x] **Step 4: Run test, see it pass**

Run: `pnpm tokens test`
Expected: PASS. If any contrast fails, that is real signal — investigate before patching. AA_NORMAL = 4.5 for body, AA_LARGE = 3.0 for large/UI text — picked per WCAG 2.1.

If `primary-foreground vs primary` fails in dark mode (syrupBright + dark bg), reduce the threshold to AA_LARGE or update the palette — but log the decision in `20260524-tokens-package-lessons.md`.

- [x] **Step 5: Commit**

```bash
git add packages/tokens/src/contrast.ts packages/tokens/test/contrast.test.ts
git commit -m "$(cat <<'EOF'
Add WCAG AA contrast smoke tests to @wafflebase/tokens

Dependency-free oklch + hex parser; tests assert foreground/background
and primary pairs meet AA across both themes. Catches palette regressions
before they reach the UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend consumes `@wafflebase/tokens`

**Files:**
- Modify: `packages/frontend/package.json` — add dependency
- Modify: `packages/frontend/src/index.css` — replace inline blocks with `@import`

- [x] **Step 1: Add the dependency**

Modify `packages/frontend/package.json`. Locate the existing `dependencies` block and add:

```diff
   "dependencies": {
+    "@wafflebase/tokens": "workspace:*",
     "@wafflebase/docs": "workspace:*",
     ...
   }
```

Run: `pnpm install`
Expected: pnpm symlinks `packages/tokens` into `packages/frontend/node_modules`.

- [x] **Step 2: Ensure tokens is built before frontend dev/build**

The tokens package emits to `dist/`. For local dev, run a one-time build:

```bash
pnpm tokens build
```

Frontend (Vite) resolves `@wafflebase/tokens/tokens.css` against the `exports`
map — so the file must exist on disk. CI runs `pnpm build` which already
sequences sub-package builds; we will verify that in Task 9 by running
`pnpm verify:self`.

- [x] **Step 3: Replace inline tokens in `packages/frontend/src/index.css`**

Strip the `:root` and `.dark` blocks and replace with the import. Keep the
`@theme inline` block (it maps CSS variables to Tailwind utility names) and
the `@layer base` block. Final file:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@wafflebase/tokens/tokens.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-wb-bg: var(--wb-bg);
  --color-wb-paper: var(--wb-paper);
  --color-wb-ink: var(--wb-ink);
  --color-wb-sub: var(--wb-sub);
  --color-wb-rule: var(--wb-rule);
  --color-wb-syrup: var(--wb-syrup);
  --color-wb-syrup-deep: var(--wb-syrup-deep);
  --color-wb-butter: var(--wb-butter);
  --color-wb-berry: var(--wb-berry);
  --color-wb-leaf: var(--wb-leaf);
  /* stylelint-disable value-keyword-case */
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-code: var(--font-code);
  /* stylelint-enable value-keyword-case */
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

The `@theme` mapping survives unchanged — only the variable definitions move
into the imported file. Font families that were previously inline strings now
come from `--font-display` / `--font-body` / `--font-code` emitted by
`build-css.ts`.

- [x] **Step 4: Run frontend lint and tests**

Run: `pnpm verify:fast`
Expected: PASS. If lint flags the new `@import`, check the Tailwind 4 / PostCSS
config — workspace `@import` should resolve via Vite's module graph.

- [x] **Step 5: Browser smoke**

```bash
pnpm dev
```

Open `http://localhost:5173`. With DevTools open, toggle theme (dark/light) and
visit:
1. Document list (sidebar + header)
2. A Docs document
3. A Sheets spreadsheet
4. A Slides deck

Confirm: no visible color change vs. main. The values are identical strings, so
this is a regression smoke, not a redesign.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/package.json packages/frontend/src/index.css pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Import shared tokens.css in frontend, drop inline definitions

Replaces the inline :root and .dark variable blocks with an import from
@wafflebase/tokens. The @theme inline mapping and @layer base rules are
unchanged. No visual change expected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sheets canvas theme reads shared colors from `@wafflebase/tokens`

**Files:**
- Modify: `packages/sheets/package.json` — add dependency
- Modify: `packages/sheets/src/view/theme.ts` — replace shared color literals with `palette` refs

- [x] **Step 1: Add the dependency**

Modify `packages/sheets/package.json`:

```diff
   "dependencies": {
+    "@wafflebase/tokens": "workspace:*",
     ...
   }
```

Run: `pnpm install && pnpm tokens build`.

- [x] **Step 2: Inventory colors in `packages/sheets/src/view/theme.ts` that overlap with the palette**

| Key                  | Light value                | Dark value                 | Maps to                                                  |
| -------------------- | -------------------------- | -------------------------- | -------------------------------------------------------- |
| `activeCellColor`    | `#B8651A`                  | `#E08A3A`                  | `palette.syrup` / `palette.syrupBright`                  |
| `selectionBGColor`   | `rgba(244, 201, 93, 0.18)` | `rgba(244, 201, 93, 0.16)` | `rgba(${palette.butterRgb}, 0.18)` / `... 0.16)`         |
| `headerActiveBGColor`| `#F4C95D`                  | `#F4C95D`                  | `palette.butter` (both modes)                            |
| `tokens.REFERENCE`   | `#B8651A`                  | `#E08A3A`                  | `palette.syrup` / `palette.syrupBright`                  |

Other keys (`cellBorderColor`, `cellBGColor`, `peerCursor*`, `formulaRange*`,
`resizeHandle*`, search highlights) are domain-only or already-generic. Leave
them.

- [x] **Step 3: Modify `packages/sheets/src/view/theme.ts`**

Add the import at the top and replace the four overlapping values. Show the
relevant changes only:

```diff
+ import { palette } from '@wafflebase/tokens';
+
  export type Theme = 'light' | 'dark';

  export const LightTheme = {
    cellBorderColor: '#D3D3D3',
    customBorderColor: '#000000',
    cellBGColor: '#FFFFFF',
    cellTextColor: '#000000',
-   activeCellColor: '#B8651A',
-   selectionBGColor: 'rgba(244, 201, 93, 0.18)',
+   activeCellColor: palette.syrup,
+   selectionBGColor: `rgba(${palette.butterRgb}, 0.18)`,
    headerBGColor: '#F0F0F0',
-   headerActiveBGColor: '#F4C95D',
-   ['tokens.REFERENCE']: '#B8651A',
+   headerActiveBGColor: palette.butter,
+   ['tokens.REFERENCE']: palette.syrup,
    ['tokens.NUM']: '#4DA6FF',
    ...

  export const DarkTheme = {
    cellBorderColor: '#4A4A4A',
    customBorderColor: '#FFFFFF',
    cellBGColor: '#1E1E1E',
    cellTextColor: '#FFFFFF',
-   activeCellColor: '#E08A3A',
-   selectionBGColor: 'rgba(244, 201, 93, 0.16)',
+   activeCellColor: palette.syrupBright,
+   selectionBGColor: `rgba(${palette.butterRgb}, 0.16)`,
    headerBGColor: '#2D2D2D',
-   headerActiveBGColor: '#F4C95D',
-   ['tokens.REFERENCE']: '#E08A3A',
+   headerActiveBGColor: palette.butter,
+   ['tokens.REFERENCE']: palette.syrupBright,
    ['tokens.NUM']: '#4DA6FF',
    ...
```

- [x] **Step 4: Run sheets typecheck and tests**

Run: `pnpm sheets typecheck && pnpm sheets test`
Expected: PASS. Sheets theme values keep their shapes (`string`) — only the
literal source changes.

- [x] **Step 5: Verify in the running app**

If `pnpm dev` is still up from Task 5: navigate to a Sheets tab, select a cell,
confirm the active cell ring is the same syrup color and the selection wash is
the same butter tint. Toggle dark mode and re-confirm.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/package.json packages/sheets/src/view/theme.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Pull shared brand colors from @wafflebase/tokens in sheets theme

Replaces hardcoded Butter & Maple hex values (active cell ring, header
chip, selection wash, formula REFERENCE token color) with palette refs.
Canvas-only tokens like formulaRange*, peerCursor*, and search highlights
stay local — they have no shared analogue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docs canvas theme reads from `@wafflebase/tokens`

**Files:**
- Modify: `packages/docs/package.json` — add dependency
- Modify: `packages/docs/src/view/theme.ts`

- [x] **Step 1: Add the dependency**

Modify `packages/docs/package.json`:

```diff
   "dependencies": {
+    "@wafflebase/tokens": "workspace:*",
     "@pdf-lib/fontkit": "^1.1.1",
     ...
   }
```

Run: `pnpm install && pnpm tokens build`.

- [x] **Step 2: Inventory shared colors**

In `packages/docs/src/view/theme.ts`, the document chrome colors map cleanly:

| Key                       | Light          | Dark           | Maps to                                  |
| ------------------------- | -------------- | -------------- | ---------------------------------------- |
| `pageBackground`          | `#ffffff`      | `#2b2b2b`      | left as-is (paper white / off-black is universal — not in palette) |
| `canvasBackground`        | `#f0f0f0`      | `#1e1e1e`      | left as-is                               |
| `rulerMarginBackground`   | `#e8e8e8`      | `#333333`      | left as-is                               |
| `rulerContentBackground`  | `#ffffff`      | `#2b2b2b`      | left as-is                               |
| `defaultColor`            | `#000000`      | `#e0e0e0`      | `palette.neutrals.{mode}.ink`            |
| `cursorColor`             | `#000000`      | `#e0e0e0`      | `palette.neutrals.{mode}.ink`            |
| `selectionColor`          | `rgba(66,133,244,0.3)` | `rgba(100,160,255,0.35)` | left as-is (Google blue — neutral)  |

Conservative choice: migrate only `defaultColor` and `cursorColor` to the
shared neutrals (so dark mode picks up the warm ink/paper relationship). Leave
everything else: page chrome whites/grays are intentionally neutral.

- [x] **Step 3: Modify `packages/docs/src/view/theme.ts`**

```diff
+ import { palette } from '@wafflebase/tokens';
+
  /**
   * Theme mode type.
   */
  export type ThemeMode = 'light' | 'dark';
  ...

  const LightTheme: DocTheme = {
    defaultFontSize: 11,
    defaultFontFamily: 'Arial',
-   defaultColor: '#000000',
-
-   cursorColor: '#000000',
+   defaultColor: palette.neutrals.light.ink,
+
+   cursorColor: palette.neutrals.light.ink,
    cursorWidth: 2,
    ...

  const DarkTheme: DocTheme = {
    defaultFontSize: 11,
    defaultFontFamily: 'Arial',
-   defaultColor: '#e0e0e0',
-
-   cursorColor: '#e0e0e0',
+   defaultColor: palette.neutrals.dark.ink,
+
+   cursorColor: palette.neutrals.dark.ink,
    cursorWidth: 2,
    ...
```

Note: `palette.neutrals.light.ink` is `#2A1E12` (warm dark brown, was `#000000`)
and `palette.neutrals.dark.ink` is `#FBF6EC` (paper cream, was `#e0e0e0`). This
**is** a small visual change in the docs editor — the cursor and default text
go from neutral to slightly warm. Capture the before/after in the lessons
file. If the change feels off, fall back to `#000000` / `#e0e0e0` and skip the
migration for this PR (log the decision).

- [x] **Step 4: Run docs typecheck and tests**

Run: `pnpm --filter @wafflebase/docs typecheck && pnpm --filter @wafflebase/docs test`
Expected: PASS.

- [x] **Step 5: Rebuild docs dist for downstream consumers**

```bash
pnpm --filter @wafflebase/docs build
```

`@wafflebase/slides` typechecks against the docs `dist`, so refresh it before
running broader verification.

- [x] **Step 6: Browser smoke**

In the running dev server, open a Docs document. Toggle dark mode. Confirm:
caret + text color shift toward warm ink/cream. If the visual feels too warm,
revisit Step 3 with the fallback.

- [x] **Step 7: Commit**

```bash
git add packages/docs/package.json packages/docs/src/view/theme.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Pull warm ink/paper neutrals from @wafflebase/tokens in docs theme

Caret and default text color in the docs editor now use Butter & Maple
neutrals so the canvas chrome stays in tone with the surrounding shell.
Page background, ruler chrome, and the Google-blue selection wash stay
local — those are intentionally neutral.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Slides factory-default theme reads from `@wafflebase/tokens`

**Files:**
- Modify: `packages/slides/package.json` — add dependency
- Search-and-decide: locate where `Theme` defaults are constructed in `packages/slides/src/model/`. If a single `defaultTheme.ts` or similar exists, modify it; otherwise add one and route the existing factory through it. This is a discovery step.

- [x] **Step 1: Add the dependency**

Modify `packages/slides/package.json`:

```diff
   "dependencies": {
+    "@wafflebase/tokens": "workspace:*",
     ...
   }
```

Run: `pnpm install && pnpm tokens build && pnpm --filter @wafflebase/docs build`.

- [x] **Step 2: Locate the Slides factory default theme**

```bash
rg -n "ColorScheme|defaultTheme|factoryTheme|createTheme" packages/slides/src --type ts
```

Expected: one or two call sites that construct a `Theme` literal. Identify the
file that holds the **factory default** (the one returned when a new
presentation is created or when PPTX import fails to resolve a theme).

- [x] **Step 3: Modify the factory to source colors from `@wafflebase/tokens`**

Inside the located file, change the literal `ColorScheme` to derive from
palette + semantic. The exact diff depends on Step 2's findings; the pattern is:

```diff
+ import { palette, typography } from '@wafflebase/tokens';
+
  const defaultColors: ColorScheme = {
-   text: '#000000',
-   background: '#FFFFFF',
-   textSecondary: '#444444',
-   backgroundAlt: '#F2F2F2',
-   accent1: '#1F4E79',
-   accent2: '#E07B00',
-   ... other hex literals
+   text: palette.neutrals.light.ink,
+   background: palette.neutrals.light.paper,
+   textSecondary: palette.neutrals.light.sub,
+   backgroundAlt: palette.neutrals.light.bg,
+   accent1: palette.syrup,
+   accent2: palette.butter,
+   accent3: palette.berry,
+   accent4: palette.leaf,
+   accent5: palette.syrupDeep,
+   accent6: palette.berryBright,
+   hyperlink: palette.syrup,
+   visitedHyperlink: palette.berry,
  };

  const defaultFonts: FontScheme = {
-   heading: 'Calibri Light',
-   body: 'Calibri',
+   heading: typography.display.split(',')[0].replace(/"/g, '').trim(),
+   body: typography.body.split(',')[0].replace(/"/g, '').trim(),
  };
```

(`typography.display` is a CSS font stack `"Fraunces", ui-serif, ...`. Slides
needs a single family name — extract the first.)

Document the choice in the lessons file: **slides factory default is now
Butter & Maple branded.** User-modified themes (from PPTX import or in-app
theme editor) override this default and are unaffected.

- [x] **Step 4: Update PPTX import snapshots if any**

```bash
pnpm slides test
```

If snapshot tests fail with default-theme color diffs, inspect each diff. If
the change is intentional (new factory default applies), run:

```bash
pnpm slides test -- -u
```

Then re-run unfiltered: `pnpm slides test`. Note the snapshot refresh in the
PR description.

- [x] **Step 5: Typecheck and tests pass**

Run: `pnpm slides typecheck && pnpm slides test`
Expected: PASS.

- [x] **Step 6: Rebuild slides dist for the frontend**

```bash
pnpm slides build
```

- [x] **Step 7: Browser smoke**

In dev server: create a fresh slide deck or open one that uses the default
theme. Confirm:
1. New decks show the warm Butter & Maple accent set (syrup primary, butter highlight, berry alert).
2. An existing deck with a user-modified theme (or imported PPTX) shows its
   own colors — tokens did not overwrite per-presentation data.

- [x] **Step 8: Commit**

```bash
git add packages/slides/package.json packages/slides/src pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Source slides factory-default theme from @wafflebase/tokens

New presentations now ship with the Butter & Maple brand palette as the
factory default. The OOXML role mapping (dk1/lt1/accent1..6) and tint/
shade algorithm are unchanged. User-edited per-presentation themes and
PPTX imports always win at runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Final verification + roadmap status update

**Files:**
- Modify: `docs/design/design-system-unification.md` — flip PR #1 status to `Merged` (after merge; for the PR push it stays `In progress`)
- Modify: `docs/tasks/active/20260524-tokens-package-lessons.md` — write up lessons

- [x] **Step 1: Run the full fast lane**

Run: `pnpm verify:fast`
Expected: PASS. If `@wafflebase/slides` complains about missing exports from
`@wafflebase/docs`, run `pnpm --filter @wafflebase/docs build` first and retry.

- [x] **Step 2: Run the self-lane (includes all builds)**

Run: `pnpm verify:self`
Expected: PASS. Confirms tokens + docs + sheets + slides + frontend all build
in CI ordering.

- [x] **Step 3: Browser smoke captures**

In dev mode, take light/dark before-and-after screenshots of the four screens
listed in Task 5 step 5. Save them aside for the PR description.

- [x] **Step 4: Self-review via code-review skill**

Dispatch the `superpowers:requesting-code-review` skill (or `/code-review`)
against the branch diff. Apply blocking findings; record non-blocking as known
limitations in the lessons file.

- [x] **Step 5: Update the lessons file**

Open `docs/tasks/active/20260524-tokens-package-lessons.md` and fill in:
- What surprised you about the package wiring.
- Any contrast-test failures or palette adjustments.
- Whether the docs ink/cursor warming felt right or was reverted.
- Whether any slides snapshot tests had to be refreshed.

- [x] **Step 6: Archive and re-index tasks**

```bash
pnpm tasks:archive && pnpm tasks:index
```

This moves `20260524-tokens-package-{todo,lessons}.md` to `docs/tasks/done/`
and refreshes `docs/tasks/README.md`.

- [x] **Step 7: Commit lessons + index update**

```bash
git add docs/tasks/
git commit -m "$(cat <<'EOF'
Archive tokens-package task + capture lessons

Closes the @wafflebase/tokens PR #1 entry in the design-system
unification roadmap. Lessons cover the workspace wiring sequence, the
docs ink/cursor warming decision, and any slides snapshot refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Step 8: Push and open PR**

```bash
git fetch origin
git rebase origin/main
git push -u origin <branch-name>
gh pr create --title "Introduce @wafflebase/tokens shared design tokens package" --body "$(cat <<'EOF'
## Summary

- Introduces `@wafflebase/tokens` as the single source of truth for the Butter & Maple palette, semantic colors, radius, and typography.
- Generates `dist/tokens.css` from TS sources via a build script; frontend consumes via `@import`.
- Migrates Sheets canvas theme, Docs canvas theme, and the Slides factory-default theme to read shared brand colors from the new package. Canvas-only tokens (peer cursors, formula ranges, page chrome) stay local. Slides per-presentation themes are untouched at runtime.
- First PR of the design-system unification roadmap (`docs/design/design-system-unification.md`).

## Test plan
- [x] `pnpm verify:fast`
- [x] `pnpm verify:self`
- [x] Browser smoke: light/dark toggle across document list, Docs, Sheets, Slides (captures attached)
- [x] WCAG AA contrast smoke (in package)
- [x] PPTX import snapshot refresh: <yes/no, list affected tests>

## Visual diff
<attach light/dark captures>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

- [x] Spec coverage: PR #1 of `design-system-unification.md` requires (a) a tokens package, (b) frontend migration, (c) sheets migration, (d) docs migration, (e) slides factory-default migration, (f) workspace wiring, (g) contrast tests. Tasks 1–9 map 1:1.
- [x] Placeholder scan: every step shows the actual diff or command. Discovery in Task 8 step 2 is bounded (one ripgrep, then a known pattern).
- [x] Type consistency: `palette`, `semantic`, `radius`, `typography` are defined in Task 2 and used unchanged in Tasks 3, 5, 6, 7, 8. `contrastRatio()` defined in Task 4.

---

## Status

| Task | State |
| ---- | ----- |
| 1. Scaffold tokens package | Not started |
| 2. Palette + semantic + radius + typography | Not started |
| 3. CSS generation script | Not started |
| 4. WCAG AA contrast tests | Not started |
| 5. Frontend consumes tokens | Not started |
| 6. Sheets pulls brand colors | Not started |
| 7. Docs pulls warm neutrals | Not started |
| 8. Slides factory default | Not started |
| 9. Verification + archive | Not started |
