import { DocumentCopyService, snapshotJsonRoot } from './document-copy.service';

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
  } = {},
) {
  const { yorkie, targetRoot, withDocument } = makeYorkie(
    opts.sourceRoot ?? {},
  );
  const documentService = {
    documents: jest.fn(async () => opts.siblings ?? [{ title: 'Report' }]),
    createDocument:
      opts.createDocument ?? jest.fn(async () => ({ id: 'copy-1' })),
    deleteDocument: jest.fn(async () => ({ id: 'copy-1' })),
  };
  const fileService = {
    copy: opts.copy ?? jest.fn(async () => 'new-blob.pdf'),
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

  it('routes a doc through the Tree serializer rather than a JSON snapshot', async () => {
    const { service, targetRoot } = makeService({ sourceRoot: {} });
    await service.copy({ ...SOURCE, type: 'doc' } as never, 42);
    // `writeDocsRoot` seeds a Tree even for an empty document, which is what
    // distinguishes this arm from the plain-JSON one above.
    expect(targetRoot.content).toBeDefined();
  });

  it('copies the blob and carries its metadata for a file-backed document', async () => {
    const { service, documentService, fileService, withDocument } =
      makeService();
    await service.copy(
      {
        ...SOURCE,
        type: 'pdf',
        fileId: 'old-blob.pdf',
        fileSize: 1234,
        mimeType: 'application/pdf',
      } as never,
      42,
    );
    expect(fileService.copy).toHaveBeenCalledWith('old-blob.pdf');
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'new-blob.pdf',
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
        { ...SOURCE, type: 'pdf', fileId: 'old-blob.pdf' } as never,
        42,
      ),
    ).rejects.toThrow('db down');
    expect(fileService.delete).toHaveBeenCalledWith('new-blob.pdf');
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
});
