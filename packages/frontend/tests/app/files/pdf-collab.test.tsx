import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Document } from '@yorkie-js/sdk';

import { PdfCommentStore } from '@/app/files/comments/pdf-comment-store';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document';

// Mock pdfjs-dist so PdfViewer never loads the real worker/engine (mirrors
// the setup in pdf-viewer.test.tsx).
vi.mock('pdfjs-dist', () => {
  const page = {
    getViewport: () => ({ width: 100, height: 140 }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
      destroy: () => Promise.resolve(),
    }),
  };
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

// `PdfCollabInner` and the shared `UserPresence` component it renders both
// consume Yorkie hooks straight from '@yorkie-js/react'; the full attach
// flow can't run in jsdom. `UserPresence` calls `useDocument`/`usePresences`
// internally (not via props), so a doc-injection prop on `PdfCollabInner`
// alone wouldn't cover it — mocking the module is the seam that reaches
// both call sites. The mock hands back a real local (unattached)
// `Document<YorkiePdfRoot>`, built the same way the `PdfCommentStore` unit
// tests build one.
let mockDoc: Document<YorkiePdfRoot> | undefined;

vi.mock('@yorkie-js/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yorkie-js/react')>();
  return {
    ...actual,
    useDocument: () => ({
      doc: mockDoc,
      root: mockDoc?.getRoot(),
      presences: [],
      connection: 'connected',
      update: (cb: (root: YorkiePdfRoot, presence: unknown) => void) =>
        mockDoc?.update((root) => cb(root, undefined)),
      loading: false,
      error: undefined,
    }),
    usePresences: () => [],
  };
});

import { PdfCollabInner } from '@/app/files/pdf-collab';

const author = { userId: 'u1', username: 'alice' };

async function makeDocWithThread(): Promise<Document<YorkiePdfRoot>> {
  const doc = new Document<YorkiePdfRoot>('pdf-test');
  doc.update((root) => {
    if (!root.comments) root.comments = initialPdfRoot().comments!;
  });
  // Seed via the real store so field encoding (BigInt timestamps, etc.)
  // matches what `PdfCollabInner` will read at render time.
  const store = new PdfCommentStore(doc);
  await store.addThread(
    { kind: 'pdf-region', pageIndex: 0, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
    'hello',
    author,
  );
  store.dispose();
  return doc;
}

const presenceUser = {
  username: 'alice',
  email: 'alice@example.com',
  photo: '',
  userId: 'u1',
};

beforeEach(async () => {
  // jsdom canvas has no real 2d context; stub it so the viewer appends canvases.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as never;
  mockDoc = await makeDocWithThread();
});

describe('PdfCollabInner', () => {
  it('renders the comments toggle; opening it shows the seeded thread and its pin', async () => {
    render(
      <PdfCollabInner
        documentId="doc1"
        title="My PDF"
        readOnly={false}
        presenceUser={presenceUser}
      />,
    );

    // getByRole throws if the toggle isn't found, so its return alone
    // asserts presence.
    const toggle = screen.getByRole('button', { name: /comments/i });
    expect(toggle.tagName).toBe('BUTTON');

    fireEvent.click(toggle);

    // The side panel lists the seeded thread.
    await screen.findByRole('button', { name: 'Jump to comment by alice' });

    // The pin overlay renders once the mocked PDF finishes "loading".
    await screen.findByRole('button', { name: 'Comment by alice' });
  });

  it('selecting a pin opens the thread detail with reply and resolve controls', async () => {
    render(
      <PdfCollabInner
        documentId="doc1"
        title="My PDF"
        readOnly={false}
        presenceUser={presenceUser}
      />,
    );

    const pin = await screen.findByRole('button', { name: 'Comment by alice' });
    fireEvent.click(pin);

    const detail = await screen.findByRole('complementary', {
      name: 'Comment thread detail',
    });
    expect(detail.tagName).toBe('ASIDE');
    expect(screen.getByLabelText('Comment body')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Resolve thread' })).toBeDefined();
  });
});
