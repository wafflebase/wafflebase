import { describe, expect, it } from 'vitest';
import { deriveSyncState } from '@/components/sync-status/sync-state';

/**
 * The whole feature turns on one decision: severity keys on whether there are
 * unpushed local changes, NOT on connectivity. A disconnected reader has
 * nothing to lose and must stay muted; a disconnected editor with a non-empty
 * queue is the only case that warrants alarm.
 *
 * See docs/design/sync-status.md.
 */
describe('deriveSyncState', () => {
  it('is saved when connected with an empty queue', () => {
    expect(
      deriveSyncState({ connected: true, pending: false, syncFailed: false }),
    ).toBe('saved');
  });

  it('is saving when connected with changes still in flight', () => {
    expect(
      deriveSyncState({ connected: true, pending: true, syncFailed: false }),
    ).toBe('saving');
  });

  it('is reconnecting when disconnected with nothing to lose', () => {
    expect(
      deriveSyncState({ connected: false, pending: false, syncFailed: false }),
    ).toBe('reconnecting');
  });

  it('is not-saved when disconnected with unpushed changes', () => {
    expect(
      deriveSyncState({ connected: false, pending: true, syncFailed: false }),
    ).toBe('not-saved');
  });

  it('is not-saved when a push was rejected while still connected', () => {
    // A rejected push leaves the changes in the queue, so "Saving…" would
    // claim progress that is not happening.
    expect(
      deriveSyncState({ connected: true, pending: true, syncFailed: true }),
    ).toBe('not-saved');
  });

  it('ignores a sync failure once the queue has drained', () => {
    // A failed *pull* costs the user none of their own work; reporting it as
    // "Not saved" would be alarm with no consequence behind it.
    expect(
      deriveSyncState({ connected: true, pending: false, syncFailed: true }),
    ).toBe('saved');
  });
});

/**
 * Offline local persistence adds one fact — the pending work is on this
 * device's disk — and it changes exactly one row.
 *
 * See docs/design/offline-local-persistence.md § What the user sees.
 */
describe('deriveSyncState with local durability', () => {
  it('is muted rather than loud when disconnected work is on disk', () => {
    expect(
      deriveSyncState({
        connected: false,
        pending: true,
        syncFailed: false,
        durable: true,
      }),
    ).toBe('saved-locally');
  });

  it('stays loud when the same work is only in the tab', () => {
    expect(
      deriveSyncState({
        connected: false,
        pending: true,
        syncFailed: false,
        durable: false,
      }),
    ).toBe('not-saved');
  });

  it('is muted when a push keeps being rejected but the work is on disk', () => {
    // Being connected does not make unsent work sent. The edits are exactly as
    // unsent as when the connection dropped, and exactly as safe on disk.
    expect(
      deriveSyncState({
        connected: true,
        pending: true,
        syncFailed: true,
        durable: true,
      }),
    ).toBe('saved-locally');
  });

  it('changes nothing when there is no pending work', () => {
    // Durability is about what happens to unsent edits. With none, the chip
    // has nothing different to say, and saying it anyway would be noise on the
    // state the user sees almost always.
    expect(
      deriveSyncState({
        connected: true,
        pending: false,
        syncFailed: false,
        durable: true,
      }),
    ).toBe('saved');
    expect(
      deriveSyncState({
        connected: false,
        pending: false,
        syncFailed: false,
        durable: true,
      }),
    ).toBe('reconnecting');
  });

  it('does not interrupt a push that is in flight', () => {
    expect(
      deriveSyncState({
        connected: true,
        pending: true,
        syncFailed: false,
        durable: true,
      }),
    ).toBe('saving');
  });

  it('defaults to not durable, so every existing caller is unchanged', () => {
    expect(
      deriveSyncState({ connected: false, pending: true, syncFailed: false }),
    ).toBe('not-saved');
  });
});
