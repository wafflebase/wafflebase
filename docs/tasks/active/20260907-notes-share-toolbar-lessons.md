# Lessons — notes share-link toolbar (issue #1044)

## A "deliberate scope cut" comment is a dependency, not a decision

`SharedNotesLayout` kept a cramped 50/50 split on phones and the code said why:
demoting it would leave no preview, because the route mounts no toolbar. That
reasoning was correct and still produced the wrong surface — the fix was to
remove the premise (mount the toolbar), not to argue with the conclusion. Worth
reading recorded rationale as "what this depends on" rather than "what was
decided".

## The 7px divider was never 7px

The issue described the split divider as "7px wide … keeping the 7px visual".
The engine sets `width: 7px` with `padding: 0 3px` and
`background-clip: content-box`, and Tailwind's preflight puts
`box-sizing: border-box` on everything in the app — so the content box, and
with it the painted band, is **1px**. 7px was the hit area all along. The fix
therefore widens the box to 25px and keeps the 1px hairline, rather than
growing a band to 7px as the issue's wording implies. Inline styles in an
engine that renders inside a Tailwind app inherit preflight; the engine's own
numbers do not tell you what ships.

## Extraction was the cheapest route to a test

The verification asked for `SharedNotesLayout` coverage, but
`shared-document.tsx` statically imports `SheetView`, `DocsView`, `NotesView`,
the pdf viewer and three `setImageUrlResolver` seams — importing it into a
jsdom test pulls all four engines. Moving the one layout that grew real state
into its own module made the test a normal component test with a single
`vi.mock` of `notes-view`. Single-importer modules fold into the importing
chunk, so the extraction costs nothing at the chunk gate.

## Session-local means "read, never write"

An anonymous share-link visitor should still get their own vim keymap and blame
gutter, so the layout seeds state from `notes-settings`' readers and never
calls the writers. "Don't touch the user's preferences" is not the same as
"ignore them" — the workspace route makes the same distinction for a mode
picked on a phone.

## Raising a gate cap is not free — it costs auto-promotion

The chunk-count cap was bumped 228 -> 231 as unmeasured headroom, with the
reason string honestly saying so and pointing at CI as the measurement. CI then
measured **225** — under the 228 that was already there, so no bump was ever
needed.

The bump was not merely redundant. `harness.config.json` is on
`CI_DEFINING_PATHS` (`scripts/agent/checks.mjs`), so gate 1b of the ready gate
refused to promote the PR: with the branch supplying part of the CI definition,
a green CI run is evidence about the *branch's* gate rather than main's. Three
of four gates passed and the PR sat as a draft with a green panel and nobody
watching, because the one loosened knob was the gate that had to stay honest.

Rule: never widen a budget in the same change that has not measured it. Push
without the bump and let CI report the real number — if it genuinely does not
fit, bump it then, with the measurement in hand and the knowledge that a human
now has to promote the PR by hand.

## Round 11: two of three blocking findings did not survive the code

Three code findings arrived (two more entries were `POOL_EXHAUSTED`
infrastructure failures, not defects). Verifying each against HEAD before
touching anything mattered, because two were arguing with code that no longer
existed or with a change this branch never made:

- **"Enforce-by-default denies viewer share links at attach"** — refuted. The
  finding quotes `checkAttribute` as `verb === 'rw' ⇒ needWrite`, which is the
  pre-`d708062bd` line; that commit is HEAD and it added
  `READ_GATED_METHODS`, so the expression reads
  `attr.verb === 'rw' && !READ_GATED_METHODS.has(method)`. The claim that the
  README and design doc were left unchanged is also wrong — both carry the
  read-gating explanation. Its "dispute adjudicated: upheld" carries no weight:
  the adjudicator session errored, so nothing read the code.
- **A viewer's `initialPresence` does not make `PushPull` `rw`** — the same
  finding's secondary claim. `attachDocument` calls
  `doc.update((_, p) => p.set(initialPresence))` *before* the RPC, so that
  change rides the attach pack. That is very likely *why* attach always carries
  `rw`. What is still unverified is whether a *later* presence-only change
  (a read-only visitor moving their caret) counts toward the Go server's
  `pack.HasChanges()`; if it does, the design doc's "a viewer who never edits
  pushes no changes → verb `r`" is too strong. Left alone deliberately —
  changing the verb handling is not this PR's business — but it is the thing to
  watch first in the shadow-mode rollout window.
- **The shared PDF viewer seeded the root as a `viewer`** — confirmed and
  fixed, and the mechanism is worth keeping.

## `initialRoot` is applied *after* attach, so a seed is a `PushPull`

The four `*InitialRootForRole` helpers (from #992) read as belt-and-braces
until you look at the SDK: `attachDocument` sends the change pack, applies the
server's, marks the document attached, and *then* runs
`doc.update()` for the `initialRoot` keys the root lacks. The seed is therefore
a local change carried by the **next `PushPull`** — verb `rw`, which the auth
webhook refuses for a viewer. So a viewer that seeds does not merely write
where it should not; under enforcement its sync is denied outright.

`PdfCollabProvider` was the one provider #992 missed, and it is the one this
branch made reachable: enforce is now the default, so a share-link viewer
opening a never-commented PDF would seed `comments` and then be 403'd. Fixed
by `initialRoot={readOnly ? {} : initialPdfRoot()}` — `readOnly` is already the
resolved role at both call sites (`false` on the owned route,
`role === 'viewer'` on the shared one), so no new prop was needed. The
regression test mocks `DocumentProvider` to capture the props it is mounted
with, which pins the *wiring* rather than a pure helper the provider could
stop calling.

## Say what a gate buys, not what you wish it bought

`assertYorkieAuthEnforced`'s comment claimed the webhook "refuses that token's
writes". Read-gating attach makes that false in one direction: a client can put
its change pack in the attach, and re-attaching repeats it, so the residual is
bounded per attach, not per client. The gate still decides the public template
tier — no visitor's *browser* can write, which is the cheap path that would
empty the gallery into the review queue — but the comment now says that
instead of the absolute. Same correction in the `READ_GATED_METHODS` comment
("one write" → one pack per attach) and in the design doc's Risks entry.
A doc-comment premise that overstates its guarantee is how a later feature ends
up resting on something that was never true.

## A presence publish is a write, everywhere — not just where we remembered

The `initialRoot` fix above chased one class of local change on a read-only
mount. Review found three more of the same class, all presence: PDF's
`onActivePageChange`, Slides' `broadcast()`, and Board's selection listener.
Each is a `doc.update()`, so each makes the next `PushPull` carry verb `rw` —
which enforcement refuses for a viewer, wedging their sync the first time they
scroll a page, change a slide, or click an element. Board had already gated
its *cursor* publish on `readOnly` and left its *selection* publish open two
hundred lines later, which is the shape of the bug: the guard goes on the
listener you were thinking about.

The rule worth writing down: on a read-only mount, nothing may reach
`doc.update()` — presence included. Losing presence costs a viewer's avatar its
page/slide number; losing sync costs them the document.

## An unscoped service credential is not made safe by "it never leaves"

The `yorkie-service` token's own doc comment argued its blast radius (every
document, read and write) was acceptable because it "never leaves the
process". That was simply false — the SDK sends it to whatever
`YORKIE_RPC_ADDR` names, on every RPC, and `copy-yorkie-documents.ts` sends
one side's to the *other* deployment's server. Fixed by scoping: the payload
carries a `key`, `decideService()` refuses any other document key, and
`YorkieService.withDocument` (which builds its client per document, so it
always knows the key) sets it. The ops scripts stay unscoped by necessity —
one client, many documents, and the SDK refreshes on the server's schedule
rather than per attach — which is now stated as the exception instead of being
the whole design.
