# Lessons — Documentation Site Update for v0.6.0

## The docs site drifts silently between releases
The `packages/documentation` VitePress site is **not** in the `verify:fast`
chain and has no CI typecheck, so it can lag the product by several releases
with nothing flagging it. It had drifted to the v0.4.9 feature set — missing two
whole document types (Notes, PDF) and Sheets data validation. When doing a
release-based docs pass, diff the docs against the release-note highlights
(`docs/tasks/**/release-*-todo.md`) rather than trusting the site to be current.

## VitePress build is the real gate for docs changes
`pnpm --filter @wafflebase/documentation build` fails on dead internal links by
default, so a clean build proves every `[text](/path)` and sidebar `link:`
resolves. This is the check that matters for a docs-only change — `verify:fast`
doesn't exercise the documentation package at all.

## verify:fast failing on `tsx: command not found` = missing node_modules
The first `verify:fast` run died at `pnpm core build` with `sh: tsx: command not
found` and "node_modules missing". This is an environment-setup failure, not a
regression from the change (matches the existing memory note). `pnpm install`
fixed it and the re-run was green. Always check for this root cause before
suspecting the diff.

## Verify UI facts against the frontend, not just design docs
Design docs describe *intent* and often include deferred/roadmap phases. For
user-facing docs, the exact menu items, toolbar buttons, and shortcuts must come
from the shipped frontend (`document-list.tsx` New menu, `notes-toolbar.tsx`,
`pdf-collab.tsx`, `data-validation-panel.tsx`). A survey subagent reading the
frontend gave precise, current facts that the design docs alone would not.

## Scope by tag, not by `main`
"Update based on 0.6.0" means the v0.6.0 tag, not the tip of `main`. The notes
CLI namespace (#483) had already merged to `main` but landed *after* the tag, so
it was deliberately excluded from the developer docs to keep the pass aligned
with the release.
