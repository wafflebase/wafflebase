# v1 worksheet API — review fixes for #974

Five findings on PR #974 ("Expose remaining deep worksheet features over the
v1 API"), verified against the PR head before any of them were acted on. The
CodeRabbit review raised seven actionable comments and two nitpicks; four
survived verification, one was raised by nobody, and the rest are recorded at
the bottom as deliberately not taken.

## Fixes

- [x] **1. `GET /charts` returns 500 on any chart with `seriesColumns`.**
      `readCharts`' shallow spread leaves the nested array a Yorkie proxy, and
      `CRDTArray.toJSON()` iterating that proxy yields plain elements it then
      calls `.toJSON()` on — a `TypeError` thrown inside `res.json()`.
      Route each chart through `unwrapJson`, following the precedent in
      `slides-tree.ts`.
- [x] **1b. The same bug, already shipping in the sibling controller.**
      `worksheet-filter-pivot.controller.ts` uses `detachYorkieValue` for
      `ws.filter` / `ws.pivotTable`. That helper branches on `Array.isArray`,
      which is false for a Yorkie array proxy, so `filter.hiddenRows` and all
      four pivot arrays come back as `{createdAt, movedAt}` CRDT metadata —
      silently wrong data, no error. Raised by nobody; found while checking
      the "sibling precedent" the review told us to copy.
- [x] **2. `clear-range` has no area bound.** `parseRange` validates syntax
      only, and `toRefsFromRanges` yields one ref per cell inside a
      synchronous `doc.update`. `A1:XFD1048576` blocks the whole Node process
      for minutes on a ~20-byte payload. Bound it the way `parseMerges`
      already bounds merges in `worksheet-settings.ts`.
- [x] **3. `parseFilter` discards `hiddenRows`.** The type has six required
      fields and the parser builds five; the blanket `as` cast hides it.
      `hiddenRows` is stored, not derived — `loadFilterState` never recomputes
      it — so a filter set through this API opens with its dropdowns armed and
      every row still showing. Parse the field and drop the blanket cast so
      the next omission is a compile error.
- [x] **4. An omitted key clears instead of erroring.** `parseSheetStyle`,
      `parseFilter` and `parsePivot` treat `undefined` like `null`, and the
      controllers' `null` branch deletes the stored field — so a typo'd key or
      a body-less `PUT` wipes state and returns 200. Every other parser in
      this PR already 400s on a missing key.
- [x] **5. Prettier.** 16 of the PR's 25 files fail `prettier --check`.

## Not taken (recorded so the next reader does not re-litigate)

- **GET handlers skip the tab-existence check.** True, but the three sites the
  review anchored on are 3 of 15 identical new handlers, and the repo is
  already split: `cells.controller.ts` 404s, the pre-existing
  `worksheet.controller.ts` these were copied from does not. Fixing three
  would make the PR self-inconsistent. Needs one uniform pass, and a decision
  about whether it changes behavior for existing callers.
- **Duplicated `assertSheetDocument` / `worksheetOrThrow`.** Real, and larger
  than reported — 8 files, ~150 lines, 2 of them predating this PR. Not
  verbatim either (message noun and return cast both vary), so extraction
  needs a parameter and a generic. Belongs in its own cleanup commit.
- **Inverted filter ranges.** The validation gap is real and gets its ordering
  check as part of fix 3, but the review's stated impact was wrong: the only
  reader normalizes through `toRange`'s `Math.min`/`Math.max`, so nothing is
  stored as an empty region. Fixed for contract honesty, not for a crash.
- **Backend lint is not in any CI lane.** `verify-self` runs `lint:arch`,
  a separate config with no prettier rule, so nothing enforces
  `prettier/prettier` on `packages/backend`. `main` already has ~50 failing
  files. Adding the gate means clearing those first — out of scope here.

## Review

Four commits on top of the original: the serialization fix, the clear-range
bound, the parser contracts, and the formatting pass. `pnpm verify:fast` is
green on each; `packages/backend` is 348 tests across 32 suites, and all 25
of the PR's TypeScript files now pass both `prettier --check` and `eslint`.

Every fix was written test-first against the unfixed code and shown to fail
before it passed — including the three that only a real `yorkie.Document` can
reach, which no spec in the original PR could have caught.

Three `@typescript-eslint/no-unnecessary-type-assertion` errors turned up in
the PR's own new code while linting and were removed. One of them,
`c.showGridlines as boolean`, is genuinely redundant: the value is already
narrowed by the `reject()` guard above it. `readStyleMap`'s shallow spread was
checked for the same proxy defect as `readCharts` and is safe — `CellStyle` is
flat, with no nested array or object.

Two environment problems surfaced, neither from this branch: the workspace had
no `node_modules` for `packages/debug-report`, and `packages/design-editor`
had no built `dist/`. `pnpm install --frozen-lockfile` and a package build
cleared both.
