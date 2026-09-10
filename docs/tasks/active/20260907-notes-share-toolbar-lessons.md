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

## "Nothing may reach `doc.update()`" has to include the load-time migration

The rule above was written about presence and then applied only to presence.
Two load-time writes survived it, both reached before the user touches
anything:

- `ensureSlidesRoot` — a root `doc.update()` on *every* slides mount, shipped
  with a comment booking it as a known gap owned by "the doc-migration
  workstream". That booking was priced under shadow-by-default, where a stray
  viewer write is merely a stray write. With enforcement the default it is a
  denied `PushPull`, so the gap stopped being a tidiness debt and became a
  viewer who cannot open a shared deck. It also was never only about empty
  decks: the themes/masters/guides/`meta.themeId` backfill fires on any
  unmigrated pre-v0.5 deck. Skipping it costs nothing, because
  `YorkieSlidesStore.read()` runs the same backfill in memory through
  `migrateDocument` — the CRDT write was only ever persisting a computation
  the read path repeats.
- `recalculateCrossSheetFormulas` — `sheet-view` runs it unconditionally one
  tick after mount and on every remote change. It reads like a render pass;
  it is a write, because `calculate()` persists each formula's new cached
  value through the store. Gated at the engine (`Spreadsheet`, where every
  other mutator was already gated on `_readOnly`) rather than only at the call
  site, so the next caller cannot leak it again.

Generalized: the audit question is not "which handlers write?" but "which
`doc.update()`s run without a user gesture?" — seeds, migrations, backfills
and recalcs all answer yes and none of them are on an event listener.

## A signed-in viewer is not the same read-only case as an anonymous one

`CommentPopover` derived its read-only state from `currentUser === null`,
which is a test for *anonymity*, not for authority. A signed-in non-member on
a viewer-role share link therefore got the full compose / reply / resolve /
edit / delete UI, and the sheet's comment mutators are the one grid write path
that does not run through the engine's `readOnly` — the popover calls
`YorkieStore` directly. Fixed at both altitudes: an explicit `readOnly` prop
on the popover, and `assertWritable()` on the five comment mutators so a
future caller fails loudly instead of writing where the webhook will refuse
it. Being signed in is not authority over somebody else's document.

## "No catch" is a claim about the callers, so read the callers

Round 16 reported `assertWritable`'s throw turning a refused comment write
into an unhandled rejection "rather than a message". It does not. Every path
into those five mutators is awaited inside a `try`: `CommentComposer.submit`
catches for add / reply / edit (`components/comments/components/CommentComposer.tsx`),
and `CommentThreadCard` catches resolve and delete with a `toast.error`
(`CommentThreadCard.tsx`). `CommentPopover` is the only consumer, and it hides
those affordances under `readOnly` anyway.

What *is* true — and is the smaller, real observation buried in the finding —
is that the composer's catch only `console.error`s, so add/reply/edit fail
silently where resolve/delete get a toast. That asymmetry is shared with docs
and is not this branch's to change. A finding about error propagation is worth
one grep of the call graph before it is worth a code change: the fix here would
have been a `try/catch` added around code that already had one.

## A stale default in a design doc is load-bearing prose

Flipping `YORKIE_AUTH_WEBHOOK_ENFORCE` to enforce-by-default updated the two
operator-facing files (`packages/backend/README.md`, `self-hosting.md`) and
left three others asserting the old default — including `sharing.md`, which is
the canonical answer to "is a viewer's write refused on a stock deployment?".
The corpus then gave two answers, and the wrong one was in the document a
reader would reach for first.

The cheap check when a default flips: `grep` the variable across `docs/` and
`packages/*/README.md`, not just the files the change already touches. Note
that some of the hits are *correctly* unchanged — the template gallery
genuinely demands the literal `true`, deliberately stricter than the webhook's
own reading, and `assertYorkieAuthEnforced` says why. "Update every mention" is
as wrong as updating none; each hit has to be read.

## The cross-cutting rule belonged in the cross-cutting document

"Nothing on a read-only mount may reach `doc.update()`" was discovered here,
written down here, and then recorded only in `notes/notes.md` and
`slides-mobile.md` — the two per-feature docs that happened to be open. Meanwhile
`sharing.md`, which owns the per-type read-only sections and is where the next
person adding a document type will look, enumerated blocked *commands* and said
nothing about seeds, migrations, presence or recalcs. A rule filed under the
feature that found it reads as that feature's implementation note. It is now a
subsection of `sharing.md` with a table of the write paths that are not
commands, because those are the ones a new document type will miss.

## Recalculate-in-memory was the right question and the wrong change

The obvious repair for "a viewer renders a stale cross-sheet value" is to
recalculate without persisting. `YorkieStore` even looks ready for it: the
batch overlay already buffers writes and reads already consult it, so
retaining it past `endBatch()` would hold the recomputed values.

It is still wrong, and not merely because of the invalidation and lifetime
work. Nothing distinguishes a recalc write from a user write at the store, so a
permanent overlay would catch *every* ungated write on a read-only mount and
make it appear to succeed locally while never saving. That converts "refused"
into "silently local", which is strictly worse than a stale cached value and is
precisely the failure the read-only boundary exists to remove. The honest
outcome was to keep the gate, state the staleness window (narrow: an editor's
own edit propagates through `buildGlobalDependantsMap`; the residual is writers
that do not recalculate at all, i.e. the `/api/v1` cell endpoints), and say in
the comment why the tempting alternative was declined.

## Where a gate is testable decides which gate to test

The blocking finding asked for tests on two gates: the engine's
`Spreadsheet.recalculateCrossSheetFormulas` early return and `sheet-view`'s
`runRemoteSync(!readOnly)`. Only the first is reachable — the second lives in a
closure inside a `useEffect` of a component that pulls canvas, Yorkie and the
app's provider tree into jsdom.

That is not a coverage gap of equal weight, because the two gates are not of
equal weight: `runRemoteSync(!readOnly)` calls
`sheet.recalculateCrossSheetFormulas()`, which *is* the gated engine method. So
the engine gate is the boundary and the call-site gate is an optimization on
top of it. Testing the boundary covers the property; the untested gate can only
cost a viewer a wasted dependency pass. Both comments now say which is which,
so the next reader does not mistake the cheap gate for the load-bearing one.

## A widened hit area is a behaviour change to everything that reads it

Widening the split divider from a 7px box to 25px was filed as a touch-target
fix. It also multiplied an existing bug by 3.5×: the drag handler measured the
new ratio from the *pointer*, not from the divider's leading edge, so the first
`pointermove` re-centred the divider under the finger. At 7px that is a jitter
nobody filed; at 25px it is a visible snap. The offset is now recorded at
pointerdown and derived from `splitRatio` rather than read back from
`getBoundingClientRect()`, so a grab with no movement is exactly a no-op rather
than one flex-rounding away from one.

Generally: enlarging a hit area changes the range of `event.clientX - element.left`,
so every consumer of that difference is in scope for the change that widens it.

The same shape appeared again in round 17, one event further out: enabling
touch dragging (`touch-action: none`) does not just widen a range, it adds a
whole terminator. A mouse drag ends with `pointerup`; a touch drag can end with
`pointercancel` instead, which the handler had never needed to know about. Any
handler that mutates state outside itself — here `document.body`'s cursor and
`user-select` — needs an entry for every way its gesture can end, not just the
one the old input device produced.

## "The in-memory path covers it" has to name the specific reconciliation

Skipping `ensureSlidesRoot` on a read-only mount was justified with "`read()`
runs the same theme/master/layout/guides backfill in memory through
`migrateDocument`". Three of those four were true. The fourth — reconciling
`meta.themeId` against the deck's *own* `themes` array — existed only in the
CRDT-writing helper, because it is the one step that needs both the meta and
the resolved arrays, and `migrateMeta` sees only the meta. So the claim was
right about the shape of the data and wrong about one field, and the cost was a
throw (`getActiveTheme` refuses a mismatch by design) on the share route for a
deck that opens fine as an editor.

The rule this suggests: when a gate is defended by "an equivalent runs
elsewhere", enumerate the equivalent's steps against the gated code's steps.
"Same backfill" is a summary, and a summary is exactly where one branch hides.

## The sibling suite is the deliverable, not the inspiration

`YorkieDocStore`'s two `readOnly` gates went untested through sixteen rounds
while the spreadsheet store next door grew a whole read-only suite — with the
non-obvious technique already worked out (count `doc.update` calls, not emitted
changes, because an update that mutates nothing still is the write the webhook
sees attempted). Writing the docs equivalent took one file and no new harness.

When a review finds an untested gate and a directly-applicable harness exists,
the honest read is that the test was cheap and got skipped, not that it needs
scaffolding. The expensive ones are genuinely different — the presence gates
inside slides/board/pdf `useEffect` closures still need canvas, Yorkie and the
provider tree in jsdom — and keeping that distinction sharp is what stops
"deferred: needs a harness" from becoming a blanket answer.

## Mutation-check a split gate in both directions

`updateCursorPos` suppresses the presence write but deliberately keeps running
the caret anchoring that shares the method, because
`resolveAnchoredLocalCursor` is what holds a viewer's caret in place across a
peer's edit. A test that only deletes the gate proves half of that: it catches
the gate being removed, not the gate being "hardened" one line earlier, where
it would silently cost every viewer their caret position.

So the check was run twice — remove the gate (two tests red), and move it above
the anchoring (the other two red). A split like this is only pinned when both
mutations are covered, and the second is the one nobody thinks to try.

## A comment that names a caller should be checked against the caller

The `showAuthors` fallback was justified with "a mount that owns no view menu
(the revision preview)". The revision preview does not mount `NotesView` at
all — it calls the notes engine's `initialize()` directly, the same way it
mounts the sheets and slides engines. So the JSDoc offered a concrete reason
that could be checked in one grep, and it was wrong, which is worse than
offering none: the next reader takes it as evidence the fallback is live and
sizes their change around a caller that does not exist.

Two of round 17's three doc findings were of this kind, and both were claims
*this branch* introduced. Adding a surface (the share-link view menu) falsifies
every comment that described the old set of surfaces, and those comments do not
live next to the diff — `notes-settings.ts` said "the read-only shared viewer
does not use them" about a module the new layout now reads from. (Round 18
corrected that correction: a viewer mount reads *two* of the three keys, not
all three. See "A replacement claim is a claim too" below.)
Grep for the surface you just changed, not just for the code you touched.

## A replacement claim is a claim too

Round 17 replaced "the read-only shared viewer does not use them" with "the
share-link layout reads all three on mount — on a viewer mount as much as an
editor one". The replacement was also false: `shared-notes-layout.tsx` reads
the stored view mode behind `readOnly ? "view" : readViewMode()`, so a viewer
mount reads two of the three keys. The fix for a wrong comment was written from
the same summary that produced the wrong comment, one file away from the
three-line answer.

Writing a claim costs one sentence and reading the code costs one file. Any
comment that quantifies behaviour ("all three", "both mounts", "every caller")
is a claim about a set, and the set has to be counted at the code, not
remembered from the change that motivated it.

## Correcting a false claim is a grep, not an edit

Round 17 found the claim at `notes-settings.ts:7`, fixed that line, and left
the same class of claim in five other places — including 39 lines below in the
same file, and in `packages/documentation/`, where it was telling *users* that
the share-link note page has no view menu. Round 18 grepped the claim's
phrasings ("read-only shared viewer", "does not use them", "no view menu",
"all three", "remembered per browser") and found six occurrences.

A review finding names an instance because that is what the reviewer's eye
landed on; the finding is the class. The mechanical version: for a doc finding,
grep the false sentence's distinctive phrases across `packages/` **and**
`docs/`, and treat user-facing documentation as in scope — it decays the same
way source comments do and nothing typechecks it.

The privacy-relevant instance is the one worth remembering. `readShowAuthors`'s
JSDoc said the switch decides "whether this user's display name is recorded on
the lines they edit", so someone who never turns it on "leaves no name in its
content". `YorkieNoteStore.editText` stamps the name on every insert
unconditionally; the flag installs the gutter and its authorship walk, nothing
more. The correct statement was already written twice in the repo — in the
toolbar's own copy and in `writing-a-note.md`'s warning — so the module that
owns the key was the only place that got it backwards, and it got it backwards
in the direction that understates what a user leaves behind.

## A test whose name promises input has to use that input

Two of round 18's findings were the same defect in different suites: a case
named for a contrast that its body did not set up.

- "a read-only mount still reads peer presence" asserted
  `Array.isArray(getPresences())`. There were no peers in the document, so the
  assertion held whether the read half of the gate existed or not.
- "still backfills a writable mount of the same deck" built a fresh empty
  document, so it ran the `needsRoot` seeding branch rather than the
  backfill-on-an-existing-broken-deck branch — the whole point of pairing it
  with the read-only case.

Both passed, and both would have kept passing through the regression they were
written to catch. The check that finds this is the one round 17's own lessons
already prescribed for gates: mutate the behaviour the name describes and watch
the named test go red. Applied to a *pair*, it needs the input to be shared —
extract the fixture into a helper both halves call, and the contrast is
structural instead of asserted in a comment.

## Bounds-safe is not type-safe

`themes[0].id` was reviewed three times for the index and cleared three times:
the array is forced non-empty two lines above. The defect was in the `.id`. The
entries come off a CRDT read typed `any`, so a peer can write an entry with no
id, and the assignment then puts `undefined` into a field typed `string`.

`getActiveTheme` made that worse rather than louder: it resolves by
`find(x => x.id === meta.themeId)`, so `undefined === undefined` *matches* the
id-less entry and the deck renders from a theme with no palette instead of
failing with the error that names the missing id. A guard that keeps the
mismatch is better than a repair that fabricates a match — which is the same
judgement `migrateGuide` in that file already makes for a guide's `id` and
`position`.

Generally: when a review says "index out of bounds", answer the index *and*
read the expression's type. An `any` from the CRDT has no shape, and the
one-line hardening lives at the point where its value first crosses into a
typed field.
