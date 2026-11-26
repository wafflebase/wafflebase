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

## Layout

Templates live in one file per family, under a directory per document kind:

```
catalog/
  <kind>/<family>.ts          # kind: slides | sheet | doc | note | board
  slides/<family>.briefs.ts   # the briefs for slides/<family>.ts
  index.ts                    # one import per <kind>/<family>.ts
  briefs.ts                   # one import per slides/<family>.briefs.ts
```

Each family file exports `seeds: TemplateSeed[]`, listing its templates in
gallery order; each briefs file exports `briefs: TemplateBrief[]`.
`index.ts` and `briefs.ts` know files, never templates.
`catalog-files.spec.ts` checks that the files on disk and the files imported
are the same set, so a file nobody registered fails the test rather than never
being seeded. Jest and `nest build` offer no runtime glob, so that test is the
glob.

## Adding one

1. **To an existing family**: add a `TemplateSeed` to the file and append it
   to that file's `seeds` array. Nothing else changes.
   **As a new family**: create `<kind>/<family>.ts` (lower kebab case) ending
   in `export const seeds: TemplateSeed[] = [...]`, then add one import to
   `index.ts`, keeping the imports sorted, and append its `...seeds` to the
   **end** of `TEMPLATE_CATALOG`.

   A new template may therefore land between existing ones (appending to a
   family that is not last puts it before every later family). That is
   allowed: a seed is found by its slug, never by position.
   `catalog.spec.ts` pins only the *relative* order of the templates that
   already exist — never rename, drop or reorder one of those.

   Themed slides decks use `themedDeck()` from `../../builders`. Board
   templates build sections and stickies with the helpers in
   `board/sections.ts`, which write the markers a board client reads
   (`boards.spec.ts` pins them).
2. For a slides template, add its brief — the values an author should collect
   — to `slides/<family>.briefs.ts` beside it and append it to that file's
   `briefs`. A new family's briefs file gets one import in `briefs.ts`, in the
   same order `index.ts` uses. A list or pairs field may not ask for more rows
   than the slide it fills has.
3. `pnpm backend test -- seed` — the catalogue test runs every seed through
   the same validators `PUT /documents/:id/content` applies, so a malformed
   payload fails there rather than half-way through a seed run; the brief test
   checks each brief against its template.

## Slugs

`slug` is the seed's identity and must never change: it is how a re-run finds
the document it created last time instead of publishing a second copy (the
seeded document id is derived from it). `catalog.spec.ts` asserts the shape:

- `^[a-z0-9]+(-[a-z0-9]+)*(\.ko)?$` — lower kebab case, `.ko` for the Korean
  variant of an English template;
- at most 48 characters;
- no theme or version in the slug, and never renamed or reused.
