# Replace the design editor + debug report with Impeccable

Remove `@wafflebase/design-editor`, `packages/design-sandbox` and
`@wafflebase/debug-report` (plus everything that only existed to serve
them) and adopt [Impeccable](https://impeccable.style) (Apache-2.0) as the
project's design tooling, installed per-project with `npx impeccable install`.

## Decisions

- The `scripts/agent/report-*` pipeline and `/report-intake` only consume
  debug-report bundles, so they go too.
- `packages/frontend/src/debug/` (surface registry + locators) goes, and
  its callers in docs-view / sheet-view / hunt page are stripped.
- `packages/core/scripts/preview-tokens.mts` only served the editor; removed.
- Impeccable is committed into the repo (`.claude/skills/impeccable/`) so
  every checkout and agent session gets it.

## Todo

- [x] Delete the three packages, `scripts/design.mjs`, `scripts/design-pr.mjs` (+ test)
- [x] Delete `scripts/agent/report-*`, lenses, fixtures, `.claude/commands/report-intake.md`
- [x] Delete `.claude/skills/design-changes-to-pr`, `.claude/skills/design-sandbox-bringup`
- [x] Frontend: vite plugin + aliases, `App.tsx` mount, `src/debug/`, view callers, package.json
- [x] Core: `preview-tokens.mts` + test
- [x] Root scripts, `knip.json`, `harness.config.json`, `verify-self.mjs`, `.gitignore`
- [x] Script tests pinned to the removed lanes/paths
- [x] Docs: design docs, design README index, agent-pipeline, harness-engineering, walkthrough, READMEs, CONTRIBUTING, docs site
- [x] Install Impeccable; document it
- [x] `pnpm install` (lockfile), `pnpm verify:fast`
- [x] Self review, PR

## Review

- Impeccable 4.9.0 installed with `--project --providers=claude --no-hooks`.
  The detector hook was left off: it runs on every edit in every agent
  session, including the cloud pipeline, and is one `/impeccable hooks` away.
- `.claude/skills/impeccable/scripts/bin/` (18 MB engine) is gitignored; the
  launcher fetches and checksum-verifies it on first run.
- `docs/design/agent-pipeline/walkthrough/` deleted: every page covered only
  the two removed tools.
- `renderTokensCssFrom` kept in core: the seam is cheap and its tests still
  exercise the emitter; only the editor-specific comments were rewritten.
- `pnpm verify:fast` green (after `pnpm build` refreshed stale engine dist).

