import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentFileController } from './document-file.controller';

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

const memberReq = { user: { id: '1' } } as never;
const anonReq = { user: undefined } as never;

function makeController(overrides: {
  documentService?: object;
  workspaceService?: object;
  shareLinkService?: object;
  fileService?: object;
}) {
  const documentService = overrides.documentService ?? {
    document: jest.fn().mockResolvedValue(null),
  };
  const workspaceService = overrides.workspaceService ?? {
    assertMember: jest.fn().mockResolvedValue({}),
  };
  const shareLinkService = overrides.shareLinkService ?? {
    findByToken: jest.fn(),
  };
  const fileService = overrides.fileService ?? { getObject: jest.fn() };
  return new DocumentFileController(
    documentService as never,
    workspaceService as never,
    shareLinkService as never,
    fileService as never,
  );
}

describe('DocumentFileController.getDocumentFile', () => {
  it('404s when the document does not exist', async () => {
    const ctrl = makeController({
      documentService: { document: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      ctrl.getDocumentFile('d1', undefined, memberReq, makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the document has no fileId', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: null,
      }),
    };
    const fileService = { getObject: jest.fn() };
    const ctrl = makeController({ documentService, fileService });
    await expect(
      ctrl.getDocumentFile('d1', undefined, memberReq, makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('rejects a non-member with no token before touching storage', async () => {
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
    const ctrl = makeController({
      documentService,
      workspaceService,
      fileService,
    });
    await expect(
      ctrl.getDocumentFile('d1', undefined, memberReq, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('rejects an anonymous request with no token', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'f.pdf',
      }),
    };
    const fileService = { getObject: jest.fn() };
    const ctrl = makeController({ documentService, fileService });
    await expect(
      ctrl.getDocumentFile('d1', undefined, anonReq, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('propagates GoneException for an expired share token', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'f.pdf',
      }),
    };
    const shareLinkService = {
      findByToken: jest.fn().mockRejectedValue(new GoneException()),
    };
    const ctrl = makeController({ documentService, shareLinkService });
    await expect(
      ctrl.getDocumentFile('d1', 'expired-token', anonReq, makeRes() as never),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects a valid token scoped to a different document', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'f.pdf',
      }),
    };
    const shareLinkService = {
      findByToken: jest.fn().mockResolvedValue({ documentId: 'other-doc' }),
    };
    const ctrl = makeController({ documentService, shareLinkService });
    await expect(
      ctrl.getDocumentFile('d1', 'valid-token', anonReq, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
    const fileService = {
      getObject: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      }),
    };
    const ctrl = makeController({ documentService, fileService });
    const res = makeRes();
    await ctrl.getDocumentFile('d1', undefined, memberReq, res as never);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Cache-Control']).toContain('private');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.end).toHaveBeenCalled();
  });

  it('streams the blob for an anonymous request with a valid matching token', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      }),
    };
    const shareLinkService = {
      findByToken: jest.fn().mockResolvedValue({ documentId: 'd1' }),
    };
    const fileService = {
      getObject: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      }),
    };
    const ctrl = makeController({
      documentService,
      shareLinkService,
      fileService,
    });
    const res = makeRes();
    await ctrl.getDocumentFile('d1', 'valid-token', anonReq, res as never);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.end).toHaveBeenCalled();
  });
});
