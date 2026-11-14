# Daily reset of the homepage live demo documents

The homepage demo iframes (`/shared/{VITE_DEMO_*_SHARED_TOKEN}`) are editor
share links to three real documents, so every visitor edits the same copy and
the graffiti accumulates. Reset each demo document once a day to a named
"golden" revision.

## Design

- The golden content is a **named revision** created from the editor's history
  panel ("Name current version", label `demo-golden` by default). Changing the
  example = edit it, name a new version with the same label; the newest one
  wins.
- A backend `DemoResetService` arms one in-process daily timer (no new
  dependency, no public endpoint, no secret). Prod runs `replicas: 1`; more
  replicas only restore the same revision twice.
- Config is opt-in and empty by default:
  - `WAFFLEBASE_DEMO_RESET_TOKENS` — comma-separated share tokens (the same
    values as the frontend's `VITE_DEMO_*_SHARED_TOKEN`).
  - `WAFFLEBASE_DEMO_RESET_LABEL` — revision label, default `demo-golden`.
  - `WAFFLEBASE_DEMO_RESET_HOUR_UTC` — 0..23, default `15` (00:00 KST).
- Per token: `ShareLinkService.findByToken` → document type + id → attach via
  `YorkieService.withDocument` (service token, read-only sync) → page
  `listRevisions` newest-first for the label (bounded) → `restoreRevision`.
  One failing document never stops the others.

## Todo

- [x] Confirm SDK 0.7.27 exposes `listRevisions`/`restoreRevision` on `Client`
- [x] Confirm the auth webhook allows the scoped service token for them
- [ ] `YorkieService.withDocument` hands the callback its `Client`
- [ ] `demo-reset/` module: config parsing, delay math, label search, restore
- [ ] Unit tests (config, schedule, paging, failure isolation)
- [ ] Backend README env docs + `docs/design/homepage.md` risk row
- [ ] `pnpm verify:fast`
- [ ] Self review, PR

## Deploy (human)

1. In each demo document, name the good state `demo-golden`.
2. Ship a backend image with this change; set `WAFFLEBASE_DEMO_RESET_TOKENS`
   in `yorkie-team/devops` `k8s/wafflebase/deployment.yaml`.
3. Boot log should read `demo reset: 3 document(s) daily at 15:00 UTC`.
