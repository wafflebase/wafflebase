import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiV1FilesController } from './files.controller';

const WS = 'ws-1';
const USER = 7;
const UUID = '11111111-2222-3333-4444-555555555555';

const req = () => ({ user: { id: USER } }) as never;

const multer = (originalname: string, mimetype = 'application/octet-stream') =>
  ({ buffer: Buffer.from('bytes'), originalname, mimetype }) as never;

describe('ApiV1FilesController.upload', () => {
  let controller: ApiV1FilesController;
  let fileService: { upload: jest.Mock; delete: jest.Mock; getObject: jest.Mock };
  let documentService: {
    createDocument: jest.Mock;
    getDocumentOrThrow: jest.Mock;
  };

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
      createDocument: jest.fn().mockImplementation((data) => ({
        id: 'doc-1',
        ...data,
      })),
      getDocumentOrThrow: jest.fn(),
    };
    controller = new ApiV1FilesController(
      fileService as never,
      documentService as never,
    );
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
      expect.objectContaining({ type: 'file', title: 'budget' }),
    );
  });

  it('persists the blob metadata alongside the fileId', async () => {
    fileService.upload.mockResolvedValue({
      id: `${UUID}.zip`,
      size: 4242,
      mimeType: 'application/zip',
    });
    await controller.upload(WS, multer('bundle.zip', 'application/zip'), {}, req());
    expect(documentService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: 4242, mimeType: 'application/zip' }),
    );
  });

  it('titles the document from the filename, minus the extension', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('quarterly report.zip'), {}, req());
    expect(documentService.createDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'quarterly report' }),
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

  it('prefers an explicit title', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer('bundle.zip'), { title: 'Q3 archive' }, req());
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

  it('truncates an over-long filename-derived title instead of failing', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(WS, multer(`${'x'.repeat(300)}.zip`), {}, req());
    const { title } = documentService.createDocument.mock.calls[0][0];
    expect(title).toHaveLength(200);
  });

  it('clamps a client-supplied mime type to the persisted length', async () => {
    uploadReturns(`${UUID}.zip`);
    await controller.upload(
      WS,
      multer('bundle.zip', `application/${'x'.repeat(400)}`),
      {},
      req(),
    );
    expect(fileService.upload.mock.calls[0][1]).toHaveLength(255);
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
  let fileService: { upload: jest.Mock; delete: jest.Mock; getObject: jest.Mock };
  let documentService: { createDocument: jest.Mock; getDocumentOrThrow: jest.Mock };

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
      getObject: jest
        .fn()
        .mockResolvedValue({ body: new Uint8Array([1, 2]), contentType: 'text/html' }),
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
    controller = new ApiV1FilesController(
      fileService as never,
      documentService as never,
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
