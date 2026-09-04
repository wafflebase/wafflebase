# Lessons — homepage & docs audit

## Documentation drifts where the commit that changes code is not the commit that changes the doc

Every stale page in this audit was last touched by a *different* commit than
the code it describes. The one healthy developer page,
`developers/design-editor.md`, was last updated by `5b0edd169` — the same
commit that last touched `scripts/design.mjs`. That is the whole difference.

`developers/rest-api.md` documented 14 routes against 52 served because two
months of controllers landed without it. The fix is not a better audit cadence;
it is treating a doc that describes a subsystem as part of that subsystem's
diff.

## A doc can be wrong in the safe direction or the unsafe one, and only one is urgent

`sheets/datasources.md` said a connection belongs to its creator and that
collaborators run their own. Both halves were backwards: every handler gates on
workspace membership alone and the query runs against the creator's stored
credential. A reader made a *less* safe decision because of the page.

Compare `guide/collaboration.md`, which listed four share-link expiration
options where five exist. Also wrong — but the missing one was `No limit`, the
**default**, while the page advised short expirations for sensitive data. Both
were P0 for the same reason: the error ran toward less caution.

Rank documentation defects by which way the reader is pushed, not by how many
words are wrong.

## Correcting a page is exactly when a new false claim gets introduced

Three reviewers over this branch found 24 further defects, several created by
the corrections themselves. The homepage replacement for a fabricated feature
asserted the REST API writes cells back to a SQL tab — impossible three ways.
`rest-api.md` correctly found that cells writes have no type check and then got
the *consequence* wrong, reporting a harmless 404 where the real answer is a
200 and a phantom document.

Two habits that caught these: give the reviewer the specific failure mode to
hunt for ("a real capability stated without its gating condition"), and have
the fixer verify each finding rather than apply it — two of the review's own
details were wrong and were corrected back.

## Scope a fix by defect, not by section

The Critical finding on the follow-up PR was that the doc pass updated
`rest-api.md`'s Cells section and left the **Update Document** section one
heading away still describing the mass assignment the same branch had closed.
The prompt named "the Cells section", so that is what got fixed.

Name the *defect* and let the agent find every place it appears.

## Verification can be poisoned by the checkout it runs in

The task file claimed three real builds proved an unconfigured frontend build
falls back to localhost. It cannot have: the untracked `.env.production` files
were still on disk in that checkout, so every local build kept baking in the
upstream host. A reviewer caught it by building in a fresh worktree.

When a change is about a file's *absence*, verify it somewhere the file was
never present.

## What not to write is a finding too

Several things looked documentable and were not: BigQuery is registered in the
backend with zero frontend references, MySQL exists only as a design doc, and
Sheets has no XLSX export at all. A design doc is a proposal, and a backend
module is not a feature. Each audit prompt carried an explicit trap list, and
they earned their place.
