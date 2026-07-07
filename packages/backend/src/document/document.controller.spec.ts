import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentController } from './document.controller';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    end: jest.fn(),
  };
}

const req = { user: { id: '1' } } as never;

describe('DocumentController.getDocumentFile', () => {
  it('404s when the document has no fileId', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: null,
      }),
    };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    const fileService = { getObject: jest.fn() };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    await expect(
      ctrl.getDocumentFile('d1', req, makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('rejects a non-member before touching storage', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'f.pdf',
      }),
    };
    const workspaceService = {
      assertMember: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const fileService = { getObject: jest.fn() };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    await expect(
      ctrl.getDocumentFile('d1', req, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('streams the blob with a private cache header for a member', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      }),
    };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    const fileService = {
      getObject: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      }),
    };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    const res = makeRes();
    await ctrl.getDocumentFile('d1', req, res as never);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Cache-Control']).toContain('private');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.end).toHaveBeenCalled();
  });
});

describe('DocumentController.createDocument fileId gating', () => {
  function makeController(createDocument: jest.Mock) {
    const documentService = { createDocument };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    return new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      { getObject: jest.fn() } as never,
    );
  }

  it('rejects a fileId on a non-pdf document', async () => {
    const createDocument = jest.fn();
    const ctrl = makeController(createDocument);
    await expect(
      ctrl.createDocument(req, {
        title: 'Sheet',
        type: 'doc',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
        workspaceId: 'w1',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects a fileId when type defaults to sheet', async () => {
    const createDocument = jest.fn();
    const ctrl = makeController(createDocument);
    await expect(
      ctrl.createDocument(req, {
        title: 'Sheet',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
        workspaceId: 'w1',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('allows a fileId on a pdf document', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeController(createDocument);
    await ctrl.createDocument(req, {
      title: 'Doc.pdf',
      type: 'pdf',
      fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      workspaceId: 'w1',
    } as never);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pdf',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      }),
    );
  });
});
