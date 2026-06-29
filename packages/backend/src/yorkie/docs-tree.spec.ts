import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  DocsYorkieRoot,
  readDocsRoot,
  readPageSetup,
  writeDocsRoot,
} from './docs-tree';
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

  it('round-trips a table cell border whose color contains commas', () => {
    // Border colors like `rgb(255, 128, 0)` produce 5 comma-separated
    // parts in the serialized attribute string ("1,solid,rgb(255, 128, 0)").
    // A naive `value.split(',')` parser drops the border entirely; the
    // parser must split into width / style / color by locating the first
    // two commas only.
    const original: DocsDocument = {
      blocks: [
        {
          id: 't1',
          type: 'table',
          inlines: [],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 0,
            marginBottom: 0,
            textIndent: 0,
            marginLeft: 0,
          },
          tableData: {
            columnWidths: [1],
            rows: [
              {
                cells: [
                  {
                    blocks: [
                      {
                        id: 'c1',
                        type: 'paragraph',
                        inlines: [{ text: 'cell', style: {} }],
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
                    style: {
                      borderTop: {
                        width: 1,
                        style: 'solid',
                        color: 'rgb(255, 128, 0)',
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    doc.update((root) => writeDocsRoot(root, original));
    const result = readDocsRoot(doc.getRoot());

    expect(result).toEqual(original);
  });

  it('clears pageSetup on the root when a follow-up write omits it', () => {
    // A destructive replace must reflect omission. If the first write
    // sets pageSetup and the second omits it, the previous value must
    // not persist on the Yorkie root — otherwise CLI replace flows leak
    // stale page-setup state.
    const withPageSetup: DocsDocument = {
      ...makeDoc(),
      pageSetup: {
        paperSize: { name: 'A4', width: 595, height: 842 },
        orientation: 'portrait',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      },
    };
    const withoutPageSetup: DocsDocument = {
      ...makeDoc(),
    };

    doc.update((root) => writeDocsRoot(root, withPageSetup));
    doc.update((root) => writeDocsRoot(root, withoutPageSetup));
    const result = readDocsRoot(doc.getRoot());

    expect(result.pageSetup).toBeUndefined();
    expect(result).toEqual(withoutPageSetup);
  });

  it('round-trips the named-style overrides registry', () => {
    const original: DocsDocument = {
      ...makeDoc(),
      styles: {
        'heading-1': { inline: { fontSize: 30, bold: true }, block: { marginTop: 40, marginBottom: 12 } },
        'title': { inline: { color: '#ff0000' } },
      },
    };

    doc.update((root) => writeDocsRoot(root, original));
    const result = readDocsRoot(doc.getRoot());

    expect(result.styles).toEqual(original.styles);
  });

  it('clears the style registry on the root when a follow-up write omits it', () => {
    const withStyles: DocsDocument = {
      ...makeDoc(),
      styles: { 'heading-1': { inline: { fontSize: 30 } } },
    };
    const withoutStyles: DocsDocument = { ...makeDoc() };

    doc.update((root) => writeDocsRoot(root, withStyles));
    doc.update((root) => writeDocsRoot(root, withoutStyles));
    const result = readDocsRoot(doc.getRoot());

    expect(result.styles).toBeUndefined();
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

  // Invariant: readPageSetup must extract each field individually rather than
  // spreading the proxy. Yorkie object proxies double-encode under
  // `{...proxy}` and `JSON.stringify`, producing wrapped values that
  // round-trip back as malformed data on the next write. This test simulates
  // a hostile proxy whose enumerable own properties are empty (so spread sees
  // nothing) but whose accessors return the real values. If anyone
  // "simplifies" readPageSetup back to a spread or object copy, this test
  // breaks before the regression hits a live attached document.
  it('readPageSetup extracts each field individually rather than spreading', () => {
    const innerProxy = (values: Record<string, unknown>) =>
      new Proxy(
        {},
        {
          ownKeys: () => [],
          getOwnPropertyDescriptor: () => undefined,
          get: (_, key) =>
            typeof key === 'string' ? values[key] : undefined,
        },
      );

    const trapped = new Proxy(
      {},
      {
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => undefined,
        get: (_, key) => {
          if (key === 'paperSize')
            return innerProxy({ name: 'A4', width: 595, height: 842 });
          if (key === 'margins')
            return innerProxy({ top: 72, bottom: 72, left: 72, right: 72 });
          if (key === 'orientation') return 'landscape';
          return undefined;
        },
      },
    );

    // Sanity: object spread sees nothing on this proxy. If readPageSetup
    // ever uses `{ ...proxy }` it will produce empty paperSize/margins.
    expect({ ...(trapped as object) }).toEqual({});

    const result = readPageSetup(trapped as never);

    expect(result).toEqual({
      paperSize: { name: 'A4', width: 595, height: 842 },
      orientation: 'landscape',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    });
  });

  // Invariant: writeDocsRoot is identity on the JSON shape for valid input —
  // the writer does NOT normalize, coerce, or drop fields. This contract is
  // load-bearing for the PUT /content controller, which echoes the request
  // body back to the caller rather than re-reading the stored state. If
  // anyone changes the writer to normalize input (fill defaults, strip
  // unknown fields, coerce types), this test breaks and forces them either
  // to preserve identity or to update the controller to re-read after write.
  it('writes and reads a fully-populated document with byte-equal shape', () => {
    const original: DocsDocument = {
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          inlines: [
            { text: 'Plain ', style: {} },
            {
              text: 'bold-italic-link',
              style: {
                bold: true,
                italic: true,
                underline: true,
                strikethrough: true,
                superscript: false,
                subscript: false,
                fontSize: 14,
                fontFamily: 'Inter',
                color: '#222222',
                backgroundColor: '#ffff00',
                href: 'https://example.com',
                pageNumber: false,
              },
            },
            {
              text: '\uFFFC',
              style: {
                image: {
                  src: 'data:image/png;base64,AAAA',
                  width: 120,
                  height: 80,
                  alt: 'demo',
                },
              },
            },
          ],
          style: {
            alignment: 'justify',
            lineHeight: 1.5,
            marginTop: 4,
            marginBottom: 8,
            textIndent: 16,
            marginLeft: 0,
          },
        },
        {
          id: 'h1',
          type: 'heading',
          headingLevel: 3,
          inlines: [{ text: 'Section', style: {} }],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 12,
            marginBottom: 8,
            textIndent: 0,
            marginLeft: 0,
          },
        },
        {
          id: 'l1',
          type: 'list-item',
          listKind: 'ordered',
          listLevel: 2,
          inlines: [{ text: 'Item one', style: {} }],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 0,
            marginBottom: 4,
            textIndent: 0,
            marginLeft: 24,
          },
        },
        {
          id: 't1',
          type: 'table',
          inlines: [],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 8,
            marginBottom: 8,
            textIndent: 0,
            marginLeft: 0,
          },
          tableData: {
            columnWidths: [0.5, 0.5],
            rowHeights: [40, undefined],
            rows: [
              {
                cells: [
                  {
                    blocks: [
                      {
                        id: 'tc1',
                        type: 'paragraph',
                        inlines: [{ text: 'A1', style: { bold: true } }],
                        style: {
                          alignment: 'center',
                          lineHeight: 1.5,
                          marginTop: 0,
                          marginBottom: 0,
                          textIndent: 0,
                          marginLeft: 0,
                        },
                      },
                    ],
                    style: {
                      backgroundColor: '#eeeeee',
                      verticalAlign: 'middle',
                      padding: 6,
                      borderTop: { width: 1, style: 'solid', color: '#000000' },
                      borderBottom: {
                        width: 1,
                        style: 'solid',
                        color: '#000000',
                      },
                      borderLeft: {
                        width: 1,
                        style: 'solid',
                        color: '#000000',
                      },
                      borderRight: {
                        width: 1,
                        style: 'solid',
                        color: '#000000',
                      },
                    },
                    colSpan: 2,
                  },
                ],
              },
              {
                cells: [
                  {
                    blocks: [
                      {
                        id: 'tc2',
                        type: 'paragraph',
                        inlines: [{ text: 'B1', style: {} }],
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
                    style: {},
                  },
                  {
                    blocks: [
                      {
                        id: 'tc3',
                        type: 'paragraph',
                        inlines: [{ text: 'B2', style: {} }],
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
                    style: {},
                  },
                ],
              },
            ],
          },
        },
      ],
      pageSetup: {
        paperSize: { name: 'A4', width: 595, height: 842 },
        orientation: 'landscape',
        margins: { top: 36, bottom: 48, left: 60, right: 72 },
      },
      header: {
        marginFromEdge: 24,
        blocks: [
          {
            id: 'hdr1',
            type: 'paragraph',
            inlines: [{ text: 'Header', style: { italic: true } }],
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
        marginFromEdge: 30,
        blocks: [
          {
            id: 'ftr1',
            type: 'paragraph',
            inlines: [
              { text: 'Page ', style: {} },
              { text: '', style: { pageNumber: true } },
            ],
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
