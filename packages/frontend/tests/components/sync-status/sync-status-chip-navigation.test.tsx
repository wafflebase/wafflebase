import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockCtx: { doc: FakeDoc | undefined; connection: string };

vi.mock('@yorkie-js/react', () => ({
  useDocument: () => mockCtx,
}));

vi.mock('sonner', () => ({
  toast: { warning: () => {}, success: () => {}, dismiss: () => {} },
}));

import { SyncStatusChip } from '@/components/sync-status/sync-status-chip';
import { SharedHeaderStatus } from '@/app/shared/shared-header-status';
import { NavigationGuardProvider } from '@/components/navigation-guard/navigation-guard-provider';
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
    return () =>
      handlers.set(key, (handlers.get(key) ?? []).filter((h) => h !== cb));
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

/**
 * An editor reached through the app shell: a sidebar link that leaves the
 * document, and the chip mounted where `SiteHeader` mounts it.
 */
function renderEditor(status: ReactNode = <SyncStatusChip />) {
  // The chip reads the signed-in identity (the offline opt-in is per account),
  // so it needs a query client; seeded rather than fetched, since nothing here
  // is testing the request.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me', 'optional'], { id: 7, username: 'ada' });
  return render(
    <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/s/doc-1']}>
      <NavigationGuardProvider>
        <TooltipProvider>
          <Link to="/w/acme">workspace</Link>
          <Routes>
            <Route path="/s/doc-1" element={<>{status}</>} />
            <Route path="/w/acme" element={<div>workspace page</div>} />
          </Routes>
        </TooltipProvider>
      </NavigationGuardProvider>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

const leave = () => fireEvent.click(screen.getByText('workspace'));
const left = () => screen.queryByText('workspace page') !== null;
const prompted = () => screen.queryByText('Leave without saving?') !== null;

beforeEach(() => {
  mockCtx = { doc: undefined, connection: 'disconnected' };
});

describe('SyncStatusChip in-app navigation guard', () => {
  it('holds back a sidebar click while edits are stranded', () => {
    // The gap this closes: `beforeunload` never fires for a route change, so
    // this click used to unmount the provider and take the queue with it.
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderEditor();
    act(() => {
      doc.type();
    });

    leave();

    expect(prompted()).toBe(true);
    expect(left()).toBe(false);
  });

  it('leaves when the user confirms', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderEditor();
    act(() => {
      doc.type();
    });
    leave();

    fireEvent.click(screen.getByText('Leave'));

    expect(left()).toBe(true);
  });

  it('keeps the document open when the user stays', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderEditor();
    act(() => {
      doc.type();
    });
    leave();

    fireEvent.click(screen.getByText('Stay'));

    expect(prompted()).toBe(false);
    expect(left()).toBe(false);
  });

  it('does not prompt when every change is on the server', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'connected' };
    renderEditor();
    act(() => {
      doc.type();
      doc.ack();
    });

    leave();

    // The chip still reads `Saving…` here — it holds that through a quiet
    // window after the last keystroke. The guard asks the document instead.
    expect(prompted()).toBe(false);
    expect(left()).toBe(true);
  });

  it('does not prompt a disconnected reader with nothing pending', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderEditor();

    leave();

    expect(prompted()).toBe(false);
    expect(left()).toBe(true);
  });

  it('never prompts a read-only viewer, who has no chip at all', () => {
    const doc = fakeDoc();
    mockCtx = { doc, connection: 'disconnected' };
    renderEditor(<SharedHeaderStatus readOnly />);
    act(() => {
      // A viewer cannot produce this, but if they somehow did there is still
      // nothing mounted to register a guard.
      doc.type();
    });

    leave();

    expect(prompted()).toBe(false);
    expect(left()).toBe(true);
  });
});
