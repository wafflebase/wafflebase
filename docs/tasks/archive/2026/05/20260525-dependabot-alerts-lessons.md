---
title: Dependabot alerts — lessons
date: 2026-05-25
---

# Lessons — resolving Dependabot alerts via pnpm overrides

## 1. Override targets go stale; bump, don't trust the existing pin
Several alerts existed precisely because a prior `pnpm.overrides` entry
pinned a version that *later* got its own advisory (lodash 4.17.23,
serialize-javascript 7.0.3, brace-expansion 1.1.12 / 5.0.5). When
re-triaging, always diff the override's pinned version against the
advisory's `vulnerable_version_range` — a stale pin is itself a finding.

## 2. Verify the "first patched version" is actually a *good* release
Dependabot/GHSA said lodash's first patched version is **4.18.0**, but npm
deprecated 4.18.0 as a *"Bad release. Please use lodash@4.17.21 instead."*
The real fix is **4.18.1** (the current `latest` dist-tag). Before pinning
any patched version, run `npm view <pkg>@<ver> deprecated` and
`npm view <pkg> dist-tags`. Do not blindly trust the advisory's
`firstPatchedVersion`.

## 3. Manifest bumps don't always move transitive copies
Bumping `vite` to `^6.4.2` in the four app packages did **not** remove
`vite@6.4.1` — `vitest 3.1.1` carried its own copy. A scoped override
(`vite@>=6.0.0 <6.4.2` → 6.4.2) was required. After any dep bump, scan the
lockfile for *all* installed versions of the package, not just the
manifest.

## 4. Scope overrides by major line to avoid breaking pinned consumers
`esbuild@<0.25.0` → 0.25.0 had to apply to vitepress's vite 5 subtree
(esbuild 0.21.5) without breaking it — verified by building the docs site.
Conversely, `vite@>=6.0.0 <6.4.2` was deliberately scoped to the 6.x line
so vitepress's vite 5.4.21 stays put (it can't run on vite 6). Match the
override range to the advisory's affected major(s), and build the riskiest
consumer to confirm.

## 5. Verify the lockfile, not just the install
"Patched versions exist on npm" and "install succeeded" are necessary but
not sufficient. The authoritative check is a lockfile scan asserting no
installed version falls in any advisory's vulnerable range — run it before
claiming the alerts are resolved.

## 6. Working tree can shift under you mid-task
A new commit (#292, `@wafflebase/tokens`) landed on `main` mid-session and
the working tree switched to it, discarding uncommitted edits (only the
untracked task doc survived). Per the "don't over-diagnose the env"
feedback: rather than reconstruct the lost branch state, I rebranched fresh
from the current healthy `main` and re-applied the edits. Commit early on a
feature branch to avoid losing uncommitted work to a tree switch.
