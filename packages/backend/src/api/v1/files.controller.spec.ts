import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiV1FilesController } from './files.controller';

const WS = 'ws-1';
const USER = 7;
const UUID = '11111111-2222-3333-4444-555555555555';

const req = (isApiKey = false, scopes?: string[]) =>
  ({ user: { id: USER, isApiKey, scopes } }) as never;

const multer = (originalname: string, mimetype = 'application/octet-stream') =>
  ({ buffer: Buffer.from('bytes'), originalname, mimetype }) as never;

describe('ApiV1FilesController.upload', () => {
  let controller: ApiV1FilesController;
  let fileService: {
    upload: jest.Mock;
    delete: jest.Mock;
    getObject: jest.Mock;
  };
  let documentService: {
    createDocument: jest.Mock;
    getDocumentOrThrow: jest.Mock;
  };
  let folderService: { assertSameWorkspace: jest.Mock };

  const uploadReturns = (id: string) =>
    fileService.upload.mockResolvedValue({
      id,
      size: 5,
      mimeType: 'application/octet-stream',
    });

  beforeEach(() => {
    fileService = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn(),
    };
    documentService = {
      createDocument: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => ({
          id: 'doc-1',
          ...data,
        })),
      getDocumentOrThrow: jest.fn(),
    };
    folderService = {
      assertSameWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    controller = new ApiV1FilesController(
      fileService as never,
      documentService as never,
      folderService as never,
    );
  });

  // A read-scoped key is refused before this handler runs — see
  // `api-key-write-scope.guard.spec.ts`, which covers every mutating method
  // and asserts the guard is mounted on this controller. Nothing is stored,
  // because the guard runs ahead of the multipart handler.

  it('allows a write-scoped API key', async () => {
    uploadReturns(`${UUID}.zip`);
    await expect(
      controller.upload(
        WS,
        multer('bundle.zip'),
        {},
        req(true, ['read', 'write']),
      ),
    ).resolves.toMatchObject({ type: 'file' });
  });

  it('does not scope-check a JWT caller, whose access the guard settled', async () => {
    uploadReturns(`${UUID}.zip`);
    await expect(
      controller.upload(WS, multer('bundle.zip'), {}, req()),
    ).resolves.toMatchObject({ type: 'file' });
  });

  it('rejects a request with no file part', async () => {
    await expect(
      controller.upload(WS, undefined as never, {}, req()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fileService.upload).not.toHaveBeenCalled();
  });

  it('derives the document type from the stored blob id', async () => {
    uploadReturns(`${UUID}.pdf`);
    await controller.upload(WS, multer('paper.pdf'), {}, req());
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pdf', fileId: `${UUID}.pdf` }),
    );

    uploadReturns(`${UUID}.png`);
    await controller.upload(WS, multer('shot.png'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'image' }),
    );

    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('bundle.zip'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'file' }),
    );
  });

  it('stores a parseable format as bytes rather than parsing it', async () => {
    uploadReturns(`${UUID}.xlsx`);
    await controller.upload(WS, multer('budget.xlsx'), {}, req());
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file', title: 'budget.xlsx' }),
    );
  });

  it('persists the blob metadata alongside the fileId', async () => {
    fileService.upload.mockResolvedValue({
      id: `${UUID}.zip`,
      size: 4242,
      mimeType: 'application/zip',
    });
    await controller.upload(
      WS,
      multer('bundle.zip', 'application/zip'),
      {},
      req(),
    );
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: 4242, mimeType: 'application/zip' }),
    );
  });

  it('titles the document with the whole filename, extension included', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('quarterly report.zip'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'quarterly report.zip' }),
    );

    // Extension-less and dotfile names keep their whole name.
    uploadReturns(UUID);
    await controller.upload(WS, multer('Makefile'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Makefile' }),
    );
    await controller.upload(WS, multer('.gitignore'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '.gitignore' }),
    );
  });

  // The title is the only place an extension the storage-key sanitizer
  // rejects can survive: `safeExtension` drops `c++`, so the blob is stored
  // under a bare uuid and the download filename has nothing to re-append.
  it('keeps an extension the storage-key sanitizer would reject', async () => {
    uploadReturns(UUID); // no extension in the key — `+` fails the sanitizer
    await controller.upload(WS, multer('archive.c++'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'archive.c++' }),
    );
  });

  it('strips a directory prefix but not the extension', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('some/dir/bundle.zip'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'bundle.zip' }),
    );
  });

  it('prefers an explicit title', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(
      WS,
      multer('bundle.zip'),
      { title: 'Q3 archive' },
      req(),
    );
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Q3 archive' }),
    );
  });

  it('rejects an over-long explicit title before storing anything', async () => {
    uploadReturns(`${UUID}.zip`);
    await expect(
      controller.upload(
        WS,
        multer('bundle.zip'),
        { title: 'x'.repeat(201) },
        req(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fileService.upload).not.toHaveBeenCalled();
  });

  // Truncation has to keep the extension, not just fit the cap: for one the
  // sanitizer rejects there is no other copy of it, so a long `.c++` name
  // would lose it permanently — the exact failure this whole change fixes.
  it('truncates an over-long filename-derived title but keeps the extension', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer(`${'x'.repeat(300)}.zip`), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: `${'x'.repeat(196)}.zip` }),
    );

    uploadReturns(UUID);
    await controller.upload(WS, multer(`${'y'.repeat(300)}.c++`), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: `${'y'.repeat(196)}.c++` }),
    );
  });

  it('falls back to plain truncation when the extension cannot fit', async () => {
    uploadReturns(UUID);
    // A 301-char "extension" cannot be reserved inside a 200-char cap, so the
    // name is simply cut — `a.` plus 198 z's.
    await controller.upload(WS, multer(`a.${'z'.repeat(300)}`), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: `a.${'z'.repeat(198)}` }),
    );
  });

  it('keeps the extension on viewer types too, not just `file`', async () => {
    uploadReturns(`${UUID}.png`);
    await controller.upload(WS, multer('shot.png'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'image', title: 'shot.png' }),
    );
  });

  it('creates at the workspace root when no folder is given', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('bundle.zip'), {}, req());
    expect(folderService.assertSameWorkspace).not.toHaveBeenCalled();
    const anyValue = expect.anything() as unknown;
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ folder: anyValue }),
    );
  });

  it('connects an in-workspace folder', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(
      WS,
      multer('bundle.zip'),
      { folderId: 'folder-7' },
      req(),
    );
    expect(folderService.assertSameWorkspace).toHaveBeenCalledWith(
      'folder-7',
      WS,
    );
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder: { connect: { id: 'folder-7' } } }),
    );
  });

  // The blob is the expensive part; a folder that fails the workspace check
  // must not cost an upload, the same way an over-long title does not.
  it("rejects another workspace's folder before storing anything", async () => {
    uploadReturns(`${UUID}.zip`);
    folderService.assertSameWorkspace.mockRejectedValue(
      new BadRequestException('Folder must belong to the same workspace'),
    );
    await expect(
      controller.upload(WS, multer('bundle.zip'), { folderId: 'other' }, req()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fileService.upload).not.toHaveBeenCalled();
    expect(documentService.createDocument).not.toHaveBeenCalled();
  });

  it('clamps a client-supplied mime type to the persisted length', async () => {
    uploadReturns(`${UUID}.zip`);
    const absurd = `application/${'x'.repeat(400)}`;
    await controller.upload(WS, multer('bundle.zip', absurd), {}, req());
    expect(fileService.upload).toHaveBeenCalledWith(
      expect.anything(),
      absurd.slice(0, 255),
      'bundle.zip',
    );
  });

  it('deletes the blob when the document row fails, leaving no orphan', async () => {
    uploadReturns(`${UUID}.zip`);
    documentService.createDocument.mockRejectedValue(new Error('db down'));
    await expect(
      controller.upload(WS, multer('bundle.zip'), {}, req()),
    ).rejects.toThrow('db down');
    expect(fileService.delete).toHaveBeenCalledWith(`${UUID}.zip`);
  });
});

describe('ApiV1FilesController.download', () => {
  let controller: ApiV1FilesController;
  let fileService: {
    upload: jest.Mock;
    delete: jest.Mock;
    getObject: jest.Mock;
  };
  let documentService: {
    createDocument: jest.Mock;
    getDocumentOrThrow: jest.Mock;
  };

  const res = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end: jest.fn(),
    };
  };

  beforeEach(() => {
    fileService = {
      upload: jest.fn(),
      delete: jest.fn(),
      getObject: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2]),
        contentType: 'text/html',
      }),
    };
    documentService = {
      createDocument: jest.fn(),
      getDocumentOrThrow: jest.fn().mockResolvedValue({
        id: 'doc-1',
        type: 'file',
        title: 'bundle',
        fileId: `${UUID}.zip`,
      }),
    };
    const folderService: { assertSameWorkspace: jest.Mock } = {
      assertSameWorkspace: jest.fn(),
    };
    controller = new ApiV1FilesController(
      fileService as never,
      documentService as never,
      folderService as never,
    );
  });

  it('scopes the lookup to the workspace in the route', async () => {
    await controller.download(WS, 'doc-1', res() as never);
    expect(documentService.getDocumentOrThrow).toHaveBeenCalledWith({
      id: 'doc-1',
      workspaceId: WS,
    });
  });

  it('404s a document with no blob', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: 'doc-1',
      type: 'sheet',
      title: 'Budget',
      fileId: null,
    });
    await expect(
      controller.download(WS, 'doc-1', res() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('derives the response type instead of echoing storage', async () => {
    const r = res();
    await controller.download(WS, 'doc-1', r as never);
    // Stored ContentType is text/html; a `file` document is always opaque.
    expect(r.headers['Content-Type']).toBe('application/octet-stream');
    expect(r.headers['Content-Disposition']).toContain('attachment');
    // The extension is re-appended from the blob id.
    expect(r.headers['Content-Disposition']).toContain('bundle.zip');
    expect(r.headers['X-Content-Type-Options']).toBe('nosniff');
  });
});
