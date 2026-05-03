import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
import { DocsYorkieRoot, readDocsRoot, writeDocsRoot } from './docs-tree';
import type { DocsDocument } from './yorkie.types';

function makeDoc(): DocsDocument {
  return {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [
          { text: 'Hello, ', style: {} },
          { text: 'world', style: { bold: true } },
        ],
        style: {
          alignment: 'center',
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
      {
        id: 'b2',
        type: 'heading',
        headingLevel: 2,
        inlines: [{ text: 'A heading', style: {} }],
        style: {
          alignment: 'left',
          lineHeight: 1.5,
          marginTop: 12,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ],
  };
}

describe('docs-tree', () => {
  let doc: YorkieDocument<DocsYorkieRoot>;

  beforeEach(() => {
    // Yorkie supports offline document mutation: `doc.update` works without
    // a client, so the writer/reader pair can be exercised purely in-process.
    doc = new yorkie.Document<DocsYorkieRoot>(
      `test-doc-${Date.now()}-${Math.random()}`,
    );
  });

  it('round-trips a simple Document through writeDocsRoot/readDocsRoot', () => {
    const original = makeDoc();

    doc.update((root) => writeDocsRoot(root, original));
    const result = readDocsRoot(doc.getRoot());

    expect(result).toEqual(original);
  });

  it('replaces existing tree content on subsequent writes', () => {
    const first = makeDoc();
    const second: DocsDocument = {
      blocks: [
        {
          id: 'only',
          type: 'paragraph',
          inlines: [{ text: 'replaced', style: {} }],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 0,
            marginBottom: 8,
            textIndent: 0,
            marginLeft: 0,
          },
        },
      ],
    };

    doc.update((root) => writeDocsRoot(root, first));
    doc.update((root) => writeDocsRoot(root, second));
    const result = readDocsRoot(doc.getRoot());

    expect(result).toEqual(second);
  });

  it('returns an empty document when content is missing', () => {
    expect(readDocsRoot(doc.getRoot())).toEqual({ blocks: [] });
  });

  it('preserves pageSetup and header/footer regions', () => {
    const original: DocsDocument = {
      ...makeDoc(),
      pageSetup: {
        paperSize: { name: 'A4', width: 595, height: 842 },
        orientation: 'portrait',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      },
      header: {
        marginFromEdge: 36,
        blocks: [
          {
            id: 'h1',
            type: 'paragraph',
            inlines: [{ text: 'Header text', style: {} }],
            style: {
              alignment: 'left',
              lineHeight: 1.5,
              marginTop: 0,
              marginBottom: 0,
              textIndent: 0,
              marginLeft: 0,
            },
          },
        ],
      },
      footer: {
        marginFromEdge: 36,
        blocks: [
          {
            id: 'f1',
            type: 'paragraph',
            inlines: [{ text: 'Footer text', style: {} }],
            style: {
              alignment: 'right',
              lineHeight: 1.5,
              marginTop: 0,
              marginBottom: 0,
              textIndent: 0,
              marginLeft: 0,
            },
          },
        ],
      },
    };

    doc.update((root) => writeDocsRoot(root, original));
    const result = readDocsRoot(doc.getRoot());

    expect(result).toEqual(original);
  });
});
