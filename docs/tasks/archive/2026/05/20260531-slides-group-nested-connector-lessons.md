# Lessons — group-nested connector endpoints

## What went well

- **Read the data first.** Unzipping the offending PPTX and walking
  `slide24.xml` showed exactly which `<a:stCxn id="…" idx="…">` pairs
  attached to which shape. That alone pinned the bug to "the target
  shape lives inside `<p:grpSp>`" before reading a line of import or
  render code.
- The pre-existing comment at `element-renderer.ts` ("Connectors
  inside groups are painted in raw ctx space") explicitly flagged a
  related coordinate-space asymmetry — a useful breadcrumb that
  hinted the issue was on the lookup side.
- Following TDD: writing a failing test in `connector-frame.test.ts`
  for the group-nested case took ~5 minutes and immediately validated
  the fix.

## What to watch for next time

- **Coordinate-space audit when bridging tree-structured data and a
  flat lookup.** `flattenElements` was advertised as "DFS so things
  inside groups still resolve" — but flattening alone doesn't lift the
  frames out of group-local space. Any flat map used by a *renderer*
  that consumes `el.frame.x/y` as world coords needs world frames at
  build time, not deferred per-call ancestor walks.
- **PPTX `<p:grpSp>` is more permissive than our editor's `group()`
  invariant.** Imported decks can break "v1 invariant: connectors are
  never inside groups" and "groups never nest arbitrarily" assumptions.
  Anywhere those invariants are quoted, leave a note that the *editor*
  enforces them but the *importer* doesn't.
- **Pre-existing typecheck failures on main can mask regressions.**
  `pnpm slides typecheck` was red on `BlockMarker` before I touched
  anything; fixed by `pnpm --filter @wafflebase/docs build` to refresh
  the docs `dist/` consumed by slides. Worth adding a sanity rebuild
  step to verify lanes when a fresh repo greets you with red.

## Process notes

- The bug was diagnosed by reading the actual XML, not by guessing
  from screenshots. When a visual bug has a clear data-source artifact
  (here: `<a:stCxn id>`), prefer parsing it over inferring.
- Replaced six `new Map(flattenElements(...).map(...))` sites in one
  pass; introducing the helper made the diff smaller than fixing each
  callsite locally and kept all renderers in agreement.
