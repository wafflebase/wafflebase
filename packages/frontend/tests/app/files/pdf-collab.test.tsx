import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Document } from '@yorkie-js/sdk';

import { PdfCommentStore } from '@/app/files/comments/pdf-comment-store';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document';

// Mock the pdf.js legacy build (what PdfViewer imports at runtime) so it never
// loads the real worker/engine (mirrors the setup in pdf-viewer.test.tsx).
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
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
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
  default: 'worker.js',
}));

// `PdfCollabStateProvider` (and the shared `UserPresence` component) consume
// Yorkie hooks straight from '@yorkie-js/react'; the full attach flow can't
// run in jsdom. Mocking the module is the seam that reaches every call site.
// The mock hands back a real local (unattached) `Document<YorkiePdfRoot>`,
// built the same way the `PdfCommentStore` unit tests build one — so
// `PdfCollabStateProvider` can be mounted directly, without the real
// `DocumentProvider`.
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

import {
  PdfCollabStateProvider,
  PdfHeaderActions,
  PdfCollabBody,
} from '@/app/files/pdf-collab';
import { TooltipProvider } from '@/components/ui/tooltip';

// The route composes PdfHeaderActions (top bar) + PdfCollabBody (viewer) under
// PdfCollabProvider; here we mount PdfCollabStateProvider directly (it consumes
// the mocked useDocument, skipping the real DocumentProvider attach) with the
// same two children, wrapped in a TooltipProvider the way App.tsx provides one.
function renderCollab() {
  return render(
    <TooltipProvider>
      <PdfCollabStateProvider
        documentId="doc1"
        readOnly={false}
        presenceUser={presenceUser}
      >
        <PdfHeaderActions />
        <PdfCollabBody />
      </PdfCollabStateProvider>
    </TooltipProvider>,
  );
}

const author = { userId: 'u1', username: 'alice' };

async function makeDocWithThread(): Promise<Document<YorkiePdfRoot>> {
  const doc = new Document<YorkiePdfRoot>('pdf-test');
  doc.update((root) => {
    if (!root.comments) root.comments = initialPdfRoot().comments!;
  });
  // Seed via the real store so field encoding (BigInt timestamps, etc.)
  // matches what the collab body will read at render time.
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

describe('PdfCollab', () => {

  it('offers to comment on selected text, and anchors the thread to it', async () => {
    renderCollab();
    // Wait for the mocked document to resolve into rendered pages.
    const page = await screen.findByTestId('pdf-text-layer');
    const pageEl = page.closest('[data-pdf-page]') as HTMLElement;
    pageEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;

    // Stand in for a real drag across the text layer: jsdom has no layout, so
    // the browser's own Selection would measure every rect to zero.
    const textNode = document.createTextNode('the selected sentence');
    page.append(textNode);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        getClientRects: () => [
          { left: 100, top: 80, width: 500, height: 16 },
        ],
      }),
      toString: () => 'the selected sentence',
      removeAllRanges: () => {},
    } as unknown as Selection);

    fireEvent.pointerUp(document);

    // The affordance appears beside the selection, not in a toolbar.
    const action = await screen.findByRole('button', {
      name: /comment on selection/i,
    });
    fireEvent.click(action);

    // The composer echoes the selected text, since clicking cleared the
    // browser selection and nothing else on screen says what this is about.
    const quote = await screen.findByTestId('pdf-pending-quote');
    expect(quote.textContent).toBe('the selected sentence');

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'a note about that sentence' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    await vi.waitFor(() => {
      const threads = Object.values(mockDoc!.getRoot().comments ?? {});
      const text = threads.find((t) => t.anchor.kind === 'pdf-text');
      expect(text).toBeDefined();
      expect(text!.anchor.pageIndex).toBe(0);
      expect(text!.comments[0]!.body).toBe('a note about that sentence');
    });

    // The reader was reading. Posting a comment must not throw a panel over
    // the page they just annotated.
    expect(
      screen.queryByRole('button', { name: 'Jump to comment by alice' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: /show comments/i })).toBeTruthy();
  });


  it('survives the browser collapsing the selection when the button is pressed', async () => {
    renderCollab();
    const page = await screen.findByTestId('pdf-text-layer');
    const pageEl = page.closest('[data-pdf-page]') as HTMLElement;
    pageEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;

    const textNode = document.createTextNode('a phrase');
    page.append(textNode);
    let collapsed = false;
    vi.spyOn(window, 'getSelection').mockImplementation(
      () =>
        ({
          isCollapsed: collapsed,
          rangeCount: collapsed ? 0 : 1,
          getRangeAt: () => ({
            startContainer: textNode,
            endContainer: textNode,
            getClientRects: () => [{ left: 0, top: 0, width: 200, height: 16 }],
          }),
          toString: () => (collapsed ? '' : 'a phrase'),
          removeAllRanges: () => {},
        }) as unknown as Selection,
    );

    fireEvent.pointerUp(document);
    const action = await screen.findByRole('button', {
      name: /comment on selection/i,
    });

    // Pressing an unselectable element makes a real browser drop the
    // selection. If pointer-up then re-read it, the button would vanish
    // before its own click could fire.
    fireEvent.pointerDown(action);
    collapsed = true;
    fireEvent.pointerUp(action);

    expect(
      screen.getByRole('button', { name: /comment on selection/i }),
    ).toBeTruthy();

    fireEvent.click(action);
    await screen.findByTestId('pdf-pending-quote');
  });


  it('scrolls to a thread when its panel row is clicked', async () => {
    renderCollab();
    const layer = await screen.findByTestId('pdf-text-layer');
    const pageEl = layer.closest('[data-pdf-page]') as HTMLElement;
    const viewport = screen.getByTestId('pdf-pages');

    // jsdom lays nothing out, so give the two boxes the geometry the scroll
    // math reads: an 800px-tall page starting 200px below a 600px viewport.
    pageEl.getBoundingClientRect = () =>
      ({ top: 200, height: 800 }) as DOMRect;
    viewport.getBoundingClientRect = () =>
      ({ top: 0, height: 600 }) as DOMRect;
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo as never;

    fireEvent.click(screen.getByRole('button', { name: /show comments/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Jump to comment by alice' }),
    );

    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The seeded thread is anchored at y = 0.1 of the page: 200 + 0.1 * 800,
    // parked a third of the viewport down so its context stays visible.
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({
      top: 200 + 80 - 200,
      behavior: 'smooth',
    });
  });

  it('does not scroll for a thread whose page is not mounted', async () => {
    // Only the off-page thread exists, so the single panel row is
    // unambiguously the one under test — no reliance on row ordering.
    const doc = new Document<YorkiePdfRoot>('pdf-offpage');
    doc.update((root) => {
      if (!root.comments) root.comments = initialPdfRoot().comments!;
    });
    const store = new PdfCommentStore(doc);
    await store.addThread(
      { kind: 'pdf-region', pageIndex: 99, rect: { x: 0, y: 0.5, w: 0.2, h: 0.1 } },
      'off the end',
      author,
    );
    store.dispose();
    mockDoc = doc;

    renderCollab();
    await screen.findByTestId('pdf-text-layer');
    const viewport = screen.getByTestId('pdf-pages');
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo as never;

    fireEvent.click(screen.getByRole('button', { name: /show comments/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Jump to comment by alice' }),
    );

    // Doing nothing is the right outcome for an anchor past the end of the
    // file — not throwing, and not scrolling somewhere arbitrary.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stands down while the region tool is armed, so the two never compete', async () => {
    renderCollab();
    await screen.findByTestId('pdf-text-layer');

    fireEvent.click(screen.getByRole('button', { name: /comment on a region/i }));

    const textNode = document.createTextNode('some text');
    screen.getByTestId('pdf-text-layer').append(textNode);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: textNode,
        endContainer: textNode,
        getClientRects: () => [{ left: 0, top: 0, width: 100, height: 16 }],
      }),
      toString: () => 'some text',
      removeAllRanges: () => {},
    } as unknown as Selection);

    fireEvent.pointerUp(document);

    expect(
      screen.queryByRole('button', { name: /comment on selection/i }),
    ).toBeNull();
  });

  it('renders the comments toggle; opening it shows the seeded thread and its pin', async () => {
    renderCollab();

    // getByRole throws if the toggle isn't found, so its return alone
    // asserts presence.
    const toggle = screen.getByRole('button', { name: /show comments/i });
    expect(toggle.tagName).toBe('BUTTON');

    fireEvent.click(toggle);

    // The side panel lists the seeded thread.
    await screen.findByRole('button', { name: 'Jump to comment by alice' });

    // The pin overlay renders once the mocked PDF finishes "loading".
    await screen.findByRole('button', { name: 'Comment by alice' });
  });

  it('selecting a pin opens the thread detail with reply and resolve controls', async () => {
    renderCollab();

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
