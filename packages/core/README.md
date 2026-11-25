# @wafflebase/core

Shared foundation package for Wafflebase. Holds the engine-level primitives
that would otherwise be duplicated across `@wafflebase/sheets`,
`@wafflebase/docs`, and `@wafflebase/slides` — design tokens, geometry, and
URL helpers.

The package is **subpath-only**: there is no root `.` barrel export. Import
exactly the leaf you need so bundlers tree-shake the rest.

## Subpaths

| Import | Contents |
|--------|----------|
| `@wafflebase/core/tokens` | Design tokens — `palette`, semantic colors, `radius`, `typography`, `contrast` helpers |
| `@wafflebase/core/tokens.css` | Generated CSS custom properties for the tokens (built by `scripts/build-css.ts`) |
| `@wafflebase/core/geometry` | `Point` / `Rect` / `Size` types, bounding-box math, hit-testing |
| `@wafflebase/core/url` | Safe-protocol hyperlink gating (`SAFE_PROTOCOLS`, `isSafeUrl`) shared by every renderer/exporter across sheets and docs |
| `@wafflebase/core/image` | `loadImage`, the CORS-then-plain-retry image loader the engines' image caches share |
| `@wafflebase/core/document-link` | The document-URL grammar (type → route letter, uuid id rule, path parse) and the chat `?at=` anchor types, limits and codec — read by the backend's chat ref sync and the frontend alike |

`@wafflebase/tokens` is folded into this package as the `./tokens` subpath.

> **Roadmap:** `./canvas`, `./ooxml`, and `./ooxml/drawingml` subpaths are
> planned but not yet shipped — see the design doc below. The exports map in
> the design doc describes the target shape, not the current one.

## Usage

```typescript
import { palette } from '@wafflebase/core/tokens';
import { rectsIntersect, type Rect } from '@wafflebase/core/geometry';
import { isSafeUrl } from '@wafflebase/core/url';
```

Classic CJS resolvers ignore the `exports` map, so a new subpath also needs a
`typesVersions` entry in this package's `package.json` (what the backend's
build, which clears `paths`, reads its declarations through). The backend's
`tsconfig.json` paths and jest `moduleNameMapper` map `@wafflebase/core/*` to
source by wildcard, so they need nothing. The backend's runtime image copies
`dist/` (see the root `Dockerfile`).

## Build

```bash
pnpm --filter @wafflebase/core build
```

## Further Reading

- [shared-core-extraction.md](../../docs/design/shared-core-extraction.md) —
  the extraction audit, subpath design, and 3-PR rollout plan.
