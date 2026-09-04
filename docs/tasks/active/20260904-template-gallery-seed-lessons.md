# Lessons — template gallery seed

## "Free to use" is not "free to redistribute"

The request was "pull in some free templates". The obvious sources — Canva,
Slidesgo, Google Slides, Microsoft Office — are all free *to use* and none of
them are free to *republish*. Seeding a gallery from them would have put third
party IP into an Apache-2.0 repository, and the templates are content other
people copy, so it would have spread.

Say this before designing anything, not after. It changed the whole shape of
the work: authored-in-repo, with a licence statement next to the catalogue.

## `tsx` silently breaks NestJS dependency injection

esbuild does not emit `design:paramtypes`, which is where Nest reads
constructor parameter types. The symptom is not "decorators unsupported" — it
is `Cannot read properties of undefined (reading 'get')` deep inside an
unrelated provider, which reads like a config bug.

`ts-node` is the usual answer, but it is CJS and cannot require ESM TypeScript
from a workspace package. For a Nest entry point in this repo, **run the
compiled `dist`** — which is also what production does, so the seed exercises
the same artefact.

## A read path can make correct data look broken

Every formula cell was written correctly, with the right formula. The preview
still showed empty columns, because the calculator is async and needs a live
`Sheet` — nothing recalculates until an editor session opens the document.

The data was right and the screen was wrong, so no assertion about the *write*
would ever have caught it. Only opening the thing did. When seeding content
for a surface, look at the surface: "the write succeeded" is not "the reader
shows what I meant".

The fix — caching the evaluated value beside the formula — is what real
spreadsheet files do, which is usually a sign the constraint is genuine rather
than incidental.

## Don't hand-write a number a test can re-derive

The cached totals are hand-written, which is exactly the kind of thing that
rots when somebody edits a sample row. The test re-derives each total *from the
seed's own data* rather than restating the expected number, so editing a
sample and forgetting its total fails.

Then mutation-check it: flip one value and confirm the test goes red. A test
over fixture data is very easy to write in a way that passes no matter what.

## Prefer exporting the real validator over restating the contract

The catalogue test needed to know "is this a valid docs payload". The choices
were to re-assert the shape by hand or to export the three
`assertValid*Body` functions the v1 content controller already applies.
Exporting them is three words of diff and means the catalogue is checked
against the contract that actually gates the write path — a copy would have
drifted, and the drift would have surfaced mid-run against a live deployment.
