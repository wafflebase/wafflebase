---
paths:
  - "packages/docs/**"
  - "packages/slides/**"
---

# Docs engine

- Keep `packages/docs/src/node.ts` DOM-free: the backend tsconfig and Jest map `@wafflebase/docs` straight to it. Export Canvas/DOM code only from `src/index.ts`.
- Slides typechecks and the backend runs against docs' built `dist`. After changing docs exports or types, run `pnpm --filter @wafflebase/docs build`, or slides typecheck shows phantom `InlineStyle`/type errors.
