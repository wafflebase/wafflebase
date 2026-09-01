# Template Gallery — Lessons

## Research the mechanism, not the feature list

The useful output of reading Canva and CapCut was not "they both have
templates". It was that **neither invents a file format**: a template is the
ordinary artifact plus a listing row, and using one is a copy. That single
observation is what turned a gallery into a `dest` parameter on a service that
already existed. The one axis where they genuinely differ — CapCut's
replaceable clips — tracks the medium (thirty seconds on a phone vs. an editor
you open anyway), which is why copying Canva was the right call rather than a
coin flip.

Corollary: when two reference products agree on a mechanism, that agreement is
worth more than either product's feature list, and it is what belongs in the
design doc.

## The unauthenticated image route removed the hard problem

The expected blocker was that a template copied across a workspace boundary
would lose its embedded images. `GET /images/:id` turned out to be
unauthenticated and immutably cached
(`packages/backend/src/image/image.controller.ts:64`), so a copy renders
anywhere. Checking that before designing around it saved an entire re-hosting
subsystem from the Phase 1 scope.

## Denormalized columns and authorization do not mix

`TemplateListing.workspaceId` is denormalized off the document so the
workspace-tier query needs no join. Using it for the *visibility* check was a
bug found in self-review: move the document to another workspace and its old
workspace keeps reading it through the listing. Read authority has to follow
`document.workspaceId`. A denormalized column is a query convenience; the
authorization predicate must read the live relation.

## An endpoint keyed on a different id needs its own gate

`GET /documents/:id/template` returns the listing's `previewToken`. Gating it
on the *listing's* visibility (unlisted = anyone) meant anyone holding an
expiring viewer share link — which reveals the document id — could trade up to
the listing's non-expiring token. Two routes reaching the same capability
through different ids need the gate appropriate to *their own* id: the
document route is membership-gated, the `/t/:id` route is
capability-gated. Both are correct; sharing one predicate was not.

## `verify:fast` does not lint the backend

The most useful thing CodeRabbit found was not a bug — it was that my gate had
a hole. `verify:fast` runs `pnpm backend test` but **never `pnpm backend
lint`**; the only backend ESLint in the chain is `arch:backend`, which uses the
separate `eslint.arch.config.mjs`. So 39 `prettier/prettier`,
`@typescript-eslint/require-await` and `no-unsafe-assignment` errors in new
backend code passed both `verify:fast` and `verify:self`.

Two compounding details:

- `packages/backend`'s `lint` script is `eslint … **--fix**`. Running it does
  not report a clean tree; it *rewrites* one. To see what CI-style checking
  would see, run `npx eslint src/<path>` from `packages/backend` with no
  `--fix`.
- The backend already carries pre-existing lint debt for this exact reason —
  20 errors in `document-copy.service.spec.ts` and `document.module.ts` alone,
  confirmed present on `main` by stashing and re-linting. So "the lint output
  is not empty" proves nothing; only a before/after comparison does.

**How to apply:** after touching `packages/backend`, lint the changed files
explicitly without `--fix`, and diff against `main` before assuming an error is
yours. Do not fix pre-existing debt in a feature PR — it buries the diff.

## Traps hit

- **`useTemplate` is not a legal API function name.** `react-hooks/rules-of-hooks`
  rejects any `use*` call from a non-component; renamed to `createFromTemplate`.
  Applies to every `use*` name in `packages/frontend/src/api/`.
- **`git commit` runs `verify:fast` as a pre-commit hook** and takes well over
  the 2-minute default Bash timeout. Run the commit with `run_in_background`,
  as the pre-push note in memory already says for `verify:self`.
- **Stale `packages/docs/dist` makes slides and frontend typecheck fail**
  with phantom `BlockMarker` / `StoredColor` errors. Confirmed pre-existing by
  stashing and re-running against `main` before spending any time on it — the
  cheap check that keeps someone else's breakage from becoming your debugging
  session.
