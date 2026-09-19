# Offline Persistence Wiring — Lessons (W3–W5)

**Created**: 2026-09-17

## From implementation

**A design can assume an API shape that does not exist, and the assumption can
survive review because it reads as obviously fine.** The design said "nest a
`YorkieProvider` with `key = wb:{userId}:{docKey}`". `key` is React's. The whole
durable path rested on a line nobody could have written. It took five minutes to
prove with a four-line probe and would have taken a day to find by debugging a
store that silently never resumed. **When a plan depends on passing a specific
option to a specific component, check the component's props type before
building on it** — and if the option is named `key`, `ref`, `children`, or
`dangerouslySetInnerHTML`, check twice.

**`tsc --noEmit` was checking nothing, for hours.** `packages/frontend/tsconfig.json`
is `{"files": [], "references": [...]}`, so a bare `tsc --noEmit` compiles an
empty program and exits 0. Every "TSC OK" reported before this was discovered
was vacuous, including ones used to justify a commit. The real command is
`tsc -p tsconfig.app.json --noEmit`, and it surfaces ~147 pre-existing errors —
which is why `verify:fast` has no frontend typecheck lane, and why a green
`verify:fast` says nothing about frontend types. **Before trusting a verification
command, make it fail once on purpose.**

**Fail closed, and be able to say why in one sentence.** Three of these modules
refuse rather than degrade: no Web Locks API means no durability, a lock manager
that threw means no durability, and `isOpenInAnyTab` answers "open" when it
cannot tell. Each is defensible only because the asymmetry is real — refusing
costs a feature, proceeding costs edits. Where that asymmetry does not hold, the
refusal would just be timidity.

**Two edges, one listener.** A preference-change subscriber fires on both
enabling and disabling. Erasing on the wrong one deletes the documents the user
just asked to start keeping. The test for it is the kind that looks redundant
until it is not: `it("does not erase when it is switched on")`.

**Read late, not at setup.** The erase watcher outlives a sign-out and sign-in,
so capturing `userId` when it is registered would erase the wrong account's
documents. Anything that survives an identity change should read identity when
it fires.

## Carried in from earlier stages

**Verify a claimed fix by reverting it.** Every guard in these modules has a
test proven to fail without it. Two revert checks in this batch were themselves
broken — a `perl` substitution mangled the function it was meant to neuter, so
the "check" proved nothing until it was redone with an asserted Python edit.
**A revert check that fails for the wrong reason is worse than none**, because
it reads as evidence.

**Tests that assert a proxy.** The storage layer's two review passes both found
tests that passed for a reason other than the behavior they named. The question
to ask of every test here is not "does it pass" but "would it still pass if the
thing it describes were broken".

_Appended as the work proceeds._

## Review panel, round 4 (blast radius / tests / design fit / security / correctness)

**A guard's scope must match the reach of what it guards.** `collectStale`
deletes across every account on the device — deliberately, since a departed
user never runs their own housekeeping — but it was handed the *account-scoped*
"is this open somewhere" predicate every other caller uses. That answers "not
mine, therefore idle" about another account's live document, so the sweep
collected it and that tab's later appends silently vanished. The two callers
need two predicates (`isOpenElsewhere` / `isOpenForAnyUser`), because the
account scoping is right for the purges and wrong for the sweep.

**Catching a throw is not the same as answering it.** `doc.subscribe` throws on
an event name the pinned SDK does not know, so the subscription had to be
wrapped — but the `catch` only logged. That handler is the sole caller of
`expectLoss`, and `remove()` archives only when the latch is set, so a
swallowed failure turned "archive the work" into "delete it" while the chip
still read `Saved to this device`. Every swallowed failure needs an answer to
"what does the rest of the system now believe that is no longer true".

**A per-device secret on a shared device is a per-everyone secret.** The
client-key salt lived in one `localStorage` key, and the device this feature
exists for is precisely the one where the next reader is a different person. It
is now per account and dropped by the erase.

**An offer is a claim too.** The chip's "turn offline saving on" call to action
fired on the share-link route the design excludes, promising a visitor a
guarantee that could never apply to the document in front of them. The
`not-permitted` lapse already carried the fact; the offer just was not reading
it.

## Review panel, round 5 (security / correctness / test adequacy)

**"Per account" is not a boundary `localStorage` can hold.** Round 4's fix
moved the client-key salt from one profile-wide entry to one per account — and
the rationale attached to it (that it stops the next person signing in on a
shared device from deriving another account's keys) was never true:
`localStorage` is origin-scoped, so whoever can run script on the origin reads
every entry whatever it is keyed by. The salt's real defence is against the
*remote* workspace peer, who holds `userId` and `docKey` and nothing else. What
bounds the local reader is lifetime, not key shape — so the entries now carry a
timestamp and are swept at thirty days (the store's own age), which is the
bound the doc comment had been asserting with no code behind it.

**A claim in a comment that no code keeps is a defect, not prose.** The
"bounded by the thirty-day sweep" sentence read as a design property; nothing
in `collectStale` ever touched `localStorage`. The reviewer found it by looking
for the code that would have to exist.

**An identifier is not a place to keep a shared secret.** The salt travelled
inside the Yorkie client key — sent on every `ActivateClient`, stored on the
client row, read by an operator in a log. One salt shared by every document
meant any single leaked key handed the reader every other key that account
would ever use. Minting the salt **per document** makes a leaked key a
capability for that one client row and nothing more, which is exactly the
exposure the SDK's own random per-session key already has.

**A call site with no test of its own is a call site that can be deleted.**
`eraseOfflineData` ends with `forgetDeviceSecret(userId)`, and
`durable-session.test.ts` tested that function directly — so removing the call
left every suite green. The assertion belongs where the wiring is.

## Review panel, round 6 (design fit / security / correctness / test adequacy)

**A dark launch that publishes a diagnosis is not dark.** The lapse the chip's
tooltip names was computed as `!supportsClientKey() ? "unsupported" : …`, and
the pin ships below the floor — so *every* stranded document in the product
told its user "this browser cannot save documents locally". A dependency pin of
ours, reported as a fault of their browser, about a feature they were never
offered. The gate now publishes no reason at all below the floor, and the
`unsupported` member is gone from the union rather than left for somebody to
reuse. Generalised: the inert branch of a dark launch has to be *identical* to
the pre-feature behaviour, not merely harmless-looking.

**Absence is evidence of the cause you are looking for, not of the one you
assumed.** The session-start reconcile dropped everything `GET /documents` no
longer listed, archives included. But "the document was deleted or GC'd
upstream" is one of the three causes of an archive — so a deleted document is
missing from that listing *because the archive's own cause happened*, and the
reconcile destroyed exactly the unsent work the recovery offer was about to
hand back, one step before it was made. Only a per-document `403` (it exists,
you may not read it) may drop one now; a `404` and every unclear answer keep it.

**"Positional" means above the branching.** `NonDurableScope` was mounted
inside `SharedDocumentInner`, after the `pdf` early return — so the one
document type the design excludes *twice over* was the one type the share route
permitted. An exclusion enforced by position has to sit where no later early
return can step around it, which here meant moving it up to the caller.

**Durable is not the same answer for a reload and for a route change.** The new
`saved-locally` state dropped the unload guard, correctly: the entry survives a
reload and the next attach resumes from it. It dropped the *navigation* guard
too, which is not the same event — leaving detaches, and `detachDocument` calls
`removeFromStore` unconditionally while the store archives only a latched loss.
One click deleted the durable entry and the queue with it.

**The fallback destination was the security hole, not the fallback.** Recovery
with no source workspace took `fetchWorkspaces()[0]` — every workspace the user
belongs to, a shared team one included — and republished a deleted private
document's full content there with the user told only that a copy was saved.
It now prefers a workspace the user is the sole member of, and where there is
none, the offer names the destination so the click is agreement to it.

**A value computed in one module and read through context in another is where
coverage goes missing.** Every chip test injected a `DurabilityLapse` by hand,
so the two real publishers — and which of them wins when both are mounted —
were never exercised. Same shape as round 5's deleted call site: the seam is
tested, the wiring is not.

## Review panel, round 7 (security / correctness)

**A consent control has to name who consented.** The opt-in was one
unqualified `localStorage` flag, justified in the design as "per device, never
per account" — and that argument, which is about the setting not *following*
the user to the next machine, was quietly read as "the machine answers for
whoever is at it". On the shared workstation the feature exists for, that means
user A's opt-in starts writing user B's document content to the disk, with B's
own Settings switch showing "on" for a choice they never made. Per device and
per account are not alternatives: the store is the device's, the answer is the
account's. The stored value is now the set of ids that consented here, and
every read names one.

**Threading an identity has a hole exactly where the identity is not there
yet.** Making the preference per-account turned a synchronous read into one
that cannot be answered while `me` is in flight — and reading "unknown" as
"off" would have latched non-durable for a person who *had* opted in, for the
life of the open document. The device-wide question (`has anybody consented
here?`) is the one thing that is still answerable without an identity, so it
stands in during the wait; a device where nobody has is still decided on the
first render, which is what keeps "declining costs nothing" true.

**The write you did not count is the one that outlives the erase.** Three
writers asked `isPersistenceEnabled`; `remove()` did not, and it is the only
path that *creates* content — a full compressed archive of the document on a
loss. So a `LocalChangesDropped` after a sign-out or a disable put the whole
document back on the disk that had just been cleared, past a sweep that had
already walked the archives. Count write paths by what they write, not by what
they are named.

**Sonner retracts a toast on its action click, which is the wrong half of the
behaviour when the action is asynchronous.** The recovery offer lost its own
toast before anybody knew whether the recovery worked, so a failure left
nothing to retry from; the success case, meanwhile, had nothing explicit
retracting an `Infinity`-duration warning. The handler now prevents the default
and dismisses on success only, with a re-entrancy latch so a second press
cannot report "the stored copy could not be read" for work that was in fact
recovered.
## Manual smoke, against a locally built 0.7.23

The PR deferred the manual smoke because "nothing renders until the dependency
is bumped". That was true of the *published* dependency only: `#1357` was
already merged upstream, so building `yorkie-js-sdk` main, stamping it
`0.7.23`, `pnpm pack`ing the two packages and pointing `pnpm.overrides` at the
tarballs opens the gate today. Everything below was found in the hour that took.

**The promise holds.** Edits typed with the server unreachable survived a
reload and reached the server on reconnect. The store behaved as designed: one
snapshot row, 49 change rows for 49 keystrokes — the incremental append, not
the full re-serialization the SDK prerequisite exists to remove.

**A green suite can be green only because the feature is off.** Two existing
chip tests failed the moment the pin moved to `0.7.23`. Neither was about
offline persistence: one asserted the chip carries `tabindex="0"` (a stranded
chip that can offer to turn saving on renders a `<button>`, focusable natively
and carrying no tabindex), the other that the tooltip never says "this device"
(the offer says it, legitimately). Both encoded the dark-launch state as
though it were the requirement. "Bumping the dependency is the only action
needed" was therefore not true of CI, and no amount of reading would have said
so — only running with the bump did.

**`!doc` is two situations, and they are opposites.** `useSyncStatus` answered
`saved` whenever there was no document, on the reasoning that there is "nothing
queued to lose". That holds while an attach is in flight. It is exactly wrong
when the attach *failed*: the reload-while-offline case put a `✓ Saved` in the
header of a document that did not open, over work still sitting undelivered on
this device. `DocumentProvider` publishes the failure as `error`, and the hook
was not reading it. It now makes no claim at all — `state: SyncState | null`,
nullable rather than a sixth state, so every consumer is forced by the type to
decide what to do with "nothing can be said". The same direction
`DurableYorkieProvider` already takes with `unreportable`.

**Opening a document offline is not ours to fix.** The only RPC attempted on
an offline reload is `ActivateClient`, and it 503s: `Client.activate()` takes
the client and actor ids from the server, so the client never activates, the
document never attaches, and the store is never consulted. The DocStore only
serves a client that already activated. Nothing in this repo closes that, and
the honest scope of this feature is "your work survives and syncs later", not
"you can keep working offline". Worth stating in the design doc rather than
leaving the reader to infer it from a full-screen `[unknown] Failed to fetch`.

### Two ways the measurement lied before the code did

**Never restart the local Yorkie to simulate a disconnect.** `docker-compose`
runs `yorkieteam/yorkie` as `server --pprof-enabled` with no volume and no
mongo URI — the in-memory backend. `docker stop && docker start` wipes every
document on it, and the reconnect then fails with `[invalid_argument] change
clientSeq must increase by one` against a server that has forgotten the client.
That reads exactly like the durable path corrupting a document, and it is not:
it is the test rig destroying the server's state. Put a TCP proxy in front of
Yorkie and kill the proxy instead; the server keeps its data and the client
sees a real network loss.

**Never time a background tab.** The "second tab takes 10+ seconds" finding was
an artifact: Chrome suspends `requestAnimationFrame` and throttles timers in
hidden tabs, and a Canvas editor paints in rAF. Measured under equal
conditions, the *sole* tab on a document took 27.3 s to first canvas and the
second tab 21.8 s — the contended one was faster, so there is no second-tab
penalty to explain. `document.visibilityState` belongs in any timing this
harness reports.

## The switch had no way in

Both smoke runs reached the offline toggle by typing `/settings` into the
address bar, and it took a third pass to notice that is the *only* way to reach
it. `use-workspace-nav-items` carries one entry called Settings whose target
flips on whether a workspace slug has resolved: with one it is the workspace's
settings, without one it is the device's. A signed-in user always has a
workspace, so the device's settings — the page the whole opt-in lives on — were
unreachable from the UI, and the user menu offered only Dark mode and Log out.

The tell was in the transcript the whole time and read as a convenience:
"Settings에 Offline 섹션이 보입니다" came after a `navigate` to a URL nobody
could have clicked. A feature verified only through a path the product does not
offer has not been verified.

They are opened from the user menu now, as a dialog. `NavUser` is mounted by
every editor shell as well as `Layout`, so the settings open *over* a document
instead of navigating away from one — which matters here more than it looks:
the other route to the offline switch is the sync chip's offer, shown precisely
when the document has unsent edits, and leaving that document is what
`useNavigationGuard` stops with a confirmation. A route would have put that
dialog between a user and the setting meant to protect their work.

The dialog's open state is held by `NavUser` rather than inside the dialog,
because a Radix menu closing takes focus with it and would close a dialog the
menu owns.
