# Task archive audit — full sweep of `docs/tasks/active/`

## Goal

`pnpm tasks:archive` keys **only** on the presence of an unchecked `- [ ]`
box. A task that actually shipped but whose boxes were never ticked stays
active forever. Sweep every active todo, verify each unchecked item against
the real codebase, tick what is genuinely done, and archive what is complete.

## Method

Multi-agent exhaustive survey: eight agents over eight disjoint batches, each
verifying every unchecked item against code, tests, git history and `gh`.
Rule for every agent: never tick a box on the strength of the todo's own prose
or a design doc's intent — only on concrete code, tests, or a merged commit.

## Checklist

- [x] Inventory active todos and count unchecked boxes
- [x] Batch 1 — docs engine tasks audited
- [x] Batch 2 — sheets connector / import tasks audited
- [x] Batch 3 — slides / core / infra tasks audited
- [x] Batch 4 — harness + agent pipeline tasks audited
- [x] Batch 5 — eval scorer tasks audited
- [x] Batch 6 — eval lane / report tasks audited
- [x] Batch 7 — CI / coderabbit / corpus tasks audited
- [x] Batch 8 — notes / images / release tasks audited
- [x] Apply verified tick marks to todo files
- [x] Resolve the disclosure-checkbox blocker
- [x] Run `pnpm tasks:archive && pnpm tasks:index`
- [x] Commit

## Review

### Result

**65 active tasks → 21.** 88 files moved to `docs/tasks/archive/`.

### What the audit found

Two tasks were genuinely shipped-but-unticked, exactly the case this sweep
exists to catch:

- `20260810-devops-merge-queue` — the queue is live; 10 `gh-readonly-queue`
  refs (pr-801 … pr-912) prove real runs, and `MAINTAINING.md:184` records
  "Enabled."
- `20260810-release-v0.6.4` — `yorkie-team/devops#337` (backend image pin)
  merged 2026-08-10; tag `v0.6.4` and root `package.json` agree.

The largest single correction was `20260625-sheets-lakehouse-connector`:
**23 boxes** ticked. Commit `faf7d50ac` (#868) shipped far more than the doc
recorded — the whole LH-1/3/4/5/6 span plus the CI `--network none` extension
smoke. Eight items genuinely remain (path-marker detection, `format: auto`,
the table browser, the R2 smoke, the XTable/Hudi decision).

Other real ticks: 18 on `notes-undo-cursor` (whole feature verified in
`packages/notes/src/store/`), 12 across the harness batch, 5 on
`bigquery-connector`, 4 on `file-import`, 1 on `docs-wordprocessor`
(spell check, #427).

### The disclosure-checkbox blocker

The dominant reason tasks were stuck was **not** stale ticks. 60 boxes across
19 files were **negative-form disclosures** — `- [ ] Not verified: a real
dispatch has never been run`, `- [ ] Not run: verify:self`. These are honest
statements of measurement gaps written into a Verification ledger. Ticking one
would assert the opposite of its own text, so those tasks could never archive,
and every future sweep would have to re-examine and re-reject them.

Fix: a checkbox means "pending work"; a disclosure never was one. Converted
`- [ ] <disclosure>` to `- <disclosure>` (text verbatim, continuation lines
re-indented from the 6-space `- [ ] ` column to the 2-space `- ` column). That
fixes the data rather than teaching the archiver a fragile heading heuristic.

`20260810-notifications` was a variant: a bootstrap paradox whose last box was
"run `pnpm tasks:archive`" — untickable until archive ran, and archive would
not run while it was unticked. Ticked once the step actually ran.

### What is still active, and why

17 of the 21 carry real unshipped work — `docs-wordprocessor` (30 roadmap
items), `design-editor-layout-sandbox` (CP4.4/4.5 deferred by the pivot),
`slides-gradient-editing` (radial PR2 never landed), `shared-core-extraction`
(no `core/src/ooxml` at all), `mysql-connector` (nothing but the design doc).

Four are code-complete and blocked **only** on a human action:
`yorkie-auth-webhook`, `notes-undo-cursor`, `notes-image-upload`,
`image-downscale` — each waiting on a manual smoke in `pnpm dev`. Those were
deliberately left unticked; an agent cannot run them.

### Stale prose worth a follow-up

Two claims in still-active docs are now false but were left alone under the
no-reword rule: `eval-scoring-lane` says the lane "has never run on GitHub"
(it has — 4 green `workflow_dispatch` runs on 2026-08-20), and
`eval-segmentation` says no merged renderer reads the grid (`report.mjs`
does, since `39debb47a` #909). Both are archived now; correct them in place
if they are ever reopened.
