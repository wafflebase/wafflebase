import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * `NonDurableScope` is the only thing keeping share-link content off a
 * visitor's disk, and it is *positional*: a share view of `sheet-7` carries the
 * same document key as its owner's, so no key-derived rule can tell them apart
 * and nothing about the exclusion is structural. The durable suite proves the
 * scope works when it is applied; this proves the share route applies it.
 *
 * Deleting the wrapper from `shared-document.tsx` breaks nothing else: a
 * signed-in visitor would simply start getting the durable branch — their own
 * client, authenticated with their personal Yorkie token rather than the share
 * token whose role and expiry the auth webhook validates, writing the shared
 * document to a disk that outlives the link's revocation.
 */

/**
 * Stands in for every document type's provider, reporting what the route wrapped
 * it in. Children are dropped on purpose: the real layouts mount editors, and
 * the question here is about the context above them.
 */
vi.mock('@/components/collab-document-provider', async () => {
  const { useDurabilityPermitted } = await import('@/lib/use-durable-document');
  return {
    CollabDocumentProvider: () => (
      <span data-testid="permitted">{String(useDurabilityPermitted())}</span>
    ),
  };
});

vi.mock('@yorkie-js/react', () => ({
  YorkieProvider: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  useDocument: () => ({ doc: undefined }),
}));

/** Which document type the link resolves to, per test. */
let sharedType = 'sheet';

vi.mock('@/api/share-links', () => ({
  resolveShareLink: async () => ({
    documentId: '7',
    type: sharedType,
    role: 'editor',
    title: 'Budget',
  }),
  isShareLinkResolveFatal: () => false,
  shouldRetryShareLinkResolve: () => false,
}));

vi.mock('@/api/auth', () => ({
  fetchMeOptional: async () => null,
  fetchYorkieShareToken: async () => 'share-token',
}));

vi.mock('@/hooks/use-view-analytics', () => ({
  useViewAnalytics: () => {},
}));

import { SharedDocumentByToken } from '../shared-document';
import { CollabDocumentProvider } from '@/components/collab-document-provider';

function renderShared() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SharedDocumentByToken token="tok" />
    </QueryClientProvider>,
  );
}

describe('a document reached through a share link', () => {
  afterEach(() => {
    sharedType = 'sheet';
  });

  it('is never persisted to the visitor’s device', async () => {
    renderShared();

    await waitFor(() =>
      expect(screen.getByTestId('permitted')).toHaveTextContent('false'),
    );
  });

  it('covers the pdf branch, which returns before the rest of the route', async () => {
    // `SharedDocumentInner` early-returns for `pdf` into a layout that mounts
    // its *own* `YorkieProvider` and, through `PdfCollabProvider`, its own
    // `CollabDocumentProvider`. With the scope mounted inside that function —
    // which is where it shipped — this return stepped straight around it and
    // the one type the design excludes twice over was the one type permitted.
    sharedType = 'pdf';

    renderShared();

    await waitFor(() =>
      expect(screen.getByTestId('permitted')).toHaveTextContent('false'),
    );
  });

  it('is the route saying so, not the default', async () => {
    // Durability is permitted by default — every owned editor depends on that —
    // so a probe that read `false` everywhere would prove nothing about the
    // share route.
    render(<CollabDocumentProvider docKey="sheet-7" />);

    expect(screen.getByTestId('permitted')).toHaveTextContent('true');
  });
});
