import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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

    it('returns 400 BadRequestException for a payload missing blocks', async () => {
      // The controller should reject malformed input before the type check
      // (and before any Yorkie work) so callers see a clear 400 instead of
      // a 500 thrown from inside `writeDocsRoot`.
      await expect(
        controller.putContent('ws-1', 'd1', {} as never),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: "Invalid docs content payload: 'blocks' must be an array",
      });
      expect(documentService.getDocumentOrThrow).not.toHaveBeenCalled();
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    /**
     * The shape guard exists because the Yorkie tree builder
     * unconditionally dereferences a handful of fields per block
     * (`id`, `type`, `style`, plus `inlines` on non-table blocks and
     * `tableData` on tables). Without the guard, any of these missing
     * surfaces as a 500 with a stack trace instead of a 400 with the
     * offending block path.
     */
    describe('block shape validation', () => {
      function expectReject(body: unknown, messageRe: RegExp) {
        return expect(
          controller.putContent('ws-1', 'd1', body as never),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: expect.stringMatching(messageRe),
        });
      }

      it('rejects a block missing id', async () => {
        await expectReject(
          { blocks: [{ type: 'paragraph', style: {}, inlines: [] }] },
          /blocks\[0\].*'id'/,
        );
      });

      it('rejects a block with empty id', async () => {
        await expectReject(
          { blocks: [{ id: '', type: 'paragraph', style: {}, inlines: [] }] },
          /blocks\[0\].*'id'/,
        );
      });

      it('rejects a block missing style', async () => {
        await expectReject(
          { blocks: [{ id: 'b1', type: 'paragraph', inlines: [] }] },
          /blocks\[0\].*'style'/,
        );
      });

      it("rejects a non-table block missing inlines", async () => {
        await expectReject(
          { blocks: [{ id: 'b1', type: 'paragraph', style: {} }] },
          /blocks\[0\].*'inlines'/,
        );
      });

      it("rejects type:'table' missing tableData", async () => {
        await expectReject(
          { blocks: [{ id: 'b1', type: 'table', style: {} }] },
          /blocks\[0\].*'tableData'.*required/,
        );
      });

      it("rejects type:'table' with non-array tableData.rows", async () => {
        await expectReject(
          {
            blocks: [
              {
                id: 'b1',
                type: 'table',
                style: {},
                tableData: { columnWidths: [100, 100], rows: 'not-an-array' },
              },
            ],
          },
          /blocks\[0\].*tableData\.rows/,
        );
      });

      it('rejects malformed nested block inside a table cell', async () => {
        await expectReject(
          {
            blocks: [
              {
                id: 'b1',
                type: 'table',
                style: {},
                tableData: {
                  columnWidths: [100],
                  rows: [
                    {
                      cells: [
                        { blocks: [{ id: 'inner', type: 'paragraph' /* no style */ }] },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          /blocks\[0\]\.tableData\.rows\[0\]\.cells\[0\]\.blocks\[0\].*'style'/,
        );
      });

      it('skips Yorkie work entirely when validation fails', async () => {
        await expectReject(
          { blocks: [{ id: 'b1', type: 'paragraph', style: {} }] },
          /'inlines'/,
        ).then(() => {
          expect(documentService.getDocumentOrThrow).not.toHaveBeenCalled();
          expect(yorkieService.withDocument).not.toHaveBeenCalled();
        });
      });
    });
  });
});
