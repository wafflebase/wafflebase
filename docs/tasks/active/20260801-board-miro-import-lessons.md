# Board Miro Import (SP3) — Lessons

Companion to `20260801-board-miro-import-todo.md`. Design:
`docs/design/board/board-miro-import.md`.

## Context

SP3 of the board infinite canvas: import a Miro board into a new `"board"`
document via the Miro REST v2 API. A one-shot pasted access token is used
backend-only and never stored; a pure mapper in `@wafflebase/board` turns the
Miro JSON into `ElementInit[]`; persistence reuses `applyImportedContent`.
Built via subagent-driven development — 8 tasks, each independently reviewed
(5 of 7 implementation tasks needed a fix round), plus an Opus whole-branch
review that found two Critical defects the per-task reviews structurally could
not see.

## Lessons

### Verify a third-party API's shape before designing against it

The first draft of the spec assumed `GET /boards/{id}/items` returned
connectors. It does not — connectors live on a **separate** paginated endpoint
(`/v2/boards/{id}/connectors`), and `connector` is not even a valid `type`
filter on `/items`. Had this reached implementation, every imported board would
have silently lost its arrows, and the loss would have looked like a mapper bug
rather than a missing fetch. Two other facts surfaced from the same check:
image URLs require the bearer token and **expire in ~60 seconds** (so the
re-host must happen inside the same request), and sticky colors are **named**
(`light_yellow`) while shape colors are **hex**. Research the API before the
design hardens, not while debugging.

### Layer-local tests can all pass while the layers don't compose

This is the big one. Every task shipped with green tests, and the final review
still found two Criticals — both exactly at a seam:

1. **The mapper's ids were fiction.** `mapMiroItems` assigned its own ids and
   pointed connector endpoints at them, but `YorkieBoardStore.addElement` mints
   its **own** id and spreads it last (`{...clone(init), id}`), discarding the
   caller's. The applier threw away `addElement`'s return value. Result: every
   arrow referenced an id absent from the document, collapsed to a ~1×1 frame at
   the world origin — invisible, far from the content — under a **success**
   toast.
2. **The image URL was relative.** The backend returned `/api/v1/...`; the
   native upload path runs the same value through `resolveImageUrl` to make it
   absolute precisely because the frontend and backend are different origins in
   both dev and prod. The Miro path skipped that, so every imported image 404s
   permanently — persisted into the CRDT, no self-healing.

Each layer's tests were internally consistent and *proved nothing about the
seam*: the service asserted the URL string it emitted; the mapper took that same
string in **as a literal** and asserted it came out; the applier stubbed
`addElement` to return the constant `"new-id"` — which is precisely the shape
that made the id bug unobservable.

- **Rule:** when a feature spans N layers, at least one test must span all N.
  Here one composition test (backend fixture → mapper → applier against a real
  in-memory store) failed 4/4 pre-fix and named both defects.
- **Rule:** a test double that returns a constant where production returns a
  *generated, meaningful* value is not a stub, it's a blindfold. Make doubles
  mint distinct values.
- **Rule:** if a value crosses a module boundary, assert its *contract*
  (absolute URL, resolvable id), not that a string survived the trip.

### Per-task review scope is a structural blind spot, not a quality problem

The task reviews were genuinely good — they caught a `URIError` escaping as a
500, an unbounded pagination loop, prototype-chain lookups on untrusted keys, a
dropped `stalled` note, and an unjustified divergence from the shared `assertOk`
helper. None of them could catch the two Criticals, because each is invisible
inside a single task's diff. Budget for a whole-branch review that traces a
value end to end; it is not redundant with the per-task gates.

### Make an injected dependency required, not defaulted

The fix for the relative-URL bug threads a `resolveImageUrl` resolver into the
pure mapper. It was made a **required** field on the input type rather than an
optional one with an identity default — because a defaulted identity is exactly
the invisible-at-the-call-site shape that shipped the bug in the first place. A
required field turns a future missing call site into a compile error.

### Push back on the controller when the suggestion is wrong

Two implementers pushed back and were right both times. On the pagination hang,
the suggested fixed page cap (`ceil(MAX_ITEMS/PAGE_LIMIT)+1`) assumes full
50-item pages and would silently truncate a real board served in smaller pages;
the implemented no-forward-progress guard bounds iterations as a *derived*
property instead. And when a shared helper "broke" a test, the right fix was the
test double, not production code — a reviewer caught that one going the wrong
way. A dispatch is a hypothesis, not an order.

### A plan can carry the bug it was written to prevent

The plan's connector fallback passed each endpoint **its own** Miro id to the
"other side's centre" helper, so the lookup always missed and returned `{0,0}` —
stranding connectors at the world origin, the precise failure the spec's own
prose said to avoid. The reviewer flagged it as plan-mandated, which routed it
to a human decision (skip + report, since Miro exposes no absolute coordinate
for an unmapped end) rather than a silent patch. Reviews must be free to find
the plan wrong.

### Untrusted JSON reaches further than it looks

`SHAPE_MAP[name]` and `STICKY_HEX[named]` indexed plain object literals with
strings straight from the Miro payload, so `'constructor'` resolved through the
prototype chain and returned the `Object` constructor **with `known: true`** —
a non-`ShapeKind` value headed for the CRDT. `tsc` cannot see this because
`Record<string, T>` doesn't model prototype fallthrough. Own-property guards on
any map keyed by external input.

### The credential discipline held — and it was designed in, not bolted on

Deciding up front that the token is one-shot and backend-only removed a whole
class of work (no Prisma model, no encryption-at-rest, no connection CRUD, no
refresh flow) and made the review tractable: the final reviewer traced the token
from the dialog input to the Miro `Authorization` header and found no path to a
log, a response, an error string, the CRDT, or the browser after submit. The one
gap found was the *image* fetch — the single hop whose URL comes from upstream
JSON rather than our own code — which is exactly where an allowlist was missing.
When handling a secret, audit the hop whose destination you don't control.

## Verification notes

- `pnpm verify:self`: all 11 lanes green. Chunk gate bumped 144 → 145 (the
  applier importing `YorkieBoardStore` makes it a second importer alongside
  `board-view.tsx`, so Vite hoists it into its own shared chunk; the dialog,
  its summary formatter, and the mapper all fold into the existing
  `document-list` chunk).
- Suites: backend 373, board 33, frontend 940 — including the cross-layer
  composition test that fails 4/4 against the pre-fix code.
- Frontend `tsc --noEmit` verified clean by the controller (a fix report claim
  of pre-existing type errors did not reproduce).

## Deferred follow-ups (none block merge)

- 5000 elements in one Yorkie change can hit the SDK's document-size limit;
  consider chunking above a threshold.
- `generateId()` is an 8-char UUID slice ⇒ ~0.29% collision probability at 5000
  elements, with no detection or retry. Pre-existing board-wide property, not
  introduced here.
- `miroHtmlToBlocks` drops empty intermediate paragraphs (blank lines, not
  words) — an explicit best-effort position.
- Arrowhead start/end default asymmetry: an undefined `endStrokeCap` still
  yields an end arrowhead. Miro's documented default *is* an end arrow, so this
  is probably correct — confirm against a real board.
- Image re-host follows redirects. `undici` strips `Authorization` cross-origin,
  so the token cannot reach the hop, but a Miro-side open redirect could still
  make the backend issue an unauthenticated GET to an internal address. Hard
  containment would need a manual redirect loop; the trade-off is documented
  in-code.
