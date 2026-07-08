import { BadRequestException } from '@nestjs/common';
import { DocumentController } from './document.controller';

const req = { user: { id: '1' } } as never;

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
