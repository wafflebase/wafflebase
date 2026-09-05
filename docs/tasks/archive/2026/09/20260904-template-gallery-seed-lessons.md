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

## "There is no headless path" can mean "go through the browser"

Thumbnails were deferred because the backend has no canvas and every renderer
is in the browser. Both halves of that are true, and the conclusion — defer —
was wrong. The renderers being in the browser is not an obstacle to reaching
them; it is a *statement of where they are*. Driving the real UI got the
picture, the capture sizing, the WebP encoding, the notes special case and the
correct publish ordering, none of which had to be rebuilt.

Before deferring on "the code for this lives somewhere I am not", check
whether you can go there.

## Automating a UI means asserting on state, not on clicks

Two failures in one session, same root:

- The first run clicked Publish and Submit ten times and reported ten
  successes. The server had refused every submission; the product reports that
  as a toast and carries on, which is correct for a person and invisible to a
  script. **Read the outcome back from the database.**
- A 500 ms sleep after Submit passed ten times, then failed on the first item
  of the next run. **Poll for the state the click should produce**, with a
  deadline.

Also: log failed responses with their bodies. The message that actually
diagnosed the first failure was the server's own sentence, and until it was
logged the script only knew "expected pending, got listed".

## A feature can be half-built without anyone noticing

`description` had a column, a DTO field, a frontend API type, and two places
that render it — and no control anywhere that set it. Every listing published
through the product had `null`. Nothing failed; the feature just quietly did
not exist.

Working backwards from "reproduce the official procedure" is what surfaced it.
Asking what the real flow *can* express is a better audit than reading the
model, which looked complete.

## The env a server reads is the server's, not the script's

`YORKIE_AUTH_WEBHOOK_ENFORCE` was set on the seed process and checked by the
API process. Worse, `nest start --watch` respawned and dropped ad-hoc
variables, so the value was there for one run and gone the next. For anything
a *server* checks, put it in the server's `.env` and verify with
`ps eww -p <pid>` rather than assuming inheritance.
