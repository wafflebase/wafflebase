# Shared debug-report bundle fixtures

Read by BOTH validators of the same format:

- `packages/debug-report/src/types.test.ts` — `parseBundle`, in the browser
- `scripts/agent/report-bundle.test.mjs` — `validateBundle`, in the pipeline

They cannot share code: `scripts/agent/` is a separate npm install outside the
pnpm workspace, so the pipeline cannot import the TypeScript package. These files
are what keeps the two from drifting instead — a rule that changes on one side and
not the other turns a suite red here rather than silently accepting a bundle the
other half rejects.

`bundle-valid.json` must be accepted by both. Everything under `invalid/` must be
rejected by both, for the reason its filename names.

Two of these were added after review found the drift they now cover — proof the
contract only holds for cases a fixture actually names:

- `invalid/group-without-pr-title.json` — `parseBundle` required `prTitle`;
  `validateBundle` never checked it, so a bundle from a non-browser producer
  passed intake and then killed PR assembly on `group.prTitle.slice`.
- `invalid/no-items.json` — `validateBundle` refused an empty bundle while
  `parseBundle` returned `{ ok: true, items: [] }`, so a batch whose every item
  was discarded would have been written, cleared from the session, and refused
  downstream: a report destroyed behind a success message.
