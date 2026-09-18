import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PropsWithChildren } from 'react';

/**
 * `durable` is what the chip's "Saved to this device" stands on, and the design
 * states it as the conjunction of three facts — this tab won the app lock, no
 * loss has been reported, and the store is not failing its writes. The third is
 * the one nothing else can observe: the SDK swallows store errors, so a store
 * that accepts nothing (private browsing, an origin still full after eviction)
 * would otherwise still read as durable.
 */

const captured: Array<{ onWriteFailure?: (err: unknown) => void }> = [];

vi.mock('@/lib/wafflebase-doc-store', () => ({
  WafflebaseDocStore: class {
    constructor(options: { onWriteFailure?: (err: unknown) => void }) {
      captured.push(options);
    }
  },
}));

vi.mock('@yorkie-js/react', () => ({
  YorkieProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useDocument: () => ({ doc: undefined }),
  useYorkie: () => ({ error: undefined }),
}));

import { DurableYorkieProvider } from './durable-yorkie-provider';
import { useDocumentDurability } from '@/lib/durable-document-context';

function Probe() {
  return <span>{useDocumentDurability() ? 'durable' : 'not-durable'}</span>;
}

function renderProvider() {
  return render(
    <DurableYorkieProvider
      clientKey="wb:1:sheet-7"
      userId="1"
      rpcAddr="http://localhost:8080"
      apiKey="key"
    >
      <Probe />
    </DurableYorkieProvider>,
  );
}

beforeEach(() => {
  captured.length = 0;
});

describe('durability', () => {
  it('is reported while the store is taking writes', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());
  });

  it('stops being reported once a write fails', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText('durable')).toBeInTheDocument());

    act(() => captured[0].onWriteFailure?.(new Error('refused')));

    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );
  });

  it('stays lowered after a later write succeeds', async () => {
    // A write that failed is work not on disk, and a later write landing does
    // not put it there.
    renderProvider();
    act(() => captured[0].onWriteFailure?.(new Error('refused')));
    await waitFor(() =>
      expect(screen.getByText('not-durable')).toBeInTheDocument(),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByText('not-durable')).toBeInTheDocument();
  });
});
