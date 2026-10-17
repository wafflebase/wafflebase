# Offline Persistence Opt-In (W1)

**Created**: 2026-09-16

The per-device preference that gates offline local persistence. First of five
wafflebase PRs for the feature, and the only one that touches no Yorkie code
at all — and, after review, the only one with no user-visible surface either:
the Settings section it was going to ship moved to W4. See Scope.

Design: [`docs/design/offline-local-persistence.md`](../../design/offline-local-persistence.md)
§ Turning it on.

## Why this lands first and alone

It has no dependency on the SDK work (yorkie-js-sdk#1354) and nothing depends
on it except W3, so it can land while that PR is still in review. It is the
piece that decides whether *anything* persists, so having it in place first
means every later PR is dark by default rather than shipping behavior nobody
asked for.

What "dark" means got sharpened by review, though. Landing the preference
early is fine because nothing reads it. Landing the *toggle* early is not:
an off-by-default control still renders, and a user who turns it on is told
their edits are kept when they are not. So the gate ships here and the control
ships with the behavior.

## The decisions this encodes

Both come from the design doc and neither is arbitrary:

- **Off by default.** Persisting writes document content to the disk of
  whatever machine the user is on, where it outlives the session. Google's
  offline mode requires an explicit one-time enable for the same reason.
- **Per device, never per account.** An account-level setting would follow the
  user onto a shared machine and re-enable there — precisely the case the
  toggle exists to prevent. So it is `localStorage`, like the other two
  preferences in Settings, and not a column on `User`.

## Scope

In:

- [x] `lib/offline-persistence-preference.ts` — read / write / subscribe
- [x] Unit tests for the preference module

Out:

- **The Settings section — moved to W4.** It was written here (Task 2 below)
  and then removed from the branch before merge. A toggle is a promise: the
  copy tells the user their edits are kept and that turning it off deletes
  them, and neither is true until W4 wires the store. Shipping the control
  first is not a dark launch, it is a control that does nothing. So the
  section lands in the PR that makes it work, and W1 is infrastructure with
  no consumer.
- The `DocStore` itself (W2), the per-document client (W3), wiring the store
  and the chip (W4), offline-copy recovery (W5)
- Any change to `sync-status.md` — its wording stays true while the preference
  is off, which is the default; W4 revises it

## Task 1: the preference module

**Files:** create `packages/frontend/src/lib/offline-persistence-preference.ts`,
create `packages/frontend/src/lib/__tests__/offline-persistence-preference.test.ts`

Mirror `lib/date-format-preference.ts` rather than inventing a shape: it
already solves same-tab notification (a custom event beside `storage`, which
only fires in *other* tabs) and a storage that refuses writes.

- [x] **1.1** Write the failing tests:

```ts
it('defaults to off', () => {
  assert.isFalse(getOfflinePersistenceEnabled());
});

it('round-trips through localStorage', () => {
  setOfflinePersistenceEnabled(true);
  assert.isTrue(getOfflinePersistenceEnabled());
});

it('notifies subscribers in the same tab', () => {
  // `storage` only fires in other tabs, so Settings and an editor mounted in
  // the same tab need their own event or the editor never learns.
  let calls = 0;
  const unsubscribe = subscribeOfflinePersistence(() => { calls += 1; });
  setOfflinePersistenceEnabled(true);
  assert.equal(calls, 1);
  unsubscribe();
});

it('keeps the choice for the session when storage refuses the write', () => {
  // Safari private mode throws on setItem. A browser that will not persist a
  // preference is also one that will not give us IndexedDB, so the store
  // reports itself undurable for its own reasons — but the toggle must not
  // silently snap back in the UI.
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  setOfflinePersistenceEnabled(true);
  assert.isTrue(getOfflinePersistenceEnabled());
});

it('reads as off when touching localStorage throws', () => {
  // SecurityError in Safari private mode and sandboxed iframes. This is a
  // `useSyncExternalStore` snapshot, so a throw here runs during render.
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  assert.isFalse(getOfflinePersistenceEnabled());
});
```

- [x] **1.2** Run them. Expect failure: module not found.
- [x] **1.3** Implement, following `date-format-preference.ts`: a
      `STORAGE_KEY`, a same-tab `CHANGE_EVENT`, a session-only mirror set
      **only** when a write failed (and cleared on success, so a stale mirror
      cannot outvote a key another tab has since changed), and a
      `useOfflinePersistenceEnabled()` hook over `useSyncExternalStore`.
- [x] **1.4** Run the tests. Expect pass.
- [x] **1.5** `pnpm verify:fast`
- [x] **1.6** Commit: `Add a per-device offline persistence preference`

## Task 2: the Settings section — **deferred to W4, not done here**

Written and working, then removed from the branch (`37d68ab0f`, dropped by
rebase). It is kept below because W4 inherits it verbatim: the code, the test,
and the reason the copy says what it says. Recovering it is
`git show 37d68ab0f`.

The four tests it came with — the switch renders off, toggling it flips the
preference, an already-on preference renders checked, and the copy names both
the device and the deletion — move with it.

**Files (for W4):** `packages/frontend/src/app/settings/page.tsx`,
`packages/frontend/src/app/settings/__tests__/page.test.tsx` (create if absent)

- [ ] **2.1** Write the failing test: the switch renders off, toggling it calls
      the setter, and the copy names the device rather than the account.
- [ ] **2.2** Run it. Expect failure.
- [ ] **2.3** Add the section, matching the existing two:

```tsx
<section className="space-y-2">
  <h2 className="text-lg font-semibold">Offline</h2>
  <div className="flex items-center justify-between rounded-md border p-4">
    <div>
      <label htmlFor="offline-switch" className="text-sm font-medium">
        Save documents on this device
      </label>
      <p className="text-xs text-muted-foreground">
        Keeps your edits if you lose connection or close the tab before they
        reach the server. They are stored on this device only — turning this
        off deletes them.
      </p>
    </div>
    <Switch
      id="offline-switch"
      checked={enabled}
      onCheckedChange={setOfflinePersistenceEnabled}
    />
  </div>
</section>
```

The copy has to carry two facts the user cannot otherwise know: that it is
*this device*, and that turning it off erases. Both are design commitments, not
wording preferences.

- [ ] **2.4** Run the test. Expect pass.
- [ ] **2.5** `pnpm verify:fast`
- [ ] **2.6** Commit: `Offer offline saving from Settings`

## Verification

- [x] `pnpm verify:fast` green; `pnpm verify:self` green (pre-push); CI green
- [x] `git diff` touches no Yorkie code — this PR cannot change sync behavior
- [x] No manual smoke needed: with the Settings section deferred, this PR
      renders nothing. It was attempted first and blocked on sign-in anyway;
      it moves to W4, where there is something to look at.

## Review

PR: wafflebase#1070. Two code commits, the rest docs.

**Landed smaller than planned.** Review caught that the Settings toggle
promises both halves of a behavior that does not exist yet — it says edits are
kept, and that turning it off deletes them — so the section moved to W4 and
this PR ships the preference module alone. The commit was dropped from the
branch by rebase rather than reverted, so the history does not carry a
"add it, take it back" pair; `git show 37d68ab0f` still has it, and Task 2
above names that SHA for W4.

Three smaller deviations:

- The preference test is colocated (`lib/*.test.ts`), not in `lib/__tests__/`
  — `lib/` colocates and `app/` does not.
- Seven preference tests rather than five: the two extra pin that the setter
  never throws out of a switch handler, and that a successful write stops the
  session mirror from outvoting storage. The second is the one that matters,
  and its first version passed on the bug (see the lessons file).
- `docs/design/offline-local-persistence.md` referenced the SDK design as a
  backticked sibling path, which `verify:entropy` reads as a claim about a
  tracked file. It blocks `git push`, not `verify:fast`, so it surfaced late.

**What W4 inherits.** Not just the section, but the rule the review
established: the control and the behavior ship together. W4 wires the store,
adds the Settings section, and implements the erase, or it ships none of them.
