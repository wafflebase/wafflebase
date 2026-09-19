import { render, screen, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx: { doc: FakeDoc | undefined; connection: string };

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => mockCtx,
}));

const warning = vi.fn();
const success = vi.fn();
const info = vi.fn();
const dismiss = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => warning(...args),
    success: (...args: unknown[]) => success(...args),
    info: (...args: unknown[]) => info(...args),
    dismiss: (...args: unknown[]) => dismiss(...args),
  },
}));

import { SyncStatusChip } from '@/components/sync-status/sync-status-chip';
import { tooltipFor } from '@/components/sync-status/sync-status-tooltip';
import {
  hasUnsavedWork,
  resetUnsavedWorkProbes,
} from '@/lib/unsaved-work';
import {
  getOfflinePersistenceEnabled,
  setOfflinePersistenceEnabled,
} from '@/lib/offline-persistence-preference';
import {
  DurabilityLapseScope,
  DurableDocumentScope,
  type DurabilityLapse,
} from '@/lib/durable-document-context';
import type { WafflebaseDocStore } from '@/lib/wafflebase-doc-store';
import {
  GuardRegistryContext,
  type NavigationGuard,
} from '@/components/navigation-guard/use-navigation-guard';
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
          reportPersistDisabled: () => {},
          reportUnreportable: () => {},
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
  info.mockClear();
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
  /** A stranded chip on a build that can honour the offer. */
  function renderStranded() {
    vi.stubGlobal('__YORKIE_REACT_VERSION__', '0.7.23');
    setOfflinePersistenceEnabled(false);
    success.mockClear();
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const view = renderChip();
    act(() => {
      doc.type();
    });
    return view;
  }

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('turns the preference on when the chip itself is clicked', () => {
    // The chip is the second of the design's two entry points, and the one
    // somebody is actually looking at when they discover they wanted the
    // setting. Nothing exercised the click, so the whole branch — button,
    // handler, confirmation — could have been inert.
    renderStranded();

    const chip = screen.getByRole('status');
    expect(chip.tagName).toBe('BUTTON');
    act(() => {
      fireEvent.click(chip);
    });

    expect(getOfflinePersistenceEnabled()).toBe(true);
    // Confirmed, and honestly: the decision to persist is made when a document
    // opens, so this one is not rescued retroactively.
    expect(success).toHaveBeenCalledTimes(1);
    const [, options] = success.mock.calls.at(-1) as [
      string,
      { description: string },
    ];
    expect(options.description).toMatch(/from now on/i);
  });

  it('stops offering once the device has opted in', () => {
    // A call to action that survives being accepted re-warns the user about a
    // setting they have already turned on.
    renderStranded();
    act(() => {
      fireEvent.click(screen.getByRole('status'));
    });

    expect(screen.getByRole('status').tagName).toBe('SPAN');
  });

  it('turns it on from the toast, which is where the interruption lands', () => {
    renderStranded();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const options = warning.mock.calls.at(-1)?.[1] as {
      action?: { onClick: () => void };
    };
    act(() => {
      options.action!.onClick();
    });

    expect(getOfflinePersistenceEnabled()).toBe(true);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('offers nothing on a build that could not honour it', () => {
    // Every surface goes behind the capability check, not only the code that
    // persists: a build below `MinClientKeyVersion` can store nothing, so the
    // offer would promise storage — and an erasure of it — that cannot happen.
    vi.stubGlobal('__YORKIE_REACT_VERSION__', '0.7.22');
    setOfflinePersistenceEnabled(false);
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderChip();
    act(() => {
      doc.type();
    });

    expect(screen.getByRole('status').tagName).toBe('SPAN');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const options = warning.mock.calls.at(-1)?.[1] as {
      action?: unknown;
    };
    expect(options.action).toBeUndefined();
  });

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

describe('the offer on a document that can never be durable', () => {
  /**
   * `docs/design/offline-local-persistence.md` § Who gets it excludes
   * anonymous share links outright, and `shared-document.tsx` wraps the whole
   * route in `NonDurableScope` — which publishes `not-permitted`. Offering the
   * preference there promises a visitor something that cannot happen for the
   * document in front of them however they answer, and an anonymous one has no
   * account for it to apply to at all.
   */
  function renderWithLapse(lapse: DurabilityLapse) {
    vi.stubGlobal('__YORKIE_REACT_VERSION__', '0.7.23');
    setOfflinePersistenceEnabled(false);
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const view = render(
      <TooltipProvider>
        <DurabilityLapseScope lapse={lapse}>
          <SyncStatusChip />
        </DurabilityLapseScope>
      </TooltipProvider>,
    );
    act(() => {
      doc.type();
    });
    return view;
  }

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('makes no offer on a share link', () => {
    renderWithLapse('not-permitted');

    // Still the status, never the call to action.
    expect(screen.getByRole('status').tagName).toBe('SPAN');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const options = warning.mock.calls[0]?.[1] as
      | { action?: { label: string } }
      | undefined;
    expect(options?.action).toBeUndefined();
  });

  it('still offers it where the feature is merely switched off', () => {
    // The control case, so the suppression above is about `not-permitted` and
    // not about the offer having quietly stopped working.
    renderWithLapse('not-enabled');

    expect(screen.getByRole('status').tagName).toBe('BUTTON');
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

  it('says where the work went instead of saying nothing', () => {
    // `docs/design/offline-local-persistence.md`: the offline-transition toast
    // "changes from 'keep this tab open' to 'saved to this device'". Dropping
    // it entirely leaves the durable case as the one where the app says
    // nothing at all about work it has stopped sending to the server.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    renderDurableChip();
    act(() => {
      doc.type();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(info).toHaveBeenCalled();
    const [title, options] = info.mock.calls[0] as [
      string,
      { description?: string },
    ];
    expect(title).toMatch(/this device/i);
    // And it must not repeat the sentence it replaces.
    expect(options.description ?? '').not.toMatch(/keep this tab open/i);
    expect(options.description ?? '').toMatch(/saved on this device/i);
  });

  it('still holds back in-app navigation, which closes the document', () => {
    // A reload is safe — the entry is on disk and the next attach resumes from
    // it — but leaving the route is not the same event. It unmounts the
    // `DocumentProvider`, which detaches, and the SDK's `detachDocument` calls
    // `removeFromStore` unconditionally on its success path; the store archives
    // a removal only when a `LocalChangesDropped` latched it first, which an
    // ordinary detach never does. So the click deletes the durable entry and
    // the in-memory queue with it, silently, on the one state whose whole claim
    // is that the work is safe.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };

    const guards: Array<NavigationGuard> = [];
    render(
      <TooltipProvider>
        <GuardRegistryContext.Provider
          value={{
            register: (guard) => {
              guards.push(guard);
              return () => {
                const at = guards.indexOf(guard);
                if (at !== -1) guards.splice(at, 1);
              };
            },
          }}
        >
          <DurableDocumentScope
            value={{
              store: {} as WafflebaseDocStore,
              durable: true,
              reportLoss: () => {},
              reportPersistDisabled: () => {},
              reportUnreportable: () => {},
            }}
          >
            <SyncStatusChip />
          </DurableDocumentScope>
        </GuardRegistryContext.Provider>
      </TooltipProvider>,
    );
    act(() => {
      doc.type();
    });

    expect(screen.getByText('Saved to this device')).toBeTruthy();
    expect(guards).toHaveLength(1);
    const prompt = guards[0]();
    expect(prompt).not.toBeNull();
    // And it says the true thing, which is not the stranded sentence: the copy
    // exists, and leaving is what removes it.
    expect(prompt?.description ?? '').toMatch(/removes that copy/i);
    // Still no unload guard — the reload case is the one this state fixed.
    expect(unloadGuards()).toBe(0);
  });

  it('lets a fully synced durable document go without a word', () => {
    // The guard is registered on outstanding work, not on durability.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };

    const guards: Array<NavigationGuard> = [];
    render(
      <TooltipProvider>
        <GuardRegistryContext.Provider
          value={{ register: (guard) => (guards.push(guard), () => {}) }}
        >
          <DurableDocumentScope
            value={{
              store: {} as WafflebaseDocStore,
              durable: true,
              reportLoss: () => {},
              reportPersistDisabled: () => {},
              reportUnreportable: () => {},
            }}
          >
            <SyncStatusChip />
          </DurableDocumentScope>
        </GuardRegistryContext.Provider>
      </TooltipProvider>,
    );

    expect(guards).toHaveLength(0);
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

describe('the tooltip on a state that is now designed rather than inevitable', () => {
  /**
   * `docs/design/offline-local-persistence.md` § What the user sees:
   *
   * > Because `Not saved` is now a *designed* state rather than the only state
   * > — the second tab, an oversized document, a broken store — the chip
   * > carries the weight that used to be carried by it simply always being
   * > true. Its tooltip must name which case applies.
   *
   * Every cause collapses to the same chip, so the sentence is the only thing
   * that tells an oversized document apart from a second tab — three
   * situations with three different things to do about them.
   */
  const stranded = (lapse?: Parameters<typeof tooltipFor>[4]) =>
    tooltipFor('not-saved', null, false, false, lapse);

  it('says which tab is the one saving', () => {
    expect(stranded('another-tab')).toContain('open in another tab');
  });

  it('says when the document is too large for this device', () => {
    expect(stranded('too-large')).toContain('too large');
  });

  it('says when the device is out of room', () => {
    expect(stranded('out-of-space')).toContain('out of local storage space');
  });

  it('says when the store would not take the write', () => {
    expect(stranded('write-failed')).toContain('could not be written to');
  });

  it('says when earlier work could not be reconciled', () => {
    expect(stranded('dropped')).toContain('no longer being saved');
  });

  it('keeps naming the tab as the only copy in every case', () => {
    // The reason is added to that sentence, never instead of it: what the user
    // must act on is that closing the tab ends these edits.
    for (const lapse of [
      undefined,
      'another-tab',
      'too-large',
      'out-of-space',
      'write-failed',
      'dropped',
    ] as const) {
      expect(stranded(lapse)).toContain('exist only in this tab');
    }
  });

  it('diagnoses nothing where a diagnosis would be wrong', () => {
    // `not-enabled` is a call to action, and the offer says it better. A share
    // link (`not-permitted`) was never going to be saved to the visitor's
    // device, so describing the feature to them would be noise.
    expect(stranded('not-enabled')).toBe(stranded(undefined));
    expect(stranded('not-permitted')).toBe(stranded(undefined));
  });

  it('leaves the healthy states alone', () => {
    // A lapse is not a fault when nothing of the user's is outstanding.
    expect(tooltipFor('saved', null, true, false, 'another-tab')).toBe(
      'All changes are on the server.',
    );
  });
});

/**
 * ...and that the reason actually travels from where it is known to the chip.
 *
 * Everything above calls `tooltipFor` with a lapse handed to it, which passes
 * whether or not `useDurabilityLapse()` ever answers anything — and it did
 * not: `CollabDocumentProvider` mounted its own scope *inside*
 * `DurableYorkieProvider`'s, so the `undefined` a durable document computes at
 * the call site overwrote every reason the durable client publishes
 * (`dropped`, `too-large`, `out-of-space`, `write-failed`). The requirement the
 * design states — "its tooltip must name which case applies" — was therefore
 * unmet for precisely the four causes only the client can see, with a green
 * test suite. These drive the wiring instead of the function.
 */
describe('the lapse reaching the chip', () => {
  /** Renders a stranded chip under the two scopes, in the app's own order. */
  function strandedUnderScopes(
    callSite: DurabilityLapse | undefined,
    durableClient?: DurabilityLapse,
  ): string {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    render(
      <TooltipProvider>
        <DurabilityLapseScope lapse={callSite}>
          <DurabilityLapseScope lapse={durableClient}>
            <SyncStatusChip />
          </DurabilityLapseScope>
        </DurabilityLapseScope>
      </TooltipProvider>,
    );
    act(() => {
      doc.type();
    });
    // Radix renders the content only once the tooltip is open; the chip is
    // focusable precisely so this is reachable without a pointer.
    act(() => {
      fireEvent.focus(screen.getByRole('status'));
    });
    return document.body.textContent ?? '';
  }

  it('names a cause only the call site knows', () => {
    expect(strandedUnderScopes('another-tab')).toContain('open in another tab');
  });

  it('names a cause only the durable client knows', () => {
    // The nesting is the whole mechanism: the client's scope is the deeper
    // one, so its answer is the one the chip reads. Rendered the other way
    // round — which is what shipped — this sentence never appears.
    expect(strandedUnderScopes(undefined, 'dropped')).toContain(
      'no longer being saved',
    );
  });

  it('lets the durable client overrule the call site', () => {
    const text = strandedUnderScopes('another-tab', 'out-of-space');
    expect(text).toContain('out of local storage space');
    expect(text).not.toContain('open in another tab');
  });

  it('says nothing extra where no scope was mounted at all', () => {
    // Every editor that never persists renders the chip with no scope above
    // it, and it must keep its pre-offline wording rather than inventing a
    // cause.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderChip();
    act(() => {
      doc.type();
    });
    act(() => {
      fireEvent.focus(screen.getByRole('status'));
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('exist only in this tab');
    expect(text).not.toContain('this device');
  });
});
