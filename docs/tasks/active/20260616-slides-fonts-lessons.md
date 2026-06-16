# Slides Rich Fonts — Lessons

## Never `git stash` to "check baseline" with uncommitted WIP

While verifying that a batch of `tsc --noEmit` errors were pre-existing,
I ran `git stash` to compare against the committed state. `git stash`
silently swept all uncommitted tracked edits (the entire P0 catalog
change) into a new stash, leaving the tree looking reverted. Untracked
files (the generator + generated data) stayed, which made the partial
revert easy to miss.

**Why it matters:** a stash mid-task can read as "my edits vanished" and
trigger redundant re-work, or worse, edits made on top of the reverted
tree.

**How to apply:** to confirm whether errors are pre-existing, DON'T
stash. Either (a) run the same check on a fresh `git worktree` of
`origin/main`, or (b) reason from the error paths — if every error is in
files you never touched, they're pre-existing. Recover with
`git stash pop` immediately if you do stash by reflex.

## Generate the dangerous fields; don't hand-curate them

Font `weights` is a footgun: Google Fonts' css2 endpoint returns an
error CSS payload for an unavailable weight, and one bad family poisons
the whole `<link>`. Variable fonts hide their weight range in an
`axes { tag: "wght" }` block, not the static `fonts { weight }` entries,
so eyeballing the weight is unreliable. Deriving it from `METADATA.pb`
(static weights ∪ variable axis range, intersected with {400,700})
eliminated the error class the old manual `weights: '400'` overrides
were patching one-by-one.

**How to apply:** when a field has a correctness cliff and an
authoritative source exists, generate it from the source and commit the
output rather than hand-maintaining it.

## License lives in the repo, not the API

The Google Fonts webfonts REST API does not expose license. The
authoritative source is the `google/fonts` repo: the top-level dir
(`ofl`/`apache`/`ufl`) is the license, confirmed by `METADATA.pb`'s
`license:` field. Build-time generation captures it; runtime API calls
cannot.

## The exposed surface, not the data, was the real Slides gap

The catalog expansion (P0) added 104 families, but the Slides text-edit
toolbar had no font-family picker at all — only size/format/paragraph.
So "rich fonts" was invisible in Slides until the picker was wired in.
Lesson: when a feature spans data + UI, verify the UI actually exposes
it on every target surface (desktop + mobile) before calling it done.

## One IntersectionObserver rooted on the scroll container, not per-row

The dialog loads each row's web font on scroll-into-view. A single
observer (root = scroll container, `data-font-row` attribute → family)
recreated on `[open, results]` is simpler and cheaper than per-row
observers, and composes with `content-visibility: auto` (CSS paint
virtualization) to handle ~1,900 rows without a windowing library.

## Persist-across-open state in an always-mounted dialog

Radix unmounts `DialogContent` on close, but the dialog *component*
stays mounted, so its `useState` (search/filters) survives close. Reset
on the open transition or stale state leaks into the next open.

## Avoid the weight footgun without fetching 1,900 files

For the full library, fontsource's `google-font-metadata` gives the
exact weight array per family in one request, so the css2 `:wght@` spec
is derived (not guessed) for all 1,900 families. License (absent there
and from the REST API) comes from the google/fonts git-trees in four
requests. Per-family `<link>`s also contain any weight mistake to a
single family rather than poisoning a shared link.

## Frontend has no `tsc` gate — don't trust a raw `tsc -p`

`pnpm frontend` validates via `eslint` + `vitest` (esbuild transpile);
there is no `typecheck` script and `vite build` doesn't full-typecheck.
Running `tsc --noEmit -p tsconfig.app.json` directly surfaces ~110
pre-existing errors (Radix typings, readonly tuples) that are NOT part
of any gate. Use it only to scan for errors in *your* files, not as a
pass/fail signal.
