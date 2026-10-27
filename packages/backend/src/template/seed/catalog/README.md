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

1. Add a `TemplateSeed` to the file for its document kind (`slides*.ts`,
   `sheets.ts`, `docs.ts`, `note-and-board.ts`), or start a new one. Themed
   slides decks use `themedDeck()` from `../builders`.
2. Register it in `index.ts`.
3. For a slides template, add its brief — the values an author should collect
   — to the matching `briefs-*.ts` and register it in `briefs.ts`. A list or
   pairs field may not ask for more rows than the slide it fills has.
4. `pnpm backend test -- seed` — the catalogue test runs every seed through
   the same validators `PUT /documents/:id/content` applies, so a malformed
   payload fails there rather than half-way through a seed run; the brief test
   checks each brief against its template.

`slug` is the seed's identity and must never change: it is how a re-run finds
the document it created last time instead of publishing a second copy.
