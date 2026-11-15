# Daily reset of the homepage live demo documents

The homepage demo iframes (`/shared/{VITE_DEMO_*_SHARED_TOKEN}`) are editor
share links to three real documents, so every visitor edits the same copy and
the graffiti accumulates. Reset each demo document once a day to a pinned
"golden" revision.

## Design

See `docs/design/homepage.md` § Daily reset.

- The golden content is a revision named from the history panel, **pinned by
  id** in `WAFFLEBASE_DEMO_RESET_TARGETS=<token>:<revisionId>,…`. Not by
  label: `CreateRevision` is ungated, so a visitor could name their own
  revision `demo-golden` (self-review round 1, security).
- A token without a revision id is setup-only: never restored, its labelled
  revisions are logged with ids at boot.
- A backend `DemoResetService` arms one in-process daily timer at
  `WAFFLEBASE_DEMO_RESET_HOUR_UTC` (default 15 = 00:00 KST). No new
  dependency, no public endpoint, no secret.

## Todo

- [x] Confirm SDK 0.7.27 exposes `listRevisions`/`restoreRevision` on `Client`
- [x] Confirm the auth webhook allows the scoped service token for them
- [x] `YorkieService.withDocument` hands the callback its `Client`
- [x] `demo-reset/` module: config parsing, delay math, candidate listing, restore
- [x] Unit tests (config, schedule, paging, failure isolation, label spoofing)
- [x] Smoke against local Yorkie: name → graffiti → restore → editor sees golden
- [x] Backend README env docs + `docs/design/homepage.md` § Daily reset
- [x] `pnpm verify:fast`
- [x] Self review: 3 rounds, stopped at the bound (see lessons)
- [x] Human decision on the round-3 findings: fix the `snapshot` handling and
      the dangling tab in this PR; the candidate-list crowding stays a known
      limitation
- [x] Sheet/docs/slides stores, sheet view, pivot hook, tab-name
      normalization handle `snapshot` (tests fail on `snapshot` before the fix)
- [x] Owner spreadsheet editor re-picks a removed tab (`resolveActiveTabId`)
- [x] Rebase, PR — #1148

## Deploy (human)

1. In each demo document, name the good state `demo-golden`.
2. Ship a backend image with this change; set
   `WAFFLEBASE_DEMO_RESET_TARGETS=<sheetToken>,<docToken>,<slidesToken>` in
   `yorkie-team/devops` `k8s/wafflebase/deployment.yaml`.
3. Read the boot log's candidate ids, pin them as `<token>:<revisionId>`,
   redeploy. The log should then read `3 of 3 document(s) pinned`.
