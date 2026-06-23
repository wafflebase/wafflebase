# Slides CLI — Phase 1 — Lessons

## What went well

- **Investigate before planning.** Three parallel Explore agents (CLI
  structure, slides serialization surface, backend API) revealed that the
  backend `/content` endpoint and `slides import` were *already done* —
  the real gap was only the read side. Scoping Phase 1 to "read +
  metadata + content" avoided redoing finished work.
- **Mirror the docs pipeline.** `slides/content.ts` is a near-clone of
  `docs/content.ts` (injectable `*ContentIO`, `parse*Format`, `--out`/
  `--force`/`-` semantics). Following the established pattern kept the
  diff predictable and reviewable.
- **Reuse the docs serializers.** Slides text is stored as
  `@wafflebase/docs` `Block[]`, so `md`/`text` extraction wraps each
  `TextBody.blocks` in a synthetic `{ blocks } as Document` and calls
  `serializeMarkdown`/`serializeText`. No new serializer needed.

## Gotchas / patterns to remember

- **`flattenElements` includes the group container *and* recurses into
  children.** `textBodiesOf` returns `[]` for `group` (and image/
  connector), so grouped text is captured via the recursed leaves
  without double-counting.
- **The docs serializers read only `doc.blocks` (+ optional header/
  footer).** That's why the `{ blocks } as Document` cast is safe — but
  it's a coupling to verify if `Document` ever gains a required field.
- **CLI `--format` is global.** `slides content` does NOT redeclare it;
  it reads `opts.format` and validates via `parseSlidesContentFormat`,
  exactly like `docs content`.
- **Alias hygiene.** Used `slide.*` / `deck.*` aliases only — avoided the
  bare `import`/`export` aliases that `sheets.*` carries, so no
  cross-namespace `schema` collisions.
- **`verify:fast` halts early** at the pre-existing
  `packages/slides/test/anim/player.test.ts` `.at()` typecheck error
  (CI never runs it). Verified the post-slides chain steps (`cli
  typecheck/test`, `docs typecheck/test`) independently instead.

## Deferred

- `slides export pdf` — Canvas-rasterized; needs a node canvas lib the
  docs CLI deliberately avoids.
- `slides export pptx` — no PPTX *export* engine exists (import-only).
