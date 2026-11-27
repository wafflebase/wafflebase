# Before → After captures for mobile UI PRs

Make every PR that changes UI a phone renders show side-by-side captures,
as PR #1170 did by hand.

- [x] `packages/frontend/scripts/capture-before-after.mjs`: `shoot` (signed-in
      393×659 touch viewport, optional steps module), `compose` (side-by-side
      pairs, optional crop), `publish` (orphan `assets/pr-<n>` branch + Markdown,
      `--dry-run`)
- [x] `CLAUDE.md` Task Workflow step 4: require the section and point at the script
- [x] `.github/PULL_REQUEST_TEMPLATE.md`: same rule for human PRs

## Review

- Smoke-tested on `main`: `shoot` with a steps module (Share dialog) and at
  393×400, `compose` with and without a crop, `publish --dry-run` printing
  the Markdown. The "before" capture from `main` shows the clipped Share
  dialog that #1170 fixes.
