# Offline Persistence Opt-In (W1)

**Created**: 2026-09-16

The per-device preference that gates offline local persistence, plus its
Settings section. First of five wafflebase PRs for the feature, and the only
one that touches no Yorkie code at all.

Design: [`docs/design/offline-local-persistence.md`](../../design/offline-local-persistence.md)
§ Turning it on.

## Why this lands first and alone

It has no dependency on the SDK work (yorkie-js-sdk#1354) and nothing depends
on it except W3, so it can land while that PR is still in review. It is also
the piece that decides whether *anything* persists, so having it in place first
means every later PR is dark by default rather than shipping behavior nobody
asked for.

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

- [ ] `lib/offline-persistence-preference.ts` — read / write / subscribe
- [ ] A Settings section, beside Appearance and Dates
- [ ] Unit tests for the preference module and the Settings control

Out:

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

- [ ] **1.1** Write the failing tests:

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

- [ ] **1.2** Run them. Expect failure: module not found.
- [ ] **1.3** Implement, following `date-format-preference.ts`: a
      `STORAGE_KEY`, a same-tab `CHANGE_EVENT`, a session-only mirror set
      **only** when a write failed (and cleared on success, so a stale mirror
      cannot outvote a key another tab has since changed), and a
      `useOfflinePersistenceEnabled()` hook over `useSyncExternalStore`.
- [ ] **1.4** Run the tests. Expect pass.
- [ ] **1.5** `pnpm verify:fast`
- [ ] **1.6** Commit: `Add a per-device offline persistence preference`

## Task 2: the Settings section

**Files:** `packages/frontend/src/app/settings/page.tsx`,
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

- [ ] `pnpm verify:fast` green
- [ ] Manual smoke in `pnpm dev`: toggle persists across a reload, and a second
      tab opened after the change reads the new value
- [ ] `git diff` touches no Yorkie code — this PR cannot change sync behavior

## Review

_Filled in when the PR lands._
