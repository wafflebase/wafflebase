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
- Toggling mid-session must remount the provider, so the flag joins `docKey` in
  its React `key`.

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
| Logout | Drop every entry for that user |
| Document deleted, or workspace access lost | Drop that entry |
| Periodic | Drop entries untouched for 30 days (store `updatedAt` beside the envelope) |
| `QuotaExceededError` | Evict oldest-first, retry once, then report undurable |

### Client identity and the provider move

On the persisting path, the Yorkie client moves from one per session to **one
per open document**. Off that path — the preference disabled, a PDF comment
document, a share route — nothing changes and the ambient session client is
used exactly as today.

`components/collab-document-provider.tsx` is already the single seam every
editor passes through — it exists to repair `initialPresence`, and all five
detail routes plus `files/pdf-collab.tsx` render it — so it nests a
`YorkieProvider` inside itself *when persistence applies*, and renders its
children unchanged when it does not. No route file changes: the PDF exclusion
above is derived from the `docKey` prefix the provider already receives
(`pdf-`), not from a new prop threaded through the call sites.
`shared-document.tsx` mounts its own provider and is therefore excluded
structurally, without a conditional.

Keeping the non-persisting path on the ambient client is what makes the opt-in
free for everyone who declines it: no second `ActivateClient`, no new identity,
no behavior change to regress.

The client key is `wb:{userId}:{docKey}`. Scoping it to the document (rather
than to the user) keeps each document on its own server-side client row, so one
tab's detach cannot disturb another tab holding a different document.

> **Trap.** `YorkieProvider` memoizes its client on `[apiKey, rpcAddr]` only.
> Navigating from document A to B changes `key` and `store` without recreating
> the client, so the provider must be given a React key covering both the
> document and the preference — `key={`${docKey}:${enabled}`}` — which also
> makes toggling the setting mid-session take effect.

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
- **Acquired** → durable client: `key = wb:{userId}:{docKey}` plus the store.
  The SDK's lock is then guaranteed to succeed, because the app lock already
  elected this tab.
- **Not acquired** → `key` omitted (random, as today) and no store. Identical to
  current behavior.
- The lock is held until the view unmounts.

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

Every row collapses to the same chip state and differs only in the reason, so
the user always learns *that* the guarantee has lapsed even when the cause is
one we did not anticipate. A failure the store cannot classify still flips
`durable` — the default is to under-promise.

Two consequences follow automatically: the `beforeunload` guard is suppressed
when `durable`, and the offline-transition toast changes from "keep this tab
open" to "saved to this device".

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
