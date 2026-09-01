import { Document as YorkieDocument } from '@yorkie-js/sdk';
import { BadRequestException } from '@nestjs/common';
import {
  DocumentCopyService,
  reviveLongs,
  stripComments,
} from './document-copy.service';
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

  describe('with a destination (template gallery "use this template")', () => {
    it('creates the copy in the destination workspace, not the source’s', async () => {
      const { service, documentService } = makeService({ siblings: [] });
      await service.copy(SOURCE as never, 42, {
        workspaceId: 'ws-2',
        folderId: 'fld-9',
        title: 'Weekly Report',
      });
      expect(documentService.documents).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-2', folderId: 'fld-9' },
      });
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: { connect: { id: 'ws-2' } },
          folder: { connect: { id: 'fld-9' } },
          author: { connect: { id: 42 } },
        }),
      );
    });

    it('names the new document after the template, without "(copy)"', async () => {
      const { service, documentService } = makeService({ siblings: [] });
      await service.copy(SOURCE as never, 42, {
        workspaceId: 'ws-2',
        title: 'Weekly Report',
      });
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Weekly Report' }),
      );
    });

    it('lands in the destination root when no folder is given', async () => {
      // Not the *source's* folder: that id belongs to another workspace and
      // would either fail the FK or file the document somewhere invisible.
      const { service, documentService } = makeService({ siblings: [] });
      await service.copy(SOURCE as never, 42, { workspaceId: 'ws-2' });
      expect(documentService.documents).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-2', folderId: null },
      });
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.not.objectContaining({ folder: expect.anything() }),
      );
    });

    it('de-duplicates the template title against the destination', async () => {
      const { service, documentService } = makeService({
        siblings: [{ title: 'Weekly Report' }],
      });
      await service.copy(SOURCE as never, 42, {
        workspaceId: 'ws-2',
        title: 'Weekly Report',
      });
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Weekly Report (2)' }),
      );
    });
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

  it('keeps the copied blob when the row it belongs to cannot be rolled back', async () => {
    const { service, documentService, fileService } = makeService();
    documentService.deleteDocument.mockRejectedValue(new Error('db down'));
    await expect(
      // An unknown type with a blob: the content copy refuses it *after* the
      // blob and the row exist, which is the only way both rollbacks run.
      service.copy(
        {
          ...SOURCE,
          type: 'gizmo',
          fileId: '11111111-2222-3333-4444-555555555555.pdf',
        } as never,
        42,
      ),
    ).rejects.toThrow(BadRequestException);
    // The row survived the rollback, so deleting its bytes would leave a
    // document that opens and 404s — worse than an orphaned blob.
    expect(fileService.delete).not.toHaveBeenCalled();
  });

  it('reads and writes a slides root under the slides- key prefix', async () => {
    const { service, withDocument } = makeService({
      sourceRoot: { slides: [{ id: 's1' }] },
    });
    await service.copy({ ...SOURCE, type: 'slides' } as never, 42);
    for (const call of withDocument.mock.calls) {
      expect(call[2]).toEqual(
        expect.objectContaining({ docKeyPrefix: 'slides-' }),
      );
    }
    expect(withDocument).toHaveBeenCalledTimes(2);
  });

  it('copies a document that sits at the workspace root', async () => {
    const { service, documentService } = makeService();
    await service.copy({ ...SOURCE, folderId: null } as never, 42);
    expect(documentService.documents).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', folderId: null },
    });
    // No `folder` connect at all, rather than one connecting to null.
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({ folder: expect.anything() }),
    );
  });

  it('refuses a document type it has no copy path for', async () => {
    const { service, documentService } = makeService();
    // A future type would otherwise copy as an empty document and report
    // success; the row it already created is rolled back.
    await expect(
      service.copy({ ...SOURCE, type: 'gizmo' } as never, 42),
    ).rejects.toThrow(BadRequestException);
    expect(documentService.deleteDocument).toHaveBeenCalledWith({
      id: 'copy-1',
    });
  });
});

describe('stripComments', () => {
  it('empties a root-level comments map', () => {
    expect(stripComments({ comments: { 'th-1': {} }, a: 1 })).toEqual({
      comments: {},
      a: 1,
    });
  });

  it('leaves a root with neither comments nor sheets alone', () => {
    expect(stripComments({ slides: [{ id: 's1' }] })).toEqual({
      slides: [{ id: 's1' }],
    });
  });
});

describe('reviveLongs', () => {
  it('re-coerces out-of-range integers inside arrays', () => {
    expect(reviveLongs([1, 1_780_000_000_000])).toEqual([
      1,
      BigInt(1_780_000_000_000),
    ]);
  });

  it('re-coerces negative out-of-range integers', () => {
    expect(reviveLongs(-1_780_000_000_000)).toEqual(BigInt(-1_780_000_000_000));
  });

  it('leaves non-integers and in-range integers as they are', () => {
    expect(reviveLongs({ a: 1.5, b: 2147483647, c: 'x' })).toEqual({
      a: 1.5,
      b: 2147483647,
      c: 'x',
    });
  });
});
