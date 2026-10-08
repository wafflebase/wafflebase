# PPTX package-root-relative relationship targets

Issue: https://github.com/wafflebase/wafflebase/issues/1085

## Plan

- [x] Fast-forward local main to upstream and create a fix branch.
- [x] Add failing resolver and chart import regression tests.
- [x] Resolve targets starting with `/` against the package root.
- [x] Run PPTX tests, slides typecheck, and `pnpm verify:fast`.
- [x] Review the full diff and record findings and validation.
- [x] Commit locally as two commits: task documents, then the fix and its tests.
- [x] Push the branch to the fork (`origin`). The PR is not open yet.

Preserve unrelated untracked documents. Keep existing relative-path and external
URL behavior. No public API, dependency, or architecture changes are needed.
