# Lessons — slides text-box edit-mode theme color

## What the bug taught

- **Two render paths for the same content must share the same color
  resolver.** Slides text renders twice: the committed slide canvas
  (`drawText`) and the in-place editor (`initializeTextBox` →
  `paintLayout`). The canvas path remapped docs-default `'#000000'` /
  `undefined` to the deck theme color; the editor path didn't. Any time
  content is painted by two code paths, theme/style resolution must be
  threaded into both or they will visibly diverge.

- **Follow the breadcrumb comments.** `editor.ts` already had a comment
  ("a future colorResolver can look up theme palettes via
  `getActiveTheme(doc)`") and `render-context.ts` said "Task 4 widens this
  to also carry a colorResolver for the docs text path." The infra was
  designed for this; the wiring was just never completed.

## Debugging approach that worked

- Traced the data flow: stored block color → canvas resolver (remaps) vs
  editor resolver (default passthrough = literal black). Confirmed the
  divergence before touching code.
- Validated the regression test by disabling the one-line fix and watching
  it fail, then restoring — proves the test actually guards the behavior.

## Gotchas

- `@wafflebase/docs` is consumed from its built `dist` by slides; rebuild
  docs (`pnpm --filter @wafflebase/docs build`) after changing its public
  types or slides typecheck sees the stale `.d.ts`.
- `getActiveTheme` throws on unknown `themeId` by design — fine to call in
  new paths only because the renderer already calls it every frame.
