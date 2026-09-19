---
title: offline-local-persistence
target-version: 0.6.12
---

# Offline Local Persistence

## Summary

[sync-status.md](sync-status.md) made the risk visible: a disconnected editor
shows `Not saved`, and its tooltip says the work "exists only in this tab —
closing or reloading it will lose them." That is a true statement about a real
exposure, and it has no fix in this repo yet. This document is the fix.

`@yorkie-js/sdk` 0.7.20 added the machinery — an opt-in `ClientOptions.store`,
`Document.toBytes()` / `fromBytes()`, and a `LocalChangesDropped` event — and
the cluster already runs a server that supports it (`yorkie-cluster` chart
0.7.21, which carries offline-resumable attach and the watch stable actor).
`sync-status.md` listed turning it on as a Non-Goal because two things blocked
it. Both are now understood, and neither is where it looked:

1. **We pass no `key` to `YorkieProvider`**, so the SDK mints a random client
   key per session and nothing would ever resume. Stabilizing it activates the
   SDK's single-active-session Web Lock, which fails the *second* tab's attach
   on a document already open in another — and a document open twice is
   ordinary use here.
2. **The shipped SDK writes a full document snapshot on every local change**,
   undebounced, including on presence-only changes such as caret movement.
   Measured, that is 286 ms of main-thread time per save on an 8,000-cell
   sheet. This is the larger blocker and it is not fixable from this repo.

So this lands in two halves. The SDK half is specified upstream, in
[the SDK's own offline-local-persistence design](https://github.com/yorkie-team/yorkie-js-sdk/blob/main/docs/design/offline-local-persistence.md)
§ Revision: Incremental Persistence, and is a prerequisite. This document covers the
wafflebase half: the storage backend, the client-identity and multi-tab model,
and what the user is shown — including when the guarantee does **not** hold.

**The prerequisite shipped in `@yorkie-js/sdk` 0.7.22**, which this repo is on
as of #1071. Blocker 2 above is therefore historical: a local change now costs
an appended entry rather than a full re-serialization. 0.7.22 also carries the
follow-up fix without which a restore could leave a document permanently unable
to sync (yorkie-js-sdk#1355) — anything earlier in the 0.7.2x line has the
incremental store *and* that defect, so do not pin below it.

### Status: the Goals below are NOT met by what has shipped

Stated here rather than only in [Rollout](#rollout), because it is the first
thing a reader of this document needs to know and the Rollout section is the
last place they reach.

`supportsClientKey()` requires `@yorkie-js/react >= 0.7.23` — the first release
whose `YorkieProvider` forwards a `clientKey` (React reserves `key` and strips
it before props are formed; yorkie-js-sdk#1357 adds the alias). **That release
does not exist yet**: npm's `latest` for `@yorkie-js/react` is `0.7.22`,
measured 2026-09-19, and that is what `packages/frontend/package.json` pins.

So on every build shipped so far the gate is closed: no durable client mounts,
no store is ever attached, the `Saved to this device` chip state is
unreachable, and both opt-in entry points (Settings, the chip's offer) are
hidden. What has landed is the *wiring* — reviewed, tested, and inert. The
feature is off for everyone, which is the safe direction but not the intended
one, and no Goal below is delivered until the dependency is bumped.

Bumping it is the whole remaining action. No code here changes with it. Until
then, nothing in this document should be read as describing behavior a user
can observe, and nothing that offers the feature may be moved out from behind
`supportsClientKey()` — including the lapse reason the sync chip shows, which
is why a build below the floor publishes no reason at all rather than one
blaming the user's browser for our pin.

### Goals

- Edits made while disconnected survive a reload or a browser crash, for every
  CRDT document type (sheet, doc, slides, note, board), on a device where the
  user has asked for it.
- Writing document content to a device is something the user opted into, on
  that device, and can revoke — taking the stored content with it.
- The sync chip tells the truth about durability in every case, including the
  cases where this feature is not protecting the user.
- Work that genuinely cannot be reconciled with the server is returned to the
  user as a document, not a console log.
- A second tab on the same document keeps working exactly as it does today.
  No new failure screen.

### Non-Goals

- **Opening a document that has never been opened on this device.** Google
  Drive's "Available offline" toggle pre-fetches files; we only persist what
  the user has actually opened. Offline *discovery* is out of scope.
- **Anonymous share-link editors.** Covered below under
  [Who gets it](#who-gets-it).
- **Making two tabs on one document both durable.** Deferred; see
  [Multi-tab](#multi-tab).
- **Replaying dropped changes onto the re-anchored state.** The SDK does not do
  this and neither do we; we hand the user a copy instead.
- Changing the CRDT, the document schema, or any backend store. This is
  entirely a frontend concern plus the SDK dependency.

## Proposal Details

### Who gets it

Logged-in users who have turned it on for the device they are using, on the
five CRDT document types, through the editor routes. The opt-in is specified in
[Turning it on](#turning-it-on).

`shared/shared-document.tsx` mounts its own `YorkieProvider` with the project's
public key for anonymous share-link visitors, and it is deliberately left
alone — it configures no store, so the share routes keep today's behavior and
`sync-status.md`'s wording continues to hold there verbatim.

That exclusion is a privacy call, not an oversight. Persisting for an anonymous
editor means writing document content into the IndexedDB of whatever machine
opened the link, keyed by an identifier we would have to plant in
`localStorage`; the local copy then outlives the share link's revocation. A
share link is the one path where we cannot assume the browser belongs to
someone entitled to keep the content.

The exclusion reaches the chip's *offer* too, not only the client. The share
route wraps itself in `NonDurableScope`, which publishes the `not-permitted`
lapse, and the chip suppresses the "turn on offline saving" call to action
wherever it sees that — otherwise a share-link editor (or an anonymous visitor
with no account for the preference to apply to) is offered a guarantee that
cannot happen for the document in front of them however they answer.

The blob types (image, file) mount no CRDT document and are unaffected.

**PDF is the exception that has to be handled explicitly.** `pdf` is a blob
document, but its *comments* live in a `pdf-<id>` Yorkie document, and
`files/pdf-collab.tsx` mounts them through the very same
`CollabDocumentProvider` seam this design hangs the client on. Left alone, PDF
comment documents would become durable for free — and that is exactly the
problem, because `sync-status.md` deliberately gives PDF no chip on either
route, so nothing would report that durability or its loss. Durable-but-
unreportable is worse than uniformly non-durable: it is a guarantee the user
cannot see, check, or be warned about when it lapses.

So the provider opts in by document type rather than by being mounted, and PDF
is excluded until it has a chip. Keeping the invariant **durable ⇒ reportable**
is what makes the chip trustworthy everywhere else.

### Turning it on

**Off by default, enabled per device in Settings.**

Persisting means writing document content to the disk of whatever machine is in
front of the user, where it outlives the session that produced it. That is the
same consideration that excludes anonymous share links above, and it does not
disappear merely because the visitor is logged in: people open wafflebase on
shared workstations, lab machines, and borrowed laptops. A feature that starts
writing content to those disks without being asked is making a decision that
belongs to the user. Google reaches the same conclusion — its offline mode
requires an explicit one-time enable — and so do we.

The preference is **device-local, never account-level**. This is the whole
point: an account-level setting would follow the user onto the public machine
and re-enable there, which is precisely the case the toggle exists to prevent.
It is therefore a `localStorage` preference alongside the existing ones, built
on `lib/date-format-preference.ts`'s shape — `useSyncExternalStore`, a same-tab
change event beside the cross-tab `storage` event, and a session-only fallback
when `localStorage` itself refuses the write.

That last path degrades to a session-only "on" — the choice applies until the
tab closes, and does not survive a reload. It is tempting to justify it by
saying a browser that will not persist a preference will not give us IndexedDB
either, and for the case that motivated it (Safari private mode) that happens
to hold. **It is not a rule, and nothing here relies on it**: a `setItem` can
fail on quota alone while IndexedDB is perfectly available. So durability is
reported from whether the store actually works, never inferred from the
preference write, and the erase on disable runs against the store regardless of
how the preference was recorded.

Two entry points, because the Settings page is not where someone is standing
when they need this:

- **Settings** — a switch, next to Appearance and Dates.
- **The sync chip** — which already reports durability, so it is the natural
  place to offer acquiring it. Google's 2020 status-indicator change added
  exactly this ("a new way to enable offline by clicking on the document
  status icon"), and the chip is already built.

**Turning it off erases.** Disabling drops every stored entry for that user on
that device, including archived envelopes. A toggle that left the content
behind would not be the control it presents itself as.

Two consequences elsewhere in this design:

- When the preference is off, `CollabDocumentProvider` nests **no** client and
  falls through to the ambient provider — today's behavior exactly, with no
  extra `ActivateClient`. Users who never opt in pay nothing for this feature
  existing. The `PrivateRoute` provider therefore **stays**; it is not
  redundant.
- Toggling mid-session does **not** remount an open document — reversing this
  design's first answer, which had the flag join `docKey` in the provider's
  React `key`. The durable and non-durable branches are different element types
  at the same position, so switching between them unmounts the
  `DocumentProvider` and the whole editor under it, discarding Yorkie's
  in-memory change queue: on a document with unsent edits, the toggle would
  destroy exactly the work it exists to protect, and the preference is
  reachable from another tab while an editor sits here with work in it. So the
  decision is made when a document is opened and holds until it is closed; a
  flip applies to the documents opened after it. The one exception is the SDK
  refusing the attach for its own lock — nothing is attached there, so
  re-mounting on the ambient client is the repair rather than a loss.

**Signing out erases; being signed out erases nothing.** The erase runs from
`logout()`, which is also what `fetchWithAuth` calls on a 401 whose refresh
failed — and on that path it is skipped entirely.

The argument for erasing the *live* entries there was that they are copies of
content the server still holds. That is false of the only thing that matters:
a live entry is a snapshot **and its un-pushed change log**, which is precisely
the work the server does not have. Dropping it destroys the only durable copy
of unsent edits, which is this feature causing the loss it exists to prevent.
And 401 is not a page the user is looking at — `fetchWithAuth` is what every
request in the app goes through, so a single background poll answered 401 would
erase every live entry on the device, the open document's included, from a call
site unrelated to anything the user did.

The deliberate sign-out is the one that erases, archives included, and it waits
for the server to confirm: a logout request that failed leaves the user signed
in, and erasing there deletes unsent work for a sign-out that did not happen.
A shared device is covered by that sign-out, by the 30-day sweep, and by the
reconcile the next session runs — not by the 401 arm.

Once it has erased, further local writes for that account are **refused** until
somebody signs in again. `dropAllForUser` marks the keys it deleted so a
still-mounted client's next append fails loudly rather than silently; the SDK
repairs a failed append by writing a fresh snapshot, which would otherwise put
the whole document straight back on the disk the sign-out just cleared. The
preference cannot be that guard — it is still on.

The refusal is recorded in `localStorage`, not only in memory, because the tab
that signs out is not the only tab that writes. A second tab holding the same
document is a different JS realm: it never sees a module-level set, its
still-mounted client keeps appending, and the repair-by-snapshot above puts the
whole document back on the disk — with nothing left scheduled to remove it.
Enforcing the erase in one realm only would leave the feature's primary privacy
control failing silently on exactly the shared device it exists for. It names
accounts rather than devices and is cleared when that account signs in again,
so it is not a second copy of the preference.

The identity is mirrored in `localStorage` (an id, never content) because
sign-out is reachable from routes the authenticated shell does not cover, where
in-memory state is simply absent and the erase would otherwise be a silent
no-op. It is spent **only once the erase has actually happened**: forgetting it
first made a transient IndexedDB failure permanent, since nothing could then
name the account whose documents were still on the disk while the user was told
they had been signed out. A failed erase records the identity it owes work to,
and the next session's `OfflineRuntime` finishes it — whoever signs in on it.

**Both opt-in entry points are gated on `supportsClientKey()`**, not only the
code that persists. On a build pinned below `MinClientKeyVersion` nothing can
be stored, so a control offering to save documents on this device would promise
storage — and an erasure of it — that cannot happen. That is the Rollout rule
below applied to the version pin rather than to the PR order.

### Storage: `WafflebaseDocStore`

An IndexedDB implementation of the SDK's `DocStore` interface, in
`packages/frontend/src/lib/`. One database, keyed by the scoped key the SDK
supplies (`apiKey/clientKey/docKey` — already scoped by identity, so a shared
device cannot hand one account another's envelope).

**It compresses.** CRDT snapshots are extremely repetitive — every member
carries a 24-hex actor id — and gzip returns 11–18× on them:

| | raw | gzip |
|---|---|---|
| Sheet, 8,000 cells | 2.77 MB | 251 KB |
| Sheet, 2,000 cells after 5,000 edits | 3.79 MB | 309 KB |
| Note, 20,000 chars typed | 6.60 MB | 376 KB |

Fifty stored documents fall from ~139 MB to ~12 MB. `CompressionStream('gzip')`
is a browser built-in, so this costs no dependency, and the SDK stays out of it
because `DocStore` takes opaque bytes by design.

**Layout and migration.** The SDK's incremental `DocStore` wants a snapshot and
an ordered change log per document, so the database carries two object stores
plus the per-entry metadata cleanup needs. Migrating into it costs no
conversion: a store entry written by the current SDK is a `toBytes()` envelope,
and that envelope is already a valid snapshot (it embeds its own pending
changes). An `onupgradeneeded` that relocates each existing value into the
snapshot store, with an empty change log beside it, is the whole migration.

A rollback to a build that expects the old layout finds nothing where it looks
and falls through to a fresh attach — the pre-feature behavior, not a corrupt
one. Since that path is reachable by an ordinary deploy revert, the store is
versioned from its first release rather than acquiring versioning later.

**Cleanup is mostly ours, and `remove` does not mean what it looks like.**
Checked against the shipped SDK rather than assumed: `detachDocument` calls
`removeFromStore` unconditionally on its success path, so the SDK removes an
entry on **every ordinary detach** as well as on its three unrecoverable
paths. A document closed cleanly therefore cleans up after itself, and the
archive cannot simply be "what `remove` was called on" — that would keep a full
compressed copy of every document the user has ever closed, and make the
archive mean the opposite of what it is for.

The two are told apart by the app: `LocalChangesDropped` is emitted
synchronously *before* the removal on all three loss paths, so the provider
latches the key and `remove` archives only what was latched.

Everything else is still ours, because the SDK collects nothing that was not
detached:

| Trigger | Action |
|---------|--------|
| Logout, once the server confirms it | Drop every entry for that user, archives included, and refuse later writes for them |
| Session expired (401) | Nothing. A live entry carries the un-pushed change log, and nobody asked |
| Document deleted | Drop that entry, keeping its archive |
| Workspace deleted, or membership removed | Drop those entries **and their archives** |
| Every session | Drop entries **and archives** for documents the server no longer lists |
| Periodic | Drop entries untouched for 30 days, whoever wrote them (store `updatedAt` beside the envelope) |
| `QuotaExceededError` | Evict the oldest entry whose log is empty, retry once, then report undurable |

Two of those rows are about the same distinction. Losing a *document* leaves
the user their own unsent work, which is what an archive is, so the archive
stays and recovery can hand it back. Losing *access* ends the authority to read
the content at all, and recovery re-materializes a whole document from an
archive — so a membership revoked while an archive survives would hand the user
a permanent copy of content they may no longer read. Those callers drop the
archive with the entry.

Access revoked by **somebody else** reaches the affected device through none of
those rows: every one of them runs on the device of whoever made the request.
So `OfflineRuntime` asks, once per session, for the documents this account may
still read and drops what is not in the answer. Archives are enumerated
alongside the live entries — archiving deletes the header, so a document that
hit `LocalChangesDropped` is named by no header index at all and would
otherwise be structurally unreachable here — but they are **not** dropped on
the same evidence; see the per-document `403`/`404` question in
[Losing work anyway](#losing-work-anyway-return-it-as-a-document).

`OfflineRuntime` is mounted only where the feature is in play
(`supportsClientKey()`, or a device whose preference outlived a rolled-back
pin). Its effect opens the IndexedDB database and issues an unfiltered
`GET /documents` of its own, and the promise that declining the opt-in costs
nothing has to be kept by the housekeeping as much as by the client.

A failed or partial listing must never reach the purge, since it keeps only
what the list names. That is enforced by awaiting the listing and letting a
failure throw before the purge is called, and **not** by refusing an empty
array: an empty array is the correct answer for a user removed from their only
workspace, which is the very case this row exists for. Refusing it declined the
reconcile precisely when it was owed.

The thirty-day sweep is deliberately **not** scoped to the signed-in user for
live entries, and this reverses an earlier reading of the same shared-device
concern. A user who stops coming back to a shared machine is exactly the one
whose content nothing else would ever collect, so a user-scoped sweep left it
there forever while every other row in this table named the sweep as its
backstop. The policy applied is identical to the one the signed-in user's own
entries get, at the same age. Archives stay scoped: another account's is the
only copy of work their SDK could not reconcile, and it is theirs to collect.

Because that sweep reaches across accounts, so must the guard that spares a
document somebody has open. `isOpenInAnyTab` is normally asked with a `userId`,
so that another account's open document cannot defer *this* account's erase —
but asked that way by the sweep it answers "not mine, therefore idle" about a
live document and collects it, and the owning tab's later appends then find no
header and vanish silently. The store therefore takes a second, unscoped
predicate (`isOpenForAnyUser`) used by `collectStale` alone.

Eviction deletes outright — no archive, nothing offered back — so it may only
take an entry that has been compacted. A non-empty log is work that may never
have reached the server, and freeing space with it would spend one document's
unsent edits to save another's, silently, on the one failure the rest of this
design is built to survive. The store cannot tell an acked change from an
unacked one (that lives in the SDK's own header, opaque bytes here), so it
over-counts and spares an acked log too. When nothing is free to take, the
write is refused and the chip says so — a full device that reports itself full
is the honest outcome, and the only alternative on offer is a document that is
quietly no longer there.

### Client identity and the provider move

On the persisting path, the Yorkie client moves from one per session to **one
per open document**. Off that path — the preference disabled, a PDF comment
document, a share route — nothing changes and the ambient session client is
used exactly as today.

`components/collab-document-provider.tsx` is already the single seam every
editor passes through — it exists to repair `initialPresence`, and all five
detail routes plus `files/pdf-collab.tsx` render it — so it nests a
`YorkieProvider` inside itself *when persistence applies*, and renders its
children unchanged when it does not. The PDF exclusion above is derived from
the `docKey` prefix the provider already receives (`pdf-`), not from a new prop
threaded through the call sites.

Share links need one line at their route. An earlier draft of this document
claimed they were "excluded structurally" because `shared-document.tsx` mounts
its own provider — it does, but **above** `CollabDocumentProvider` rather than
instead of it, so the nesting excludes nothing. For an *anonymous* visitor the
missing identity happened to refuse the durable branch anyway; for a
**signed-in** visitor on somebody else's share link it did not, and they would
have been given their own `wb:…:{userId}:{docKey}` client authenticating with
their personal Yorkie token instead of the share token whose role and expiry
the auth webhook validates — while writing the shared document to a disk the
link's revocation cannot reach.

The refusal is therefore positional, because nothing else can express it: a
share view of `sheet-7` carries the same document key as its owner's view.
`shared-document.tsx` wraps itself in a `NonDurableScope`, a context the
decision hook reads, so the whole route opts out once rather than each of its
five document types remembering a prop.

For the same reason, the provider asks who is signed in with `fetchMeOptional`
and never `fetchMe`: it renders on the public `/shared/:token` route, and
`fetchMe` goes through `fetchWithAuth`, whose 401 arm logs the session out and
hard-redirects to `/login`.

Keeping the non-persisting path on the ambient client is what makes the opt-in
free for everyone who declines it: no second `ActivateClient`, no new identity,
no behavior change to regress.

The client key is `wb:{deviceSecret}:{userId}:{docKey}`. Scoping it to the
document (rather than to the user) keeps each document on its own server-side
client row, so one tab's detach cannot disturb another tab holding a different
document.

`deviceSecret` is 64 random bits minted once **per account per document** on
this browser profile (`wafflebase-durable-device:{userId}:{docKey}`, holding
`{s, t}`) and kept in `localStorage` — opaque, content-free, and never sent
anywhere except inside the key it salts.

Per document rather than per account, because a client key is not a secret the
way a token is: Yorkie receives it on `ActivateClient`, stores it on the client
row, and an operator reads it in a log or an admin listing. One salt shared by
every document would make any single leaked key hand the reader every *other*
key that account will ever use; a per-document salt makes a leaked key a
capability for that one client row and nothing more — the exposure the SDK's
own random per-session key already has.

What the salt defends is the **workspace peer**, who holds `userId` and
`docKey` and nothing else. It does *not* defend against somebody sitting at
this browser profile: `localStorage` is origin-scoped, so whoever can run
script on the origin reads every entry here whatever it is keyed by. An earlier
version of this section claimed per-account keying covered that case — it
cannot, and no client-side store can. Two rules bound that exposure instead:
the erase (`eraseOfflineData` → `forgetDeviceSecret`) drops every entry for an
account, so a **deliberate** sign-out leaves the next user of the machine
nothing to read; and anything untouched for thirty days is swept on the next
mint, whoever it belongs to, which is what covers the sign-out that never
happened — an expired session, a browser simply closed. The age is the store's
own, so a salt dies on the same schedule as the document it names, and a device
in daily use rewrites its timestamps (at most once a day) rather than expiring
under itself.

The salt is there because Yorkie authorizes `ActivateClient` and `DeactivateClient` on
**token validity alone**: the auth webhook gates documents, not client rows. A
key that can be *derived* is therefore one that anybody holding any valid
Yorkie token can activate or tear down, and both of the natural ingredients are
public to a workspace peer — `userId` is the sequential id every member list
carries, and `docKey` is `sheet-<documentId>` with the id sitting in the URL.
A bare `wb:{userId}:{docKey}` was guessable by exactly the people best placed
to use it, who could take over or repeatedly deactivate another member's
per-document client and strand the durable session this whole feature depends
on. The secret has to persist rather than be per-session because the SDK's
store is scoped `apiKey/clientKey/docKey`: a key that changes on every load
resumes nothing. Clearing site data mints a new one and orphans whatever was
written under the old, which the thirty-day sweep collects.

> **Trap.** `YorkieProvider` memoizes its client on `[apiKey, rpcAddr]` only.
> Navigating from document A to B changes `key` and `store` without recreating
> the client, so the provider must be rebuilt when the client key changes.
> Fixed upstream in yorkie-js-sdk#1357, which adds `clientKey` to the memo and
> effect dependencies, so no React key is needed for this at all.
>
> The preference must **not** be part of it. The durable and non-durable
> branches are different element types at one position, so a key that changes
> with the setting unmounts the `DocumentProvider` and the editor under it —
> discarding Yorkie's unsent queue, which is the loss this feature exists to
> prevent, and doing it to whoever flipped the switch in another tab. So the
> decision is latched per open (`{userId}:{docKey}`), and the preference
> reaches the documents opened after it. The identity is in the subject
> because another tab can sign this one out and somebody else in; keyed on the
> document alone, the decision would hand the new person the previous one's
> client key and store scope.

### Multi-tab

The SDK's guard is fail-fast: with a store configured, `attach` takes a Web Lock
on `apiKey/clientKey/docKey` and the second tab's attach **throws**. A document
open in two tabs is ordinary use here — presence renders it as two peers — so
failing it is not acceptable.

Nor is it enough to simply skip the store in the second tab. Today two tabs are
safe *because* the client key is random per session, giving each its own actor.
A stable key makes both tabs share one stable actor, and then a shared
checkpoint mints colliding `clientSeq` values while actor-keyed pull dedup
filters each tab's changes out of the other — silent edit loss. The second tab
needs a different **key**, not merely a disabled store.

So the app queues up first, before the SDK ever tries:

- On mount, the provider attempts an app-owned Web Lock,
  `wb-durable:{userId}:{docKey}` — a distinct name, so it cannot collide with
  the SDK's own lock.
- **Acquired** → durable client: `key = wb:{deviceSecret}:{userId}:{docKey}`
  plus the store.
  The SDK's lock is then guaranteed to succeed, because the app lock already
  elected this tab.
- **Not acquired** → `key` omitted (random, as today) and no store. Identical to
  current behavior.
- The lock is held until the view unmounts — and **only** until then, never
  released earlier because the preference flipped. The client mounted on this
  election stays mounted for the life of the open document (see the toggle rule
  above), so releasing the name under it would leave a tab writing through a
  stable client key with no election behind it: a second tab could take the same
  name, mint the same key, and share one actor, which is the silent edit loss
  the election exists to prevent. Eligibility may therefore rise mid-session
  (nothing holds the name yet, so taking it denies nobody) and never falls.

This is first-tab-wins rather than Google's model, which coordinates tabs
through a shared worker so that both can be durable. The shared-worker leader
is the better end state and is the named follow-up; it is also an SDK-level
build, and Google's own coordination is visibly imperfect — "document is open
in another tab" is a recurring support thread. First-tab-wins costs the second
tab its durability but never shows it a broken screen.

The SDK's distinct error code for lock failure (specified in the SDK document)
is still wanted, as a backstop for the race where the app lock and the SDK lock
disagree.

### What the user sees

`components/sync-status/sync-state.ts` is a pure function over a signal struct,
so it extends by one field: `durable`.

| connected | pending | durable | chip | tone |
|---|---|---|---|---|
| yes | none | – | `Saved` | muted |
| yes | pending | – | `Saving…` | muted |
| no | none | – | `Reconnecting…` | muted |
| no | pending | **yes** | `Saved to this device` | muted |
| no | pending | **no** | `Not saved` | destructive |

The fourth row dropping from destructive to muted is the entire user-facing
value of this feature. It follows Google Docs, which likewise ties the severity
of what it shows to where the pending edits actually are.

`durable` is the conjunction of three facts: this tab won the app lock, no
`PersistDisabled` event has latched this document off, and the store is not
failing its writes. The provider computes it and supplies it through context.

That third term is where every storage failure lands, which is what keeps the
chip honest without giving each failure its own surface:

| What happened | `durable` | Tooltip says |
|---|---|---|
| Offline saving not enabled on this device | false | Offer to turn it on — this is the one row that is a call to action rather than a fault |
| Second tab on this document | false | Open in another tab; that one is saving |
| IndexedDB unavailable (private browsing) | false | This browser cannot save locally |
| Document too large / too slow to snapshot | false | Too large to save on this device |
| Quota exhausted after eviction | false | Out of local storage space |
| Store writes failing | false | Could not save to this device |
| This client cannot subscribe to the SDK's durability events | false | Cannot confirm changes are being saved to this device |

Every row collapses to the same chip state and differs only in the reason, so
the user always learns *that* the guarantee has lapsed even when the cause is
one we did not anticipate. A failure the store cannot classify still flips
`durable` — the default is to under-promise.

Two consequences follow automatically: the `beforeunload` guard is suppressed
when `durable`, and the offline-transition toast changes from "keep this tab
open" to "saved to this device" (`toast.info`, finite duration — nothing is at
risk, so it notifies rather than alarms, and it is retracted and confirmed by
the same recovery arm the warning uses).

**Only `beforeunload`, though.** `sync-status.md` guards two different exits
with one condition, and durability separates them. A *reload* is the case this
state was designed for: the entry survives on disk and the next attach resumes
from it, so prompting would warn about the loss the feature just prevented. An
in-app *route change* is not the same event — it unmounts the
`DocumentProvider`, which detaches, and the SDK's `detachDocument` calls
`removeFromStore` unconditionally on its success path. The store archives a
removal only when a `LocalChangesDropped` latched it first, which an ordinary
detach never does, so leaving the document deletes the durable entry *and* the
in-memory queue with it. So the navigation guard still fires on
`saved-locally`, with wording that says what is actually about to happen:
leaving closes the document and removes that copy. (`saved-locally` is
reachable while connected, with the server rejecting pushes, so this is not a
disconnected-only path.)

The last row is the rule stated as machinery. `durable` is only worth anything
if a lapse can be *reported*, and the SDK's `local-changes-dropped` /
`persist-disabled` subscriptions are the only channel for that — `subscribe`
**throws** on an event name the pinned SDK does not know. Catching that throw
is required (it would otherwise blank the editor subtree), but catching it
silently is not enough: the loss handler is also the only caller of
`WafflebaseDocStore.expectLoss`, and `remove()` archives a document only when
that latch is set, so a swallowed failure quietly turns the loss path from
"archive the work" into "delete it". A refused subscription therefore lowers
`durable`, and a refused *loss* subscription additionally latches `expectLoss`
for that document — over-archiving costs disk the thirty-day sweep reclaims,
under-archiving costs work nothing can give back.

Because `Not saved` is now a *designed* state rather than the only state — the
second tab, an oversized document, a broken store — the chip carries the
weight that used to be carried by it simply always being true. Its tooltip must
name which case applies.

### Losing work anyway: return it as a document

`LocalChangesDropped` fires on three unrecoverable paths: `epoch-reanchor` (the
document was force-compacted while we were away), `document-purged` (it was
deleted or GC'd), and `actor-mismatch` (the stored envelope belongs to another
identity). The SDK does not replay the dropped changes; it reports them.

Rather than surface a dialog offering a JSON download, we give the user back a
document, which is what Google Docs does with its "(Conflicted copy)" file —
and we already have the machinery for it in `DocumentCopyService` /
`POST /documents/:id/copy`.

The hook is the store's own `remove` — but it is called on ordinary detaches
too, so the archive is gated on a `LocalChangesDropped` the provider latches
first. When one has been seen, `WafflebaseDocStore.remove()` **archives instead
of deleting**, moving the envelope to a separate object store. The archived bytes rehydrate through
`Document.fromBytes()` (public API, present in the shipped `.d.ts`) into a new
document titled `<title> (offline copy)`. This requires no SDK change at all.

The copy is created in the source document's workspace — a document cannot be
created without one — which exposes the content to nobody new: whoever could
read the original can read the copy.

Where the source is gone (one of the three ways an archive comes to exist in
the first place) there is no workspace to inherit, and this is the one place
the feature *publishes* local content. "The first workspace the server lists"
is every workspace the user belongs to, a shared team one included, so the
fallback prefers one the user is the **sole member** of — an audience of one,
and therefore no disclosure. Only when there is none does it use the first, and
then the offer names it ("Saving a copy puts them in *Acme*, which you share
with other people") so the click is the user's agreement rather than something
they discover afterwards in a list. Handing the work back somewhere beats
refusing because its original home was deleted; doing it without saying where
is what would be wrong.

The session-start reconcile has to be careful in the same direction, from the
other side. It drops what `GET /documents` no longer lists, and for live
entries an absence is enough. For an **archive** it is not: a document deleted
upstream is absent from that listing *because the archive's own cause
happened*, so dropping on absence destroys precisely the unsent work the offer
above exists to return, one step before the offer is made. Losing *access* is
the case that must take the archive with it, and only the server can tell the
two apart — per document, not per listing. So the reconcile asks (a `403` says
revoked, a `404` says deleted) and drops an archive on that answer alone;
anything else keeps it, bounded by the thirty-day collection.

The user is then told what happened, in the vocabulary of the three reasons,
with a link to the copy. Archived envelopes are subject to the same 30-day
collection as everything else.

### Rollout

The structural change and the behavior change land separately, so that a
regression in either is unambiguous.

| PR | Repo | Content |
|----|------|---------|
| 1 | yorkie-js-sdk | Incremental `DocStore`, presence excluded from the write path, compaction thresholds + `PersistDisabled`, distinct lock-failure error code |
| 2 | wafflebase | `WafflebaseDocStore` (gzip, archive-on-remove, cleanup) — **not yet wired**, so it is pure addition and independently testable |
| 3 | wafflebase | Per-document client, app lock, fallback — **still passing no store**. Structure only |
| 4 | wafflebase | Wire the store; the Settings + chip opt-in, `durable` chip, unload guard, toast, offline-copy recovery |
| 5 | wafflebase | Revise `sync-status.md`, which states the non-durable behavior as settled and lists an offline toggle as a Non-Goal on the grounds that there is nothing to toggle |

Because the preference ships **off**, PR 4 is a dark launch: nothing changes for
anyone until they opt in, so the blast radius of the riskiest PR is bounded by
who turned it on.

The Settings control belongs to PR 4 and not earlier, and the reason is worth
stating since PR 1's plan initially moved it forward and review moved it back:
off-by-default bounds who is *affected*, not who can *see* it. The toggle still
renders, and its copy tells the user their edits are kept and that turning it
off deletes them — two promises nothing keeps until the store is wired. A
control that ships before its behavior is not a dark launch; it is a control
that does nothing. The preference may land early because nothing reads it; the
toggle may not. It also means `sync-status.md`'s wording stays true for the
default case, which shrinks PR 5 to describing the opt-in rather than reversing
the document's premise.

**PR 4 lands inert, and stays inert until one upstream release.**
`supportsClientKey()` gates both opt-in entry points on
`@yorkie-js/react >= 0.7.23`, and at the time of writing npm's newest is
`0.7.22`, whose `YorkieProvider` spreads its props straight into
`ClientOptions` with no `clientKey` alias — so the client key cannot be passed
at all (React reserves `key` and strips it before props are formed;
yorkie-js-sdk#1357 adds the alias). Nobody on the shipped pin can turn the
feature on, which is the safe direction and not the intended one: the Goals at
the top of this document are unmet until the dependency is bumped. Bumping it
is the whole remaining action — no code here changes with it — and until then
what is being reviewed and tested is the wiring, not the behavior.

Compaction is governed by a threshold relative to each document's own snapshot
size, so it needs no per-document-type tuning here; the two constants behind it
are set in the SDK. What PR 2 measures against real documents of each type is
the store's own behavior — compression ratios, write latency, and where quota
pressure actually begins.

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| A user edits in the non-durable second tab believing it is saved | The chip is the only thing standing between them and that belief, which is why `durable` is a first-class signal and not a cosmetic touch. Its tooltip names the reason |
| Per-document clients add an `ActivateClient` round trip per document open | Accepted. It is one RPC against an editor open; in exchange each document gets an isolated server client row |
| The opt-in is off by default, so most users never get the protection this exists to give | Accepted, and the reason the sync chip offers the toggle where the user actually feels the need. Measure adoption before considering a different default |
| IndexedDB is unavailable (private browsing, disabled storage) | The store reports failure, `durable` stays false, and the chip degrades to today's behavior. Same shape as the second-tab path, so no separate code path |
| An oversized document latches persistence off and looks the same as a bug | `PersistDisabled` carries a reason, and the chip says the document is too large to save on this device — matching what Google's help documentation tells the user ("your file is too large") |
| Archived envelopes accumulate after repeated reconciliation failures | Subject to the same 30-day collection; the offline copy, once created, is a normal document that the user owns |
| ~~The SDK work (PR 1) slips, tempting a ship on the current full-snapshot SDK~~ | **Resolved** — shipped in `@yorkie-js/sdk` 0.7.22 and adopted in #1071. Kept for the reasoning, which still applies to any pin below 0.7.22: on a full-snapshot SDK the frame-budget latch excludes most sheets, boards and docs, so the feature would silently cover only small documents |

## See Also

- [sync-status.md](sync-status.md) — makes the exposure visible; this document
  closes it, and that document's wording is revised when this ships
- [frontend.md](frontend.md) — the Yorkie client and presence architecture this
  moves from per-session to per-document
- [document-copy.md](document-copy.md) — the copy engine the offline-copy
  recovery path reuses
