---
title: debug-report
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Debug Report

## Summary

The issue tracker asks the reporter to do the translation. Turning "the padding
here is too tight" into a filed issue means writing reproduction steps, finding
the file, picking labels — work that costs more than the observation did. So
most observations are never filed, and the ones that are arrive after the
context that produced them is gone.

Debug Report hands that translation to an agent. **A person supplies coordinates
and curation; the agent supplies translation, verification and assembly.** A
hotkey opens a debug mode over the running app; the reporter points at what is
wrong (`capture`) or drags a box around it (`region`), types one sentence, and
repeats. Handing the batch over once opens a preview holding **issue text the
agent wrote** and **a proposal for how the batch splits into PRs**. The person
edits, confirms, and from there the pipeline verifies each item and lands it as
a PR or files it as an issue. Every outcome comes back to the same panel.

This is the generalisation of the agent loop originally planned as the design
editor's Phase 4. The design editor becomes a second `HostAdapter` host
(see [design-editor-local-plugin.md](design-editor/design-editor-local-plugin.md))
rather than the only one, and the harness side of the loop is
[harness-engineering.md](harness-engineering.md) Phase 32.

### Goals

- A report costs the reporter one hotkey, one point, one sentence — no file
  paths, no labels, no reproduction prose.
- The reporter stays the author. The agent drafts; the person edits the draft
  and confirms it before anything leaves the browser.
- Report from where the defect is visible, including the Canvas surfaces
  (sheets, docs, slides, board) where the accessibility tree sees nothing.
- Report a state that only exists while it is held — a hover tooltip, an open
  menu, a drag in progress. Reporting must not be the thing that destroys it.
- One batch lands as few, homogeneous PRs — related spacing fixes reviewed
  together, a logic fix on its own.
- Every outcome returns to the panel that sent it, including the ways the
  pipeline had to deviate from what the person approved.

### Non-Goals

- **Autonomous filing.** Nothing is filed that a person did not confirm.
  `hunt-ui`'s own findings do not enter this path; it still files nothing.
- **Replacing the visual regression lane or the issue hunters.** This channel
  carries what a human noticed; those carry what a machine noticed.
- **Screenshotting the DOM.** DOM targets are described by selector, box and
  text excerpt. Only Canvas pixels are captured, because Canvas has no other
  description.
- **A model key with tools in the deployed app.** See *Credentials*.

## Proposal Details

### The flow

| # | Step | Where |
| --- | --- | --- |
| 1 | Reporter notices something wrong in the running app | browser |
| 2 | `Mod+Shift+Y` → aim → `c` captures (or click) → one sentence | browser |
| 3 | Collect several; a floating badge counts them | browser (session + store) |
| 4 | Hand over once → **agent-written issue text + proposed PR grouping** | `HostAdapter.draft()` |
| 5 | Reporter edits sentences, regroups, drops items, confirms | preview panel |
| 6 | Verification: reproducible reports replay, appearance reports render | `scripts/agent/` |
| 7 | Land as PR(s), file as issue(s), or comment on an existing issue | `scripts/agent/` |
| 8 | Outcomes — including grouping deltas — return to the panel | `HostAdapter` |

Step 4 is the load-bearing one: the draft is written **before** the person
confirms, because the thing they are confirming is the issue text. That places
one model call at preview time, which is why *Credentials* splits the two
credentials this feature needs.

### Package boundary

```text
@wafflebase/debug-report            core: types, session, store, HostAdapter,
                                   capture geometry, promotion rules
@wafflebase/debug-report/react      overlay, preview panel, capture assembly,
                                   point→target resolution, dev host adapter
@wafflebase/debug-report/plugin     the two dev-server endpoints, as a Vite plugin
@wafflebase/debug-report/testing    helpers for a host testing its own wiring
packages/frontend/src/debug/        wafflebase only: sheet + doc locators, the
                                   surface registry, route rules, the mount
scripts/agent/report-*.mjs          intake, verification, PR assembly, round-trip
packages/backend/src/debug-report/  SP2 only: mailbox + re-hosted draft endpoint
```

**Everything a host must supply is an argument, not an import.** There are two:
the route it reports, and `locateOnCanvas` — point to semantic address, which
only the mounted engine can answer. `locate.ts` used to import the sheet and doc
locators directly, and that single line was what tied the overlay to this
repository. A host that omits the locator gets a region for every canvas point,
which is the correct answer for a surface nothing outside it can interrogate.

React is a peer dependency of `/react` alone. A host with its own UI, or none,
implements `HostAdapter` against the core and loads none of it. `/plugin` is
separate for a different reason: it runs in Node, reads a model credential and
writes to disk, none of which belongs in a module the browser can reach.

Nothing in the package names an application — not the core, and not the UI. A
second host installs `/react`, supplies a route and a canvas locator, and has the
whole loop; it does not reimplement the overlay.

That is a correction to an earlier version of this design, which put the overlay
and the panel in `packages/frontend` and claimed reusability on the strength of
the core alone. `HostAdapter` makes the TRANSPORT replaceable; it does nothing
about the UI, so the reusable thing was a model and a seam while the part a
person actually touches was welded to this repository. The move was made before
that shipped rather than after, since the PRs above it build on these paths.

The package exports source and has no `dist`, the same arrangement
`@wafflebase/design-editor` uses; it reaches production the way
`sheets`/`docs`/`slides` do, through the frontend's source alias. It is therefore
**not** registered in `scripts/verify-dts-entries.mjs`, which checks the
declaration graph of the packages that publish a `dist`.

### Data model

A `DebugItem` is one observation: what was pointed at, what the reporter said,
and what the pixels looked like.

```ts
type Target =
  | { kind: 'dom'; selector: string; tag: string; text?: string; rect: Rect }
  | { kind: 'canvas'; surface: string; rect: Rect; address?: string }
  | { kind: 'viewport'; rect: Rect };

type Capture = {
  id: string;
  w: number;
  h: number;
  bytes: number;
  layers: number;
  mime: string;                 // required: the store writes it, the parser checks it
};

type DebugItem = {
  id: string;
  createdAt: number;
  note: string;                 // the reporter's sentence — the ground truth
  target: Target;
  capture?: Capture;            // metadata only; the blob lives in the store
  disposition: 'verify' | 'publish' | 'discard';
  agentCandidate: boolean;
  draft?: Draft;                // filled in at preview time
};
```

A `Bundle` is what crosses the boundary: the items plus the environment they
were observed in — build SHA (without it the agent does not know which code it
is reading), route with document ids anonymised, viewport and DPR, theme, user
agent, document type, the reporter's role.

`parseBundle` is **fail-closed** over the serialized bundle: an unknown
`disposition`, a missing `note`, an optional field that is present but malformed,
or an unrecognised schema version is a rejection, not a repair. The pipeline
downstream can create commits; a bundle it cannot fully understand is one it must
not act on.

It cannot check that a capture's **blob** exists — it is handed the bundle value
and nothing else, and the blob lives in IndexedDB. A capture whose blob is gone
is caught by the store's load-time reconciliation, which drops the metadata and
names the affected reports rather than leaving the badge claiming an image that
is not there.

### Session and storage

The session is a singleton with no React state — the pattern is
`packages/frontend/src/app/slides/zoom-controller.ts`. It holds the mode
(`off` / `idle` / `region`), the items, and a subscription list. The
overlay and the panel both subscribe imperatively, so neither depends on the
other's render cycle, and a re-render never drops a collected item.

Storage is split by size:

- **Blobs → IndexedDB.** A DPR-2 Canvas `toDataURL()` is megabytes; three of
  them exhaust the 5–10 MB `localStorage` quota, and the failure mode is an
  exception in the middle of collecting.
- **Metadata → `localStorage`.** Small, synchronous, survives a reload, and can
  be read before the async blob store opens.
- **A quota guard evicts the oldest capture first and says so in the panel.**
  Silent eviction would mean a reporter confirming a bundle whose pixels are
  gone. The item survives its capture: the sentence is the part that matters.

Both backends sit behind interfaces (`BlobBackend`, `MetaBackend`) with in-memory
implementations, so the eviction and recovery logic is testable without a browser
and a private-mode profile that refuses IndexedDB degrades to memory rather than
throwing.

### Capture, and what SP0 measured

The spike (throwaway, run 2026-08-21 on `/harness/hunt?surface=sheet` and
`/login`) answered the question that cannot be answered on paper — whether
reporting feels natural in the hand — and returned four findings that changed
this design:

1. **`elementsFromPoint` cannot find a Canvas.** Both sheet canvases compute to
   `pointer-events: none` with events handled on their wrapper `div`;
   `document.elementsFromPoint()` at the grid centre returned four divs and zero
   canvases. A hit-test locator would have captured nothing on exactly the
   surfaces this feature exists for. The locator queries the DOM instead —
   `querySelectorAll('canvas')` plus box containment.
2. **Canvas layers must be composited.** The sheet stacks a grid canvas and an
   overlay canvas on one box; capturing either alone loses the content or loses
   the selection.
3. **`elementFromPoint` returns a glyph.** Pointing at the theme toggle resolved
   to `svg.lucide-sun`. A pick promotes to the nearest meaningful ancestor
   (`button, a, input, select, textarea, label, [role], [data-testid],
   [aria-label]`), because pointing at a control means the control.
4. **On a Canvas surface, `pick` must not fall back to the DOM.** With nothing
   meaningful to promote to it grabs the container and produces a 1280×721
   photograph of the whole sheet — which does not say *which cell*. On Canvas,
   `pick` routes to the engine locator, and until one answers it degrades to a
   small automatic region around the cursor, never to the container.

Driving the same spike by hand on 2026-08-23, across all eight surfaces that
open without a login, added three more — the first of which is a requirement the
plan did not have:

5. **A state that disappears cannot be reported by clicking.** A hover tooltip,
   an open dropdown and a drag in progress are all destroyed by the very click
   `pick` asks for, and the overlay made it worse: swallowing pointer events at
   capture phase meant the app underneath stopped tracking hover and never saw
   the `mouseup` of a drag already under way. So **capture is triggered by a
   KEY, and the overlay observes the pointer passively while idle** — no
   `preventDefault`, no `stopPropagation`. A keypress does not move the pointer,
   so `:hover`, JS hover state and a held mouse button all survive it, while the
   key itself is intercepted at capture phase so nothing underneath sees it (no
   menu typeahead, no app shortcut). The capture completes *before* the note
   field opens, so the state may collapse afterwards harmlessly. Click-to-pick
   stays as a convenience, not as the only path.
6. **Canvases must be selected by RECT INTERSECTION, not centre containment.**
   Measured on `/harness/docs`, which mounts 12 canvases stacked *vertically*
   (six editors × grid + overlay) rather than overlapping: a 220×120 region
   whose centre sat inside the first pair, with its lower third over the next
   one, composited 2 layers and produced an image whose bottom third was
   **black**. A reporter who crosses a page seam to report the seam would attach
   evidence with the seam missing. Centre containment happens to pass on the
   sheet surface, where the layers really do share a box, which is why SP0 did
   not catch it.
7. **A region over pure DOM must record the DOM under it.** On `/login` and
   `/harness/visual` — zero canvases — a region produced an item with no
   capture, no selector and no text: coordinates and nothing else. The rule that
   DOM targets are *described* rather than photographed is right, but it has to
   be carried out, so a DOM region records the meaningful elements
   **intersecting** the rect (a bounded list of selector plus text excerpt).
   That list is the agent's grep key into the source.

Residual, and deferred: aiming at a tooltip that renders *away* from the cursor
still loses it, because moving the pointer is what destroys it. Only a frozen
frame fixes that — snapshot every visible canvas, then aim inside the
snapshot — and at DPR 2 with the twelve canvases the docs surface mounts that is
not cheap. It is not the common case either: the common case is that the pointer
is already on the thing.

Canvas is same-origin, so cropping and `toDataURL` need no third-party
dependency; captures are capped at 1280 px on the longest side.

### Nothing is dropped in silence

A reporting tool that loses a report has done worse than nothing: the reporter
believes the observation is filed, and the next one does not get made. This is a
requirement of the collection UI, not a nicety, and it is stated here because
measuring the spike produced three violations of it from a single control — a
`window.prompt` asking for the sentence. Cancelling the dialog dropped the item
with no trace; answering it empty dropped the item with no trace; and closing it
with Escape sent the Escape on to the page, which turned debug mode off — so a
reporter who cancelled once found the whole overlay gone and no reason given.

Three rules follow. The first two are requirements on the overlay and are tested
with it; eviction reporting is the core's and is tested here:

- **Cancelling drops the item, never the mode.** Abandoning one target returns
  to aiming, not to a dismissed overlay.
- **An empty note is refused visibly.** The commit control is inert and says so,
  rather than accepting the gesture and discarding the result.
- **Every eviction is reported.** When the capture budget evicts, the panel
  names what went (see *Session and storage*) — the item survives its capture,
  and the reporter is told which pixels are gone before they confirm a bundle.

The same rule governs the pipeline end: a group the repository had to merge or
split is reported as a delta (see *The proposal is not a contract*), and an item
held back by the per-session PR cap is shown as queued. Silence is the one
failure mode this feature cannot afford, because its entire premise is that
reporting is cheap enough to do again.

### `pick` was a mode that did nothing (finding 11)

`p` entered a `pick` mode whose entire implementation was
`session.setMode("pick")`, and the only behaviour that mode had was painting the
hover outline. It could never produce an item: `capture` reads the cursor
directly and works in every mode. So the badge listed `c capture · p pick ·
r region` as three parallel actions while one of them did nothing a reporter
could observe — reported from the running app as "pick mode doesn't work",
which was exactly right.

Underneath it was the worse half: because the outline was gated behind that
mode, pressing `c` in any other mode fired **blind** — what it would record was
invisible until after the keystroke. Aiming at transient state is the whole
point of the feature, and you cannot aim at what you cannot see.

The mode is gone, as a binding and as a `Mode` value (where it was
indistinguishable from `idle`), and the outline is unconditional while debug mode
is live, coalesced to one `locatePoint` per animation frame — being mode-gated had
been doing that throttling by accident. Two actions remain, `capture` and
`region`, and `p` reaches the app like any unbound letter. Removing the binding
made `region` a mode with no exit, so Escape now peels `region` → `idle` before
`idle` → `off`, which is the invariant it already documented.

### Duplicates are measured twice, by two different measures

`report-intake.mjs` checks a report against two sources: the `--prior` ledger
this pipeline writes, and (with `--issues`) the repository's **open issues**,
read through `report-prior.mjs`.

They cannot share one comparison. `tokenOverlap` is containment
(`shared / min(|a|, |b|)`) and its own docblock warns it is *blind to the longer
operand*. A debug report is one sentence; an issue body is paragraphs. Under
containment, an issue whose body merely contains a short sentence's words scores
1.0 — so a real report is routed to `duplicate`, commented onto an unrelated
issue, and **never filed**. Losing a report behind a wrong match is the one
outcome this pipeline exists to prevent, so report-vs-issue uses
`crossArmTokenOverlap` (Dice), where a long body pulls the score down rather than
up. Ledger entries keep containment, where one sentence restating another at
length really is evidence.

Issue text is untrusted — anyone who can open an issue writes it. It is read as
data: control characters collapse to spaces, zero-width and bidi characters are
removed outright (removed, not replaced, so nobody can forge a word boundary and
change how the text tokenises), the body is truncated before scoring and then
dropped, and only a number, a URL and a truncated title ever reach the plan.

`gh` being absent, offline or unauthorised carries **no** prior rather than
failing the run: the cost of getting this wrong is one duplicate comment, and the
cost of refusing to run is a report nobody sees.

### Engine locators

A point becomes a semantic address (`Sheet1!C7`, a docs paragraph offset) through
per-engine locators in `packages/frontend/src/debug/locators/`, reusing
`parseRef` / `toSref` / `formatValue` from `@wafflebase/sheets`. Reader naming
mirrors `packages/frontend/src/app/harness/hunt/bridge.ts` so the two registries
can merge later. Sheets and docs come first, deliberately: the bridge's `pointAt`
exists only for slides/board, while `hunt-ui` verification supports only docs and
sheets — starting where verification can close the loop means a report can be
mechanically checked end to end.

### The `HostAdapter` seam

```ts
interface HostAdapter {
  route(): string;
  buildSha(): string | undefined;
  theme(): string;
  /** Everything else about the observation environment. */
  environment(): Environment;
  locate(point: Point): Promise<Target | undefined>;
  /**
   * The RAW answer, deliberately untyped: it comes from a model, and
   * `parseDraftResult` is the only thing allowed to interpret it. Declaring the
   * validated shape here would be a lie every implementation told — the wire
   * form is flat, `DraftResult` is not.
   */
  draft(items: readonly DebugItem[]): Promise<unknown>;
  /**
   * The captures travel BESIDE the bundle, not inside it: the bundle is
   * metadata that has to stay small enough for `localStorage`, and the images
   * are megabytes.
   */
  send(bundle: Bundle, captures: readonly CapturePayload[]): Promise<SendResult>;
}
```

In development the Vite plugin implements `draft` and `send`
(`POST /__wb_debug_draft`, `POST /__wb_debug_report` writing into
`.wb-reports/<session>/`), following `packages/design-editor/src/plugin/bridge.ts`.

**One session hands over more than once.** `sessionId` is a per-page-load
singleton, so the write is bundle.json, then bundle-2.json, and so on — created
exclusively, never truncating. Intake takes the newest. Overwriting
would have destroyed the earlier batch after the reporter was told it was sent,
which is the same class of failure as writing an unvalidated bundle: a report
lost behind a success message.

**Both endpoints validate before acting**, and for drafting that is a cost
argument, not only a correctness one: the endpoint listens on a port every page
the developer visits can reach and answering it spends tokens, so
`parseDraftRequest` caps the item count (`MAX_DRAFT_ITEMS`, refused rather than
truncated) before the credential is touched.
In SP2 the backend re-hosts the same two calls. Because both sit behind this
interface, SP1 → SP2 is a substitution rather than a rewrite, and the design
editor can host the loop by implementing it too.

### Drafting and PR grouping happen together

The draft call is already running at preview time, so the grouping proposal is
one extra output field at no extra cost — and it is far easier on the person, who
reviews a concrete proposal instead of applying abstract tags.

**What gets grouped is governed by homogeneity, not count.** Two padding fixes
pass or fail together; a padding fix and a formula-engine bug do not. Two rules
compose:

1. **Forced coupling — file overlap.** Items touching the same file must be one
   PR; separate PRs would conflict. This is a constraint, not a choice.
2. **Elective coupling — same change kind and risk class.** So a reviewer
   reviews "spacing cleanup" once.

| `kind` | grouped | why |
| --- | --- | --- |
| `spacing` · `color` · `token` · `copy` · `a11y` | with their own kind | uniform verdicts, identical verification (visual lane) |
| `affordance` (small button / menu addition) | with their own kind, lower cap | each is a small feature; slightly wider review surface |
| `layout` (structural JSX) | same file only | blast radius differs per file |
| `logic` (behaviour / bug fix) | never grouped | one item blocking should not hold the others |

One item is one commit, so a reviewer can drop a single commit to reject a single
item. Caps: 8 items / 300 lines per group, 5 PRs per session; overflow stays
queued and the panel says "N waiting" rather than silently dropping it.

The person's controls are exactly three — **detach** an item from a PR, **split**
a PR, **merge** two PRs. Files are never mentioned in the UI. Merging two
different kinds is warned about, not blocked.

### The proposal is not a contract

Elective coupling needs only the items; forced coupling needs repository access,
which the browser does not have. So the proposal is made without seeing the
repository and can be adjusted afterwards in exactly two directions: **forced
merge** (two items in different PRs turn out to touch one file) and **forced
split** (an item tagged `spacing` turns out to be structural, or a group exceeds
300 lines). The pipeline may split a group and may never merge across kinds —
splitting is always safe, merging is not.

**Neither adjustment is ever silent.** The results round-trip records the delta —
`proposed 2 PRs → actual 3 (the cell-merge item shares a file with the spacing
group, so …)`. What the person approved is a *shape*, not a promise about the
number of PRs, and the UI says so. Size is unknowable at preview time for the
same reason.

### Destinations and verification

| Verdict | Condition | Destination |
| --- | --- | --- |
| Bug, verified | replay reproduces and contradicts a grounded prediction | PR (alone or grouped) |
| Appearance | no prediction, no replayable plan | PR, gated by the `visual-intent` lens |
| Verification failed | not reproducible, or scope too broad | Issue carrying **both** the expectation and the failed replay |
| Duplicate | matches an existing issue | comment on that issue |

`hunt-ui` verification needs a prediction and a replayable plan, and "the padding
is too tight" has neither — so appearance reports skip `hunt-ui`. **They do not
skip review.** For an appearance report the reporter's sentence *is* the ground
truth, which is a different thing from `hunt-ui`'s prediction, so it gets its own
lens: `visual-intent`.

**It lives in its own lens directory, not the panel's shared manifest.**
`scripts/agent/report-lenses/` holds the rubric and a one-row `lenses.json`, and
the report pipeline passes it to `review-panel.mjs --lenses-dir` — a seam that
already existed. It is a SIBLING of `lenses/` rather than a subdirectory: nested,
it made `readdirSync` over the panel's lens directory return a directory, and
`eval/run.test.mjs` — which copies that directory file by file — died on EISDIR. Registered in the shared manifest with an `appliesWhen` of
`packages/frontend/**` it fired, blocking, on every PR touching the frontend or
any engine's view layer, judging them against a reporter's sentence and a
baseline/actual/diff set that only a report has. The rubric still carries the
panel's injection-framing and coverage-first clauses, enforced by
`report-lens.test.mjs`, because a lens reading an untrusted working tree needs
them wherever it is registered. Its inputs are the original sentence, the baseline
PNG, `*.actual.png` and `*.diff.png`, all three of which
`packages/frontend/scripts/verify-visual-browser.mjs` already produces. It judges
two things: whether the after state satisfies the sentence, and whether the diff
changed anything beyond the report's scope. The second catches more in practice.

**A failed verification does not delete the report.** `hunt-ui`'s replay saying
"not reproduced" does not mean the observation was wrong — the documented failure
where a reader's scope is wider than the action is real. So failure *lowers the
destination* instead of discarding: the expectation and the failed replay are
filed together, leaving the discrepancy visible to a person rather than resolved
by a machine.

### The intake scripts

Five modules in `scripts/agent/`, each doing one step, and none of them filing
anything by itself:

| script | does | notably does NOT |
| --- | --- | --- |
| `report-bundle.mjs` | reads and validates a bundle off disk | repair anything |
| `report-prior.mjs` | reads the repo's open issues as prior reports | judge, or write anything |
| `report-intake.mjs` | redacts, dedupes, routes each item, emits a plan | run or file |
| `report-verify.mjs` | works out what verifying each item means | run the lanes |
| `report-to-pr.mjs` | assembles the PRs and records the delta | open a PR |
| `report-back.mjs` | writes the outcome next to the bundle | interpret it |

**A plan is data.** Keeping the decision separate from the action is what makes
`--dry-run` the same code path as a real run rather than a second one that can
drift, and it is why `report-to-pr.mjs` spawns no process at all — opening a PR
is `spec-to-pr.mjs handoff`, an explicit step taken after a person has read the
assembly.

`report-bundle.mjs` deliberately does NOT share code with the package's
`parseBundle`: `scripts/agent/` is a separate npm install outside the pnpm
workspace, the same constraint that makes the UI hunter's runner a subprocess. It
validates exactly what the pipeline reads, and the two are kept in step by
**shared fixtures** under `scripts/agent/fixtures/debug-report/` that both test
suites load — a rule that changes on one side and not the other turns a suite red
rather than silently accepting a bundle the other half refuses.

The forced merge is **transitive**: if A and B share one file and B and C share
another, all three become one PR, because any split among them conflicts
somewhere. A merge the files forced across kinds is labelled `mixed` rather than
claiming to be one kind — a wrong label is what a downstream router would act on.
With no file map supplied, the unknown is reported as unknown: a guessed overlap
produces conflicting PRs, while an honest "not checked" costs nothing.


### Credentials

The two credentials this feature needs have different blast radii and are kept
as different things.

**The drafting credential lives with the app.** It is tool-free and
output-only — no repository access, no file writes, no GitHub access, no
authority to file. Its input is the reported items; its output is text handed
back to the person. With a hard token ceiling, workspace-member gating and
`UserThrottlerGuard`, the worst case is a wasted token budget and a bad draft the
person rejects. There is no privileged action for a prompt injection to reach,
which is what makes it acceptable. In development the Vite plugin reads the
developer's key **in the dev-server process only** — it never reaches the
browser, per the rule already stated in
[design-editor-local-plugin.md](design-editor/design-editor-local-plugin.md).

It is a plain Messages API request from that process, NOT a call through
`scripts/agent/ask.mjs`. That wrapper requires a grant of at least one built-in
read tool — "an agent that can act but not read cannot cite evidence" — which is
right for the verifier and explorer sessions it exists for and wrong for a call
whose entire security argument is that it holds no tools; its package is also a
separate npm install outside this workspace. Widening a shared security module to
fit an output-only call would have been the more expensive mistake.

Without a key the panel shows the original sentences, drafting and grouping are
skipped, and the pipeline still runs — one item per PR.

**The pipeline credential stays with the repository.** Verification, locating
code and opening PRs need a checkout and the `verify:*` lanes, and the deployed
backend has neither. So **only reports cross the boundary, and the repository
pulls them**:

```text
[deployed app]  mailbox + draft endpoint — tool-free model key, no GitHub credential
    ▲ pulled with a read-only ApiKey (the app never pushes to the repository)
[repository]    intake runner — Actions secrets or a maintainer's gh, with tools
```

A compromised app can show a bad draft and burn tokens; it cannot create a
commit. SP1 and SP2 share the same runner, differing by a `--source` flag.

### The `agent:candidate` checkbox, honestly

The autonomous-contribution gate requires **both** the label and a non-Bot
author. When Actions opens an issue the author is a bot, so labelling it does not
open the gate — and that is correct. So the checkbox records *intent* in the
bundle; a local run (a maintainer's `gh`) applies the label for real, and in
Actions mode it renders as a checklist in the issue body. Intent is conveyed
without weakening the gate.

### Reused, not rebuilt

| Needed | Already exists |
| --- | --- |
| Canvas point → semantic address | `packages/frontend/src/app/harness/hunt/bridge.ts` (closed reader registry) |
| before/after images + pixel diff | `packages/frontend/scripts/verify-visual-browser.mjs` |
| Adding a review lens | `scripts/agent/lenses/` — one `.md` + one `lenses.json` row. A lens that needs a report's own inputs goes in its own directory instead, passed as `--lenses-dir` |
| Publication boundary (credential / PII redaction) | `scripts/agent/redact.mjs` |
| "Is this the same defect?" | `scripts/agent/finding-match.mjs`, `finding-key`, `novelty` |
| Severity → blocking rules | `scripts/agent/severity.mjs` |
| Write-once capture storage | `scripts/agent/capture-store.mjs`, `capture-meta.mjs` |
| AI-authorship disclosure trailer | `scripts/agent/disclosure.mjs` |
| Brief → branch → review → draft PR | `scripts/agent/spec-to-pr.mjs` |
| UI defect verification (replay + panel) | `scripts/agent/hunt-ui.mjs` |
| Dev-only module gating | `packages/frontend/src/App.tsx` (`import.meta.env.DEV ? lazy(…) : null`) |
| Router-aware, render-nothing global mount | `packages/frontend/src/analytics.tsx` |
| Session singleton without React state | `packages/frontend/src/app/slides/zoom-controller.ts` |
| Workspace-scoped read-only key | `ApiKey.scopes` + `ApiKeyWriteScopeGuard` |

New code is limited to the capture UI, the session basket, the preview panel, the
sheet/doc locators, the drafting seam, intake assembly and the `visual-intent`
lens.

### Rollout

| Stage | Contents | PRs |
| --- | --- | --- |
| SP0 | Throwaway spike — does reporting feel natural in the hand | 0 (done) |
| SP1 | 1: core package + capture + locators · 2: preview + drafting + grouping · 3: intake → verify → PR | 3 |
| SP1.5 | Auto-detection (console errors, failed fetches, key warnings) | 1 |
| Optional | Design-editor host adapter | 1 |

The prototype exists at the end of PR 2: the half a person touches works end to
end and **nothing is filed**, which is exactly the safe state to evaluate from.
PR 3 closes the loop, and **SP1 is the whole feature**: report, draft, confirm,
intake, PR.

### Staying dev-only, and what a deployed version would cost

Running this against the deployed app was scoped as SP2 (a backend mailbox, a
re-hosted drafting endpoint, a pull workflow, and switching the `HostAdapter`
over). It is **deliberately not scheduled** — a possible extension rather than a
planned stage.

The reason is the risk profile, not the effort. Dev-only, a screenshot is of the
reporter's own machine and the drafting credential is on their own dev server.
Deployed, the same two facts become: a capture can contain **another person's
document**, and a tool-free but real model credential sits behind an
internet-reachable endpoint. The mitigations exist — the panel's consent gate,
member gating, a token ceiling, a rate limit — but they are the whole defence,
and none of them is needed while the overlay only ever runs on `localhost`.

**If SP2 is ever built, the overlay should mount behind an explicit opt-in** —
`?debugMode=on` or equivalent — rather than being live on every page. Nobody
wants a reporting overlay listening on a document they are simply reading, and an
opt-in keeps the cost of the feature proportional to its use: no listener, no
capture budget, no session in storage until someone asks for one.

Two things that switch is *not*, both worth stating so the work is not
under-estimated:

- **Not a substitute for the mailbox.** A flag anyone can append still needs
  somewhere to send to; without the backend half, Hand over answers 404.
- **Not free at the bundle level.** `import.meta.env.DEV` is statically replaced,
  so today the overlay is *absent* from the production build rather than merely
  inactive. A runtime flag means shipping the code, which the frontend chunk gate
  will notice — so the mount gate and the chunk budget have to be designed
  together.

Nor does the flag decide *who* may report: that stays workspace membership, since
a query parameter is not an authorisation.

The `HostAdapter` seam is what keeps all of this cheap to reconsider: the
frontend side of SP2 is one adapter, not a rewrite.

### Risks and Mitigation

- **More PRs cost CI and review-panel budget.** The 5-PRs-per-session cap is
  that budget; overflow stays queued and visible in the panel.
- **The grouping proposal is made without seeing the repository.** The danger is
  not the adjustment but a *silent* adjustment — a PR shaped differently from
  what the person approved, with no stated reason, breaks trust before it breaks
  anything else. Delta reporting is therefore a required verification item, not
  a feature.
- **The three adjustments are ordered, and the order is load-bearing.** Forced
  split (a `logic`/`layout` item leaves its group), then forced merge by file
  overlap, then the item cap. Each earlier rule outranks the later one where they
  disagree: file overlap never merges a solo kind into a shared PR (it reports
  the conflict and says to land one first), and the cap never splits a
  force-merged group (it goes over the cap and says why, because two conflicting
  PRs are worse than one large one). Run in any other order, each adjustment
  quietly undoes the previous one. There is **no line cap** — nothing in this
  path can measure a change before it is written.
- **`visual-intent` judges a subjective claim** ("does this satisfy the
  reporter's expectation?"). The first response to misjudgement is to drop it
  from blocking to advisory — one field in `scripts/agent/report-lenses/lenses.json`, and it
  affects no PR outside this pipeline.
- **The drafting credential lives with the app.** Tool-free, so no privileged
  action; the token-amplification surface is real, and the ceiling, member gating
  and rate limit are the whole defence.
- **In SP2, screenshots can contain other people's data.** The mitigation is not
  in the backend: it is the preview panel's consent gate — the reporter sees
  every image that would leave — plus `redact.mjs`, plus never attaching images
  to issue bodies (the agent looks and transcribes instead).
- **`hunt-ui` must keep filing nothing.** It does: the `report-*` scripts file
  only items a person confirmed, and `hunt-ui`'s autonomous findings never enter
  this path.
