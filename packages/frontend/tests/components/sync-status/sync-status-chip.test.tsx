import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx: { doc: FakeDoc | undefined; connection: string };

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => mockCtx,
}));

const warning = vi.fn();
const success = vi.fn();
const dismiss = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => warning(...args),
    success: (...args: unknown[]) => success(...args),
    dismiss: (...args: unknown[]) => dismiss(...args),
  },
}));

import { SyncStatusChip } from '@/components/sync-status/sync-status-chip';
import {
  hasUnsavedWork,
  resetUnsavedWorkProbes,
} from '@/lib/unsaved-work';
import { DurableDocumentScope } from '@/lib/durable-document-context';
import type { WafflebaseDocStore } from '@/lib/wafflebase-doc-store';
import { TooltipProvider } from '@/components/ui/tooltip';

type DocEvent = { type: string; value: unknown };

interface FakeDoc {
  getCheckpoint: () => { getClientSeq: () => number };
  subscribe: (
    arg1: string | ((e: DocEvent) => void),
    arg2?: (e: DocEvent) => void,
  ) => () => void;
  /** Test control: the user edited the document. */
  type: () => void;
  /** Test control: the server accepted everything pushed so far. */
  ack: () => void;
  /** Test control: fire a document event of the given type. */
  emit: (type: string, value?: unknown) => void;
}

const DEFAULT_STREAM = '__default__';

/** The same model `use-sync-status.test.ts` documents in full. */
function fakeDoc(): FakeDoc {
  let clientSeq = 0;
  let acked = 0;
  const handlers = new Map<string, Array<(e: DocEvent) => void>>();
  const on = (key: string, cb: (e: DocEvent) => void) => {
    const list = handlers.get(key) ?? [];
    list.push(cb);
    handlers.set(key, list);
    return () => handlers.set(key, (handlers.get(key) ?? []).filter((h) => h !== cb));
  };
  return {
    getCheckpoint: () => ({ getClientSeq: () => acked }),
    subscribe: (arg1, arg2) =>
      typeof arg1 === 'function' ? on(DEFAULT_STREAM, arg1) : on(arg1, arg2!),
    type: () => {
      clientSeq++;
      for (const h of handlers.get(DEFAULT_STREAM) ?? []) {
        h({ type: 'local-change', value: { clientSeq } });
      }
    },
    ack: () => {
      acked = clientSeq;
    },
    emit: (type, value) => {
      for (const key of [type, DEFAULT_STREAM]) {
        for (const h of handlers.get(key) ?? []) h({ type, value });
      }
    },
  };
}

function renderChip() {
  return render(
    <TooltipProvider>
      <SyncStatusChip />
    </TooltipProvider>,
  );
}

/**
 * The chip under a durable client — the one thing this feature changes.
 *
 * The provider publishes durability through context, which is the seam the
 * chip reads; supplying it here is what lets these cases ask whether the state
 * actually reaches the user rather than only whether the pure function can
 * compute it.
 */
function renderDurableChip() {
  return render(
    <TooltipProvider>
      <DurableDocumentScope
        value={{
          store: {} as WafflebaseDocStore,
          durable: true,
          reportLoss: () => {},
        }}
      >
        <SyncStatusChip />
      </DurableDocumentScope>
    </TooltipProvider>,
  );
}

const addSpy = vi.spyOn(window, 'addEventListener');
const removeSpy = vi.spyOn(window, 'removeEventListener');

function unloadGuards() {
  return (
    addSpy.mock.calls.filter(([type]) => type === 'beforeunload').length -
    removeSpy.mock.calls.filter(([type]) => type === 'beforeunload').length
  );
}

/**
 * Fires the currently-registered `beforeunload` handler and reports whether it
 * actually blocked. Registration alone is not the behaviour that matters — the
 * handler decides at fire time whether anything is really at risk.
 */
function prevented(): boolean {
  const calls = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
  const handler = calls.at(-1)?.[1] as ((e: Event) => void) | undefined;
  if (!handler) return false;
  let blocked = false;
  handler({
    preventDefault: () => {
      blocked = true;
    },
  } as unknown as Event);
  return blocked;
}

beforeEach(() => {
  vi.useFakeTimers();
  addSpy.mockClear();
  removeSpy.mockClear();
  warning.mockClear();
  success.mockClear();
  dismiss.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  resetUnsavedWorkProbes();
});

describe('SyncStatusChip', () => {
  it('names the state when unpushed edits are stranded', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();
    act(() => { doc.type(); });

    expect(screen.getByText('Not saved')).toBeTruthy();
  });

  it('stays muted for a disconnected reader with nothing queued', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();

    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.queryByText('Not saved')).toBeNull();
  });

  it('stops blocking the unload once the work is on the server', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => { doc.type(); });
    expect(prevented()).toBe(true);

    // Reconnect and let the server take it.
    mockCtx = { doc, connection: 'connected' };
    act(() => {
      doc.ack();
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
      vi.advanceTimersByTime(5000);
    });

    expect(prevented()).toBe(false);
    // ...and by then the listener is gone too, so a synced document carries no
    // handler at all.
    expect(unloadGuards()).toBe(0);
  });

  it('guards an edit that is still in flight, not only a stranded one', () => {
    // `Saving…` also means the work is not on the server yet. Reloading here
    // loses it just as surely as reloading while disconnected does.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    renderChip();

    act(() => {
      doc.type();
    });

    expect(prevented()).toBe(true);
  });

  it('does not prompt once the edit is accepted, even while still showing Saving', () => {
    // The chip holds `Saving…` for a quiet window after the last keystroke, so
    // guarding on the label alone would prompt on every reload for two seconds
    // after any edit — with nothing actually at risk. The handler asks the
    // document at fire time instead.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    const { container } = renderChip();

    act(() => {
      doc.type();
      doc.ack();
    });

    expect(container.textContent).toContain('Saving');
    expect(prevented()).toBe(false);
  });

  it('names the cause when the server rejected the push', () => {
    // `Not saved` is reached two ways. Telling a user whose connection is fine
    // that "your connection dropped" sends them to debug the wrong thing.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    renderChip();
    act(() => {
      doc.type();
      doc.emit('sync', 'sync-failed');
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(warning).toHaveBeenCalledTimes(1);
    const description = String(
      (warning.mock.calls[0][1] as { description?: string })?.description ?? '',
    );
    expect(description).not.toMatch(/connection dropped/i);
    expect(description).toMatch(/reject/i);
  });

  it('never arms the unload guard for a healthy document', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    renderChip();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(unloadGuards()).toBe(0);
  });

  it('warns once the stranded state has lasted past the debounce', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();
    act(() => { doc.type(); });
    expect(warning).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a blip that resolves inside the debounce', () => {
    // A watch stream that drops a single frame recovers on its own. Toasting
    // that would train users to ignore the toast.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => { doc.type(); });

    // Two acts, deliberately: React must process the reconnect before the
    // clock is allowed to reach the debounce, which is the real ordering.
    // Advancing inside the same act would fire the pending timer before the
    // effect that cancels it had ever run.
    mockCtx = { doc, connection: 'connected' };
    doc.ack();
    act(() => {
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(warning).not.toHaveBeenCalled();
  });

  it('retracts its warning when it unmounts', () => {
    // `<Toaster />` lives outside the router (App.tsx), and the warning is
    // `duration: Infinity` with no close button. Leaving the editor by any
    // in-app link would otherwise strand a red "Not saved" on every other
    // page for the rest of the session, with no way to dismiss it and no
    // later recovery able to retract it.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { unmount } = renderChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(warning).toHaveBeenCalledTimes(1);

    unmount();

    expect(dismiss).toHaveBeenCalled();
  });

  it('does not confirm a rescue the server has not performed yet', () => {
    // Reconnecting moves the state to `saving`, not `saved` — the push has not
    // even been attempted. Confirming there would hand the user a receipt for
    // work that can still be rejected, which is the exact failure this whole
    // feature exists to prevent.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(warning).toHaveBeenCalledTimes(1);

    // Connection back, but nothing acknowledged.
    mockCtx = { doc, connection: 'connected' };
    act(() => {
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
    });

    expect(success).not.toHaveBeenCalled();
  });

  it('confirms only once the server has actually taken the work', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    mockCtx = { doc, connection: 'connected' };
    doc.ack();
    act(() => {
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(success).toHaveBeenCalledTimes(1);
    // Stable id, so a flapping connection replaces the confirmation rather
    // than stacking a new one on every recovery.
    expect(success).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: expect.anything() }),
    );
  });

  it('offers its explanation to the keyboard, not only the mouse', () => {
    // The tooltip carries the "this tab is the only copy" wording — the most
    // load-bearing text in the feature. Radix adds no tabIndex to a bare span,
    // so without one it is hover-only.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { container } = renderChip();
    act(() => {
      doc.type();
    });

    expect(container.querySelector('[role="status"]')?.getAttribute('tabindex')).toBe('0');
  });

  it('does not claim the work is stored locally', () => {
    // The SDK persists nothing; wording that implies otherwise would be a
    // false promise to a user who then reloads. See docs/design/sync-status.md.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { container } = renderChip();
    act(() => { doc.type(); });

    expect(container.textContent).not.toMatch(/this device|saved locally|offline/i);
  });
});

/**
 * The chip is also the app's answer to "would replacing this document lose
 * something?", asked by the chunk-load recovery in `lib/lazy-with-retry.ts`
 * rather than by the browser. `beforeunload` does not cover a reload this app
 * initiates itself, and iOS ignores it besides.
 */
describe('SyncStatusChip unsaved-work probe', () => {
  it('reports nothing at risk while the document is synced', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    renderChip();

    expect(hasUnsavedWork()).toBe(false);
  });

  it('reports work at risk once an edit is stranded', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();
    act(() => { doc.type(); });

    expect(hasUnsavedWork()).toBe(true);
  });

  it('answers at call time, not at registration time', () => {
    // The same split the unload guard uses: registration is the smoothed
    // state, the answer is the live read. A probe that latched would refuse
    // recovery for two seconds after every keystroke.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();
    act(() => { doc.type(); });
    expect(hasUnsavedWork()).toBe(true);

    act(() => { doc.ack(); });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('stops answering once the chip unmounts', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { unmount } = renderChip();
    act(() => { doc.type(); });
    expect(hasUnsavedWork()).toBe(true);

    unmount();

    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('the offer to turn offline saving on', () => {
  it('never promises to save the changes it is shown beside', async () => {
    // The preference is read when a document opens and held until it closes,
    // so accepting this offer reaches the documents opened after it and never
    // the one the toast is about. Copy that says otherwise invites the exact
    // sequence it warns about: click, reload, lose the work.
    vi.stubGlobal('__YORKIE_REACT_VERSION__', '0.7.23');
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const options = warning.mock.calls[0][1] as {
      action?: { label: string };
    };
    expect(options.action?.label).toBeTruthy();
    // "Save on this device", sitting under "closing it will lose them", reads
    // as an offer to save *them*.
    expect(options.action!.label).not.toMatch(/^save /i);
    expect(options.action!.label).toMatch(/later/i);
    vi.unstubAllGlobals();
  });
});

describe('SyncStatusChip on a durable document', () => {
  it('reports the work as saved to this device instead of not saved', () => {
    // The entire user-facing value of offline persistence: the same situation
    // drops from destructive to muted, because the pending work is on disk.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { container } = renderDurableChip();
    act(() => {
      doc.type();
    });

    expect(screen.getByText('Saved to this device')).toBeTruthy();
    expect(screen.queryByText('Not saved')).toBeNull();
    // And it is not dressed as an alarm — no destructive colouring, since
    // nothing is about to be lost.
    expect(
      container.querySelector('[role="status"]')?.className ?? '',
    ).not.toMatch(/destructive/);
  });

  it('announces politely rather than interrupting a screen reader', () => {
    // `assertive` is reserved for the one state where closing the tab destroys
    // work. This is not it, and announcing it as if it were would make the
    // urgent case indistinguishable from the safe one.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const { container } = renderDurableChip();
    act(() => {
      doc.type();
    });

    expect(
      container.querySelector('[role="status"]')?.getAttribute('aria-live'),
    ).toBe('polite');
  });

  it('neither warns nor guards the unload', () => {
    // Deliberate, and the reason the state exists: closing the tab no longer
    // ends these edits, so interrupting the user would be a false alarm.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderDurableChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(warning).not.toHaveBeenCalled();
    expect(unloadGuards()).toBe(0);
  });

  it('still says Saving while the push is in flight', () => {
    // Durability changes the stranded row and nothing else: connected with
    // work outstanding is still on its way to the server.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    const { container } = renderDurableChip();
    act(() => {
      doc.type();
    });

    expect(container.textContent).toContain('Saving');
  });
});
