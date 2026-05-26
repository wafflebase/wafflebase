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

```bash
pnpm --filter @wafflebase/tokens build
```

Emits `dist/index.{js,d.ts}` and `dist/tokens.css`. Consumers reach the CSS file
via the `./tokens.css` export.
