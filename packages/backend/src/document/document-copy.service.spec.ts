import { Document as YorkieDocument } from '@yorkie-js/sdk';
import { DocumentCopyService, snapshotJsonRoot } from './document-copy.service';
import {
  DocsYorkieRoot,
  readDocsRoot,
  writeDocsRoot,
} from '../yorkie/docs-tree';
import {
  NoteYorkieRoot,
  readNoteRoot,
  writeNoteRoot,
} from '../yorkie/note-content';
import type { DocsDocument } from '../yorkie/yorkie.types';

type Root = Record<string, unknown>;

const SOURCE = {
  id: 'src-1',
  title: 'Report',
  type: 'sheet',
  workspaceId: 'ws-1',
  folderId: 'fld-1',
  fileId: null,
  fileSize: null,
  mimeType: null,
  authorID: 7,
};

/**
 * A `YorkieService` stand-in: the readonly attach reads `sourceRoot`, the
 * read-write attach records every write into `targetRoot`.
 */
function makeYorkie(sourceRoot: Root) {
  const targetRoot: Root = {};
  const withDocument = jest.fn(
    async (
      _id: string,
      cb: (doc: unknown) => unknown,
      opts?: { syncMode?: string; docKeyPrefix?: string },
    ) => {
      if (opts?.syncMode === 'readonly') {
        return cb({
          toJSON: () => JSON.stringify(sourceRoot),
          getRoot: () => sourceRoot,
        });
      }
      return cb({ update: (fn: (root: Root) => void) => fn(targetRoot) });
    },
  );
  return { yorkie: { withDocument }, targetRoot, withDocument };
}

function makeService(
  opts: {
    sourceRoot?: Root;
    siblings?: Array<{ title: string }>;
    createDocument?: jest.Mock;
    copy?: jest.Mock;
    withDocument?: jest.Mock;
  } = {},
) {
  const made = makeYorkie(opts.sourceRoot ?? {});
  const withDocument = opts.withDocument ?? made.withDocument;
  const yorkie = opts.withDocument ? { withDocument } : made.yorkie;
  const targetRoot = made.targetRoot;
  const documentService = {
    documents: jest.fn(async () => opts.siblings ?? [{ title: 'Report' }]),
    createDocument:
      opts.createDocument ?? jest.fn(async () => ({ id: 'copy-1' })),
    deleteDocument: jest.fn(async () => ({ id: 'copy-1' })),
  };
  const fileService = {
    copy: opts.copy ?? jest.fn(async () => '99999999-8888-7777-6666-555555555555.pdf'),
    delete: jest.fn(async () => undefined),
  };
  const service = new DocumentCopyService(
    documentService as never,
    fileService as never,
    yorkie as never,
  );
  return { service, documentService, fileService, targetRoot, withDocument };
}

describe('DocumentCopyService', () => {
  it('creates the copy in the source workspace and folder, owned by the copier', async () => {
    const { service, documentService } = makeService();
    await service.copy(SOURCE as never, 42);
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Report (copy)',
        type: 'sheet',
        author: { connect: { id: 42 } },
        workspace: { connect: { id: 'ws-1' } },
        folder: { connect: { id: 'fld-1' } },
      }),
    );
  });

  it('de-duplicates the title against the destination folder only', async () => {
    const { service, documentService } = makeService({
      siblings: [{ title: 'Report' }, { title: 'Report (copy)' }],
    });
    await service.copy(SOURCE as never, 42);
    expect(documentService.documents).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', folderId: 'fld-1' },
    });
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Report (copy 2)' }),
    );
  });

  it('copies a whole sheet root, tabs included', async () => {
    const sourceRoot = {
      tabs: { t1: { id: 't1', name: 'Sheet1' }, t2: { id: 't2', name: 'Q3' } },
      tabOrder: ['t1', 't2'],
      sheets: { t1: { cells: { A1: { v: '1' } } }, t2: { cells: {} } },
    };
    const { service, targetRoot } = makeService({ sourceRoot });
    await service.copy(SOURCE as never, 42);
    expect(targetRoot).toEqual(sourceRoot);
  });

  it('skips the write when the source was never opened', async () => {
    const { service, withDocument } = makeService({ sourceRoot: {} });
    await service.copy(SOURCE as never, 42);
    // Read only — no second attach to seed an empty root the editor would
    // create anyway.
    expect(withDocument).toHaveBeenCalledTimes(1);
  });

  it('carries a doc’s blocks through the Tree serializer', async () => {
    // Real Yorkie documents on both ends: a fake root cannot exercise this arm,
    // because `readDocsRoot` needs a live `Tree` and `writeDocsRoot` seeds one
    // unconditionally — asserting `content` is defined would pass on no content
    // at all.
    const original: DocsDocument = {
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ text: 'copied text', style: { bold: true } }],
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
    const sourceDoc = new YorkieDocument<DocsYorkieRoot>('doc-src');
    sourceDoc.update((root) => writeDocsRoot(root, original));
    const targetDoc = new YorkieDocument<DocsYorkieRoot>('doc-target');

    const withDocument = jest.fn(
      async (
        _id: string,
        cb: (doc: unknown) => unknown,
        opts?: { syncMode?: string; docKeyPrefix?: string },
      ) => cb(opts?.syncMode === 'readonly' ? sourceDoc : targetDoc),
    );
    const { service } = makeService({ withDocument });
    await service.copy({ ...SOURCE, type: 'doc' } as never, 42);

    expect(readDocsRoot(targetDoc.getRoot())).toEqual(original);
    // Both attaches use the docs key prefix, not the sheet one.
    for (const call of withDocument.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ docKeyPrefix: 'doc-' }));
    }
  });

  it('carries a note’s markdown through the Text serializer', async () => {
    const markdown = '# Title\n\nbody text\n';
    const sourceDoc = new YorkieDocument<NoteYorkieRoot>('note-src');
    sourceDoc.update((root) => writeNoteRoot(root, { content: markdown }));
    const targetDoc = new YorkieDocument<NoteYorkieRoot>('note-target');

    const withDocument = jest.fn(
      async (
        _id: string,
        cb: (doc: unknown) => unknown,
        opts?: { syncMode?: string; docKeyPrefix?: string },
      ) => cb(opts?.syncMode === 'readonly' ? sourceDoc : targetDoc),
    );
    const { service } = makeService({ withDocument });
    await service.copy({ ...SOURCE, type: 'note' } as never, 42);

    expect(readNoteRoot(targetDoc.getRoot())).toEqual({ content: markdown });
  });

  it('does not carry the source’s comment threads into the copy', async () => {
    const thread = {
      id: 'th-1',
      anchor: { kind: 'cell', tabId: 't1', rowId: 1, colId: 1 },
      comments: [],
      resolved: false,
      createdAt: 1_780_000_000_000,
    };
    const sourceRoot = {
      tabs: { t1: { id: 't1', name: 'Sheet1' } },
      sheets: { t1: { cells: { A1: { v: '1' } }, comments: { 'th-1': thread } } },
    };
    const { service, targetRoot } = makeService({ sourceRoot });
    await service.copy(SOURCE as never, 42);
    const sheets = targetRoot.sheets as Record<string, Record<string, unknown>>;
    // The container itself survives (worksheets seed `comments: {}` so
    // concurrent first comments merge) — only the threads are dropped.
    expect(sheets.t1.comments).toEqual({});
    expect(sheets.t1.cells).toEqual({ A1: { v: '1' } });
    // The source is untouched.
    expect(sourceRoot.sheets.t1.comments).toEqual({ 'th-1': thread });
  });

  it('writes out-of-32-bit-range integers as Yorkie Longs', async () => {
    const sourceRoot = {
      tabs: {},
      sheets: { t1: { cells: {}, importedAt: 1_780_000_000_000, frozenRows: 2 } },
    };
    const { service, targetRoot } = makeService({ sourceRoot });
    await service.copy(SOURCE as never, 42);
    const sheets = targetRoot.sheets as Record<string, Record<string, unknown>>;
    // A plain number here would be stored as a 32-bit Integer and truncated.
    expect(typeof sheets.t1.importedAt).toBe('bigint');
    expect(Number(sheets.t1.importedAt)).toBe(1_780_000_000_000);
    // In-range integers stay plain numbers.
    expect(sheets.t1.frozenRows).toBe(2);
  });

  it('rejects a source whose stored file reference is not a blob id', async () => {
    const { service, fileService, documentService } = makeService();
    await expect(
      service.copy(
        { ...SOURCE, type: 'pdf', fileId: '../../etc/passwd' } as never,
        42,
      ),
    ).rejects.toThrow();
    expect(fileService.copy).not.toHaveBeenCalled();
    expect(documentService.createDocument).not.toHaveBeenCalled();
  });

  it('copies the blob and carries its metadata for a file-backed document', async () => {
    const { service, documentService, fileService, withDocument } =
      makeService();
    await service.copy(
      {
        ...SOURCE,
        type: 'pdf',
        fileId: '11111111-2222-3333-4444-555555555555.pdf',
        fileSize: 1234,
        mimeType: 'application/pdf',
      } as never,
      42,
    );
    expect(fileService.copy).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555.pdf');
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: '99999999-8888-7777-6666-555555555555.pdf',
        fileSize: 1234,
        mimeType: 'application/pdf',
      }),
    );
    // A blob document has no CRDT content to attach to.
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('deletes the copied blob when the row cannot be created', async () => {
    const createDocument = jest.fn(async () => {
      throw new Error('db down');
    });
    const { service, fileService } = makeService({ createDocument });
    await expect(
      service.copy(
        { ...SOURCE, type: 'pdf', fileId: '11111111-2222-3333-4444-555555555555.pdf' } as never,
        42,
      ),
    ).rejects.toThrow('db down');
    expect(fileService.delete).toHaveBeenCalledWith('99999999-8888-7777-6666-555555555555.pdf');
  });

  it('rolls back the row when the content copy fails', async () => {
    const { service, documentService, withDocument } = makeService({
      sourceRoot: { tabs: {} },
    });
    withDocument.mockRejectedValue(new Error('yorkie down'));
    await expect(service.copy(SOURCE as never, 42)).rejects.toThrow(
      'yorkie down',
    );
    // No empty document is left behind claiming to be a copy.
    expect(documentService.deleteDocument).toHaveBeenCalledWith({
      id: 'copy-1',
    });
  });
});

describe('snapshotJsonRoot', () => {
  it('parses the root JSON string Yorkie hands back', () => {
    expect(snapshotJsonRoot({ toJSON: () => '{"a":1}' })).toEqual({ a: 1 });
  });

  it('unwraps a double-encoded root', () => {
    expect(snapshotJsonRoot({ toJSON: () => '"{\\"a\\":1}"' })).toEqual({
      a: 1,
    });
  });

  it('rejects a root that is not an object', () => {
    expect(() => snapshotJsonRoot({ toJSON: () => '[1,2]' })).toThrow();
  });

  it('falls back to the root proxy when toJSON is unparseable', () => {
    // Yorkie's raw JSON string path does not escape some control characters,
    // so `JSON.parse(doc.toJSON())` throws; the copy must still succeed.
    const root = { a: 'x\u0001y' };
    expect(
      snapshotJsonRoot({
        toJSON: () => '{"a":"x\u0001y"}',
        getRoot: () => root,
      }),
    ).toEqual(root);
  });

  it('rethrows when neither the JSON string nor the root parses', () => {
    expect(() =>
      snapshotJsonRoot({
        toJSON: () => 'not json',
        getRoot: () => {
          throw new Error('root unavailable');
        },
      }),
    ).toThrow('root unavailable');
  });
});
