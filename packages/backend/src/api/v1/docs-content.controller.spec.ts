import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiV1DocsContentController } from './docs-content.controller';
import { DocumentService } from '../../document/document.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';

/**
 * Minimal Document fixture matching the @wafflebase/docs `Document` shape
 * the controller round-trips. Only the fields the controller touches need
 * to be present.
 */
import type { DocsDocument } from '../../yorkie/yorkie.types';

function makeDocFixture(): DocsDocument {
  return {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [{ text: 'hello', style: {} }],
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
}

describe('ApiV1DocsContentController', () => {
  let controller: ApiV1DocsContentController;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let yorkieService: { withDocument: jest.Mock };

  beforeEach(async () => {
    documentService = { getDocumentOrThrow: jest.fn() };
    yorkieService = { withDocument: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiV1DocsContentController],
      providers: [
        { provide: DocumentService, useValue: documentService },
        { provide: YorkieService, useValue: yorkieService },
      ],
    })
      // Guard wiring is exercised by their dedicated specs; here we only
      // assert the controller's domain behaviour.
      .overrideGuard(CombinedAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ApiV1DocsContentController);
  });

  describe('GET', () => {
    it('returns the Document JSON for a doc-typed document', async () => {
      const doc = makeDocFixture();
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'doc',
      });
      yorkieService.withDocument.mockResolvedValue(doc);

      const result = await controller.getContent('ws-1', 'd1');

      expect(result).toEqual(doc);
      expect(documentService.getDocumentOrThrow).toHaveBeenCalledWith({
        id: 'd1',
        workspaceId: 'ws-1',
      });
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        expect.objectContaining({
          docKeyPrefix: 'doc-',
          syncMode: 'readonly',
        }),
      );
    });

    it('propagates NotFoundException when the document does not exist', async () => {
      documentService.getDocumentOrThrow.mockRejectedValue(
        new NotFoundException('Document not found'),
      );

      await expect(
        controller.getContent('ws-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    it('returns 409 TYPE_MISMATCH when the document is a sheet', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'sheet',
      });

      await expect(controller.getContent('ws-1', 'd1')).rejects.toMatchObject({
        constructor: ConflictException,
        response: {
          error: {
            code: 'TYPE_MISMATCH',
            message: "Use 'sheets cells get' for spreadsheet documents",
          },
        },
      });
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });
  });

  describe('PUT', () => {
    it('writes the body via doc.update and echoes it back', async () => {
      const doc = makeDocFixture();
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'doc',
      });

      // Capture the root the controller's writer mutates so we can assert
      // it actually invoked writeDocsRoot (which sets `content` and
      // copies `pageSetup`). A static echo without write would not touch
      // the root.
      const capturedRoot: Record<string, unknown> = {};
      type FakeDoc = {
        update: (fn: (root: Record<string, unknown>) => void) => void;
        getRoot: () => Record<string, unknown>;
      };
      type Cb = (doc: FakeDoc) => unknown;
      yorkieService.withDocument.mockImplementation((_id: string, cb: Cb) => {
        const fakeDoc: FakeDoc = {
          update: (fn) => fn(capturedRoot),
          getRoot: () => capturedRoot,
        };
        return Promise.resolve(cb(fakeDoc));
      });

      const result = await controller.putContent('ws-1', 'd1', doc);

      // Echoed body matches input verbatim.
      expect(result).toEqual(doc);
      // writeDocsRoot was actually called: it sets `content` to a Tree.
      expect(capturedRoot.content).toBeDefined();
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        { docKeyPrefix: 'doc-' },
      );
    });

    it('returns 409 TYPE_MISMATCH when the target is a sheet', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'sheet',
      });

      await expect(
        controller.putContent('ws-1', 'd1', makeDocFixture()),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        response: {
          error: {
            code: 'TYPE_MISMATCH',
            message: "Use 'sheets cells get' for spreadsheet documents",
          },
        },
      });
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });
  });
});
