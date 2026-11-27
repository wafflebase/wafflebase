---
name: pr-before-after
description: "Use when a PR changes UI that renders on a phone: capture Before→After pairs at 393×659 and publish them for the PR body."
---

# PR Before → After

Script: `packages/frontend/scripts/capture-before-after.mjs` (`shoot` →
`compose` → `publish`). Local development only: `shoot` signs in by minting a
cookie with `JWT_SECRET` and reads the user from `DATABASE_URL` (environment,
else `packages/backend/.env`), so run `pnpm dev` first.

## Rules

- Shoot "before" on `main` before editing; shoot "after" on the branch.
- One side-by-side pair per affected surface.
- Default viewport is 393×659 (iPhone 16 with Safari toolbars). Add a 393×400
  pair (`--height 400`) when the soft keyboard matters.
- Do not use `--desktop` for PR pairs; `compose` lays out phone-width shots.
- Publish to an `assets/pr-<number>` branch, never the PR branch. Keep that
  branch after merge; the PR body links to it.

## Steps

1. Before, on `main`:
   ```bash
   node packages/frontend/scripts/capture-before-after.mjs shoot \
     --path /s/<id> --out before/share.png --user 1
   ```
   `--steps steps.mjs` runs `export default async (page) => {}` after the page
   settles to open the dialog or menu under test. Open context menus with a
   dispatched `contextmenu` event, not a real right-click.
2. After, on the branch: the same command with `--out after/share.png`.
3. Compose, one `--pair "Label|before|after"` per surface:
   ```bash
   node packages/frontend/scripts/capture-before-after.mjs compose \
     --out pr-assets --pair "Share dialog|before/share.png|after/share.png"
   ```
4. Publish once the PR number exists, then paste the printed Markdown into the
   PR body under "Before → After":
   ```bash
   node packages/frontend/scripts/capture-before-after.mjs publish \
     --pr 1170 --dir pr-assets
   ```
   Add `--dry-run` to preview without pushing.
