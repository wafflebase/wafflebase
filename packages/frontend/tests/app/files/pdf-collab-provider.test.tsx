import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Mock the pdf.js legacy build (what PdfViewer imports at runtime) so importing
// `pdf-collab` never loads the real worker/engine (mirrors pdf-collab.test.tsx).
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

// `DocumentProvider` is the seam under test: it is what carries `initialRoot`
// into the Yorkie SDK. The mock records the props it is mounted with and
// renders nothing, so no attach is attempted and the collab children (which
// consume Yorkie hooks) never mount.
const mounted: Array<Record<string, unknown>> = [];

vi.mock('@yorkie-js/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yorkie-js/react')>();
  return {
    ...actual,
    DocumentProvider: (props: Record<string, unknown>) => {
      mounted.push(props);
      return null;
    },
  };
});

import { PdfCollabProvider } from '@/app/files/pdf-collab';

const presenceUser = {
  userId: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  photo: '',
};

function mountProvider(readOnly: boolean) {
  render(
    <PdfCollabProvider
      documentId="doc1"
      readOnly={readOnly}
      presenceUser={presenceUser}
    >
      <div />
    </PdfCollabProvider>,
  );
  const props = mounted.at(-1);
  if (!props) throw new Error('DocumentProvider was never mounted');
  return props;
}

describe('PdfCollabProvider initialRoot', () => {
  beforeEach(() => {
    mounted.length = 0;
  });

  // The SDK applies `initialRoot` in a `doc.update()` *after* the attach RPC
  // returns, so a seeded key is a local change the next `PushPull` carries —
  // verb `rw`, which the auth webhook refuses for a share-link viewer. A
  // read-only mount must therefore seed nothing (same rule as
  // `docsInitialRootForRole` / `notesInitialRootForRole`).
  it('seeds nothing on a read-only mount', () => {
    expect(mountProvider(true).initialRoot).toEqual({});
  });

  it('still seeds the comments container on a writable mount', () => {
    expect(mountProvider(false).initialRoot).toEqual({ comments: {} });
  });
});
