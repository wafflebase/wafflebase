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
  };
}

function renderChip() {
  return render(
    <TooltipProvider>
      <SyncStatusChip />
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

  it('arms the unload guard only while edits are stranded', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => { doc.type(); });
    expect(unloadGuards()).toBe(1);

    // Reconnect and let the queue drain.
    mockCtx = { doc, connection: 'connected' };
    act(() => {
      doc.ack();
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
      vi.advanceTimersByTime(1000);
    });

    expect(unloadGuards()).toBe(0);
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

  it('confirms recovery after it has warned', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    const { rerender } = renderChip();
    act(() => { doc.type(); });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(warning).toHaveBeenCalledTimes(1);

    mockCtx = { doc, connection: 'connected' };
    act(() => {
      doc.ack();
      rerender(
        <TooltipProvider>
          <SyncStatusChip />
        </TooltipProvider>,
      );
      vi.advanceTimersByTime(1000);
    });

    expect(success).toHaveBeenCalledTimes(1);
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
