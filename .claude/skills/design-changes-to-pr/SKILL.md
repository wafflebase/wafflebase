---
name: design-changes-to-pr
description: Use after someone has changed something in the wafflebase design editor and wants it turned into a pull request — "open a PR for my design changes", "ship what I changed in the editor", or when `pnpm design-pr`'s generated title and body are too thin. Writes the title and body from the editor's own write log, then hands them to `scripts/design-pr.mjs`.
---

# Design changes → pull request

## Overview

`pnpm design-pr` already opens the pull request, with no model and no credentials
of its own. This skill improves **one thing**: the title and the body. Everything
else — the branch, which files are committed, the fork handling, the push — stays
in that script and must not be reimplemented here.

The split is deliberate. The loop has to close for a person who does not have
Claude Code, so the script is the mechanism and this is decoration.

## Read the intent, not the diff

The editor keeps a write log, and it is a better source than `git diff`:

```text
GET <the URL `pnpm design` printed>/__design-editor/api/transactions
→ { undo: [ { id, ts, labels: [...], files: [...] } ], redo: [...] }
```

`labels` are what the person *did*, recorded when each edit was staged:

- `Button: Background Color · hover`
- `--primary → butter.500`
- `palette.butter.500`

A diff cannot tell you that a changed class was the hover state of one variant
rather than a line that happens to differ. **Start here, always.**

Two things to know about the log:

- It lives in the **dev server's memory** and is deliberately not persisted, so it
  is gone once the editor is closed. If the fetch fails, say so and fall back to
  `git status` — do not present that list as precise.
- The port is whatever Vite printed — it takes the next free one when its default
  is busy. `pnpm design` records the real URL in
  `node_modules/.cache/wafflebase-design-editor/server.json`, which is where
  `design-pr.mjs` looks first; read it rather than assuming 5173.

Then read `git diff -- <the files the log names>` as the **evidence**. The labels
say what was intended; the diff confirms it landed and shows anything they miss.

## Write the title and body

**Title.** What changed, in the design system's own words. `Give the primary
button a softer hover` beats `Update button.tsx`. If several unrelated things
changed, name the largest and let the body carry the rest.

**Body.** Aim it at a reviewer who did not watch it happen:

- **What changed and why**, in design terms — the role, the component, the state.
  `--primary` moved from butter-600 to butter-500 because the hover state failed
  contrast against the card, not "changed a hex value".
- **What it affects.** A token edit reaches everything bound to that role; a class
  edit on a variant reaches every render site of that variant. The log names the
  files; say what that means.
- **What to look at** — the scene or component that shows it.
- **What was tried and reverted**, if anything.

Four sentences a reviewer can act on beat a wall of prose.

## Hand it to the script

Write the body to a file and call the script — never run `git` or `gh` yourself:

```bash
node ./scripts/design-pr.mjs --title "<title>" --body-file /tmp/design-pr-body.md
```

Add `--dry-run` first if anything about the change set is surprising; it prints
the plan and touches nothing.

The script then descends its own ladder — push rights, a fork, or a compare URL
when `gh` is not set up — and reports which rung it landed on.

## Refuse to guess

- Write log unreachable **and** `git status` empty → there is nothing to ship. Say
  so rather than inventing a PR.
- The working tree holds changes the editor did not make → the script already
  reports and excludes them. Mention them; do not add them to the commit.
- A file changed that no label explains → say that plainly. Something else wrote
  to the tree, and what to do about it is the reader's call, not yours.
