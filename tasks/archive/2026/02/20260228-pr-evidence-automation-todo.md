# Phase 20: PR Evidence Trust Automation

## Goal

Replace manual verification evidence paste in PRs with automated CI-driven
trust: artifact upload + auto-comment with per-lane results.

## Tasks

- [x] Add `actions/upload-artifact@v4` to verify-self job (`if: always()`,
      14-day retention)
- [x] Add `actions/github-script@v7` to verify-self job — post/update PR
      comment with per-lane verify:self results table
- [x] Add `actions/github-script@v7` to verify-integration job — update PR
      comment with integration result
- [x] Simplify `.github/PULL_REQUEST_TEMPLATE.md` — remove manual evidence
      paste, reference automated CI comment
- [x] Update `design/harness-engineering.md` — Phase 20 completed, v1
      criteria #3 marked Done
- [x] Create task files, archive, commit

## Done Criteria

- CI uploads `.harness-reports/` as artifact on every run
- PRs receive auto-comment with per-lane status table
- Integration result appended to same comment after verify-integration
- PR template no longer requires manual evidence paste
- Harness v1 completion criteria all marked Done
