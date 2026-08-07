# Lessons — Fix Dependabot alerts (2026-08)

## Count the packages, not the alerts

39 open alerts looked like 39 problems; they were 13 packages and 4 kinds
of fix. Group the alert list by package name first — several advisories
land on the same package (brace-expansion had 3 CVEs across 3 major
lines), and one override bump closes all of them at once.

## Stale overrides are the default failure mode here

Every alert sweep leaves `pnpm.overrides` pinned at *that* sweep's patched
version. The next CVE on the same package matches again, because the pin
is a floor, not a ceiling. Before writing a new override, check whether
one already exists for the package and just needs its range and target
bumped — that was 25 of the 39 alerts.

## Try the plain update before forcing an override

`scripts/agent` looked like it needed a forced `@hono/node-server` v2
override against `@modelcontextprotocol/sdk`'s `^1.19.9`. It didn't:
`npm update` moved the MCP SDK 1.29.0 → 1.30.0, whose range had already
been widened to `^1.19.9 || ^2.0.5`, and the patched line resolved on its
own. Forcing a major across a dependency's declared range is a last
resort — check whether the intermediate package already made room.

## A missing patch is a scope question, not a dead end

Alert #134 (react-router RSC CSRF) is patched only in 8.3.0. Instead of a
major upgrade, check whether the vulnerable subsystem is reachable: the
app mounts a plain `BrowserRouter` and imports no RSC API, so the finding
does not apply. Dismiss with that evidence recorded, and note the
condition that would make it apply again.

## Re-test the inherited "can't fix this" note

The 2026-06 sweep left 3 vite alerts open with "forcing vite 6 breaks the
docs build", and this sweep copied that conclusion forward without
checking. It was wrong — widening the override to `vite@>=5.0.0 <6.4.3`
builds the docs site cleanly on vitepress 1.6.4. A residual carried across
sweeps is a hypothesis with an expiry date, not a fact: the surrounding
versions move even when the blocked package doesn't. Spend the five
minutes to re-run the experiment before copying the note again.

## Verify against the lockfile, not against the diff

"I bumped the override" is not proof. Cross-check each alert's
`vulnerable_version_range` against the versions actually resolved in
`pnpm-lock.yaml` / `package-lock.json` with `semver.satisfies` — it takes
one script and catches both overrides that failed to apply and packages
resolved at multiple versions where only some got patched.

## A verify:fast failure right after `pnpm install` is probably stale dist

`pnpm verify:fast` failed on a slides typecheck error
(`stepSelectionFontSize` missing on `TextBoxEditorAPI`) immediately after
a dependency-only change. Cause was `packages/docs/dist` built weeks
earlier — consumers typecheck against built `dist`, not `src`. Rebuild the
producer package (`pnpm --filter @wafflebase/docs build`) before
suspecting your own change.
