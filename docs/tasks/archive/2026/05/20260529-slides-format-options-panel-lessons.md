# Slides Format Options Panel — Lessons

## What surprised us

### Yorkie `migrateDocument` strips unknown Meta fields

Adding `Meta.unit?: 'in' | 'cm'` as an optional field is necessary but
not sufficient. The `migrateDocument` function in
`packages/slides/src/model/migrate.ts` reconstructs `meta` from a
fixed object literal, so any field not explicitly carried through is
dropped silently on every `read()`. The T1 implementer caught this
and added a defensive `if (raw?.meta?.unit === 'in' || raw?.meta?.unit
=== 'cm') meta.unit = raw.meta.unit;` clause. **Lesson for future
`Meta` additions:** every new field needs a matching `migrate.ts`
branch, even if it's optional, because migration runs on every read,
not just on schema-version bumps.

### Frontend RTL infrastructure was absent

The `format-panel` was the first place in this repo to write React
component tests with React Testing Library. The T5 implementer had to:
- Add `@testing-library/react` + `@testing-library/user-event` as
  devDependencies.
- Create `packages/frontend/tests/setup.ts` with `afterEach(cleanup)`.
- Extend the vitest `include` in `vite.config.ts` to cover
  `tests/**/*.test.tsx`.

This was bundled into the T5 commit since T5 was the first to hit it.
**Lesson:** check infrastructure presence before writing the test —
the implementer wasted some cycles debugging missing setup before
realizing it had to be added.

Also: `@testing-library/jest-dom` was NOT installed, so the standard
`.toBeInTheDocument()` matcher fails. Tests use vitest core matchers
instead (`.toBeTruthy()`, `.toBeNull()`, direct `.value`/`.checked`
reads). If we want jest-dom matchers later, that's its own infra add.

### Toolbar pattern drift — plain `<button>` vs shadcn `<Toggle>`

T11 implementer followed the spec's plain `<button>` snippet verbatim
for the Format toggle, but the existing Theme toggle uses shadcn's
`<Toggle>` component. Visually inconsistent (different focus ring,
pressed state styling). Fixed inline post-T11 by swapping to
`<Toggle>`. **Lesson:** when writing spec snippets that match a
"copy the existing X" instruction, write the snippet from the
existing pattern rather than from scratch — the spec author can lose
track of which component the codebase uses, and a verbatim
implementer will follow the snippet over the pattern.

### Slides has no interaction browser harness

The planned T13 (browser smoke) was deferred. The existing
`verify-interaction-browser.mjs` is sheet-only — adding a slides
harness page + bridge would be a multi-task project on its own.
Coverage is provided by 40+ unit tests across T3–T8 plus the existing
slides visual baselines that the FormatPanel does not affect (panel
is conditional on `rightPanel === 'format'`, no visual leak at idle).
**Follow-up candidate:** add a slides interaction harness in a
separate spec; tracked here for awareness.

### Lock-aspect "per-element ratio" contract

The spec specifies per-element ratio preservation (Google Slides
behavior). The T8 component delegates to a parent `onLockedResize`
callback that hands the implementer the elements + axis + newPx, and
the parent walks each element with its own ratio. This split keeps
the component pure (no store access) while making the per-element
batch write trivial in `FormatPanel` (T9). Worth keeping the pattern
if more multi-edit sections land (e.g. "Match selected width to
largest" follow-ups).

## What worked well

- TDD per task: each implementer wrote tests first, ran them red,
  implemented, ran them green. Zero "tests passed but feature
  doesn't work" reports.
- Mixing model sizes by task complexity (haiku for T2/T3/T4 pure
  helpers, sonnet for T5–T7 small components, opus for T8/T9 + T10–12
  bundle). Cost-effective and no quality regressions.
- Bundling T10–T12 (toolbar removal + Format toggle + slides-detail
  union) into one dispatch. They're tightly coupled and small;
  splitting them would have produced three trivial commits and three
  spec-review cycles. Bundling was the right call.

## What did not work and would do differently

- Initial plan included `AutofitSelector` as a reusable component
  that does not exist. Caught in self-review pre-commit. **Always
  grep for component names mentioned in a spec before writing
  "reuse X" in the plan.**
- Spec said `pxToUnit` would be imported in `size-position-section`
  but the component only ever needs `unitToPx`, `formatDisplay`, and
  `radToDeg`. T8 implementer dropped `pxToUnit` correctly. Plan
  should not pre-prescribe unused imports.
