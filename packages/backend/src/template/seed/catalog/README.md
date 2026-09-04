# Template catalogue

The templates the public gallery is seeded with (`pnpm backend seed:templates`).

## Licensing

**Every template in this directory was authored for Wafflebase and is covered
by the repository's Apache-2.0 licence.**

That is a requirement, not a description. A template is content other people
copy into their own workspaces, so anything here has to be redistributable —
which rules out the obvious sources. Canva, Slidesgo, Google Slides and
Microsoft Office template galleries are *free to use*, not *free to
redistribute*: their designs are copyrighted and their terms forbid
republishing them. Nothing derived from them may be added here.

When adding a template, it must be either:

- written from scratch for this repository, or
- taken from a source whose licence explicitly permits redistribution and
  modification (CC0, CC-BY with attribution recorded below, MIT, Apache-2.0).

## Attribution

None: everything here is original to this repository.

## Adding one

1. Add a `<slug>.ts` exporting a `TemplateSeed`.
2. Register it in `index.ts`.
3. `pnpm backend test -- seed` — the catalogue test runs every seed through
   the same validators `PUT /documents/:id/content` applies, so a malformed
   payload fails there rather than half-way through a seed run.

`slug` is the seed's identity and must never change: it is how a re-run finds
the document it created last time instead of publishing a second copy.
