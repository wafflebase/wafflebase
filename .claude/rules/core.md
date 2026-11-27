---
paths:
  - "packages/core/**"
  - "packages/backend/tsconfig.json"
---

# Core

- `@wafflebase/core` is subpath-only. A new subpath is `src/<name>/index.ts` plus an `exports` entry in `packages/core/package.json` pointing at the build (`types`/`import`/`default` under `dist/<name>/`, `require` under `dist/cjs/<name>/`), like `./tokens`.
- The backend resolves subpaths through the `"@wafflebase/core/*": ["../core/src/*"]` paths entry in `packages/backend/tsconfig.json`, because classic CJS resolution ignores `exports`. Keep that wildcard; a subpath outside `src/<name>/` will not resolve there.
