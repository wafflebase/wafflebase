# Lessons — class B backend endpoints (#998)

## What the CRDT-only capabilities cost to expose

- **Anchors decide whether a comment can be created from outside.** A sheet
  cell anchor is `{ tabId, rowId, colId }` — axis ids, which an `A1` ref
  resolves to through `rowOrder`/`colOrder`. A PDF anchor is page-relative
  geometry. A docs anchor is a pair of Yorkie `TreePos` structs, which only a
  session holding the tree can produce. So "add comments to the API" is not
  one feature: two of the three document types can create, one cannot.
- **Timestamps cross a boundary.** Yorkie 0.7.x types integer numbers as
  32-bit, so every frontend comment store writes `BigInt(ms)` and converts
  back on read. A backend writer that stores a plain `Date.now()` produces
  threads the editor renders with a wrong date; `toYorkieMs`/`fromYorkieMs`
  in `yorkie/comment-ops.ts` mirror the frontend helpers.
- **`readSlidesRoot` was lossy.** It used to return a `meta` of exactly
  `{ title, themeId, masterId }`, dropping `unit`, `pxPerPt`, `slideHeight`
  and `recentColors` (fixed in #1108). Writing back only `root.slides` is
  still the rule for granular slide ops: a whole-root write is last-write-wins
  over every collaborator's concurrent edit.

## Verification gaps

- No live Postgres/Yorkie in this run, so every new route is covered by unit
  and controller specs over plain objects (the `tab-ops` / `slide-ops` /
  `comment-ops` modules are pure for exactly that reason) and by the CLI's
  mocked-fetch tests. An end-to-end attach was not exercised.
