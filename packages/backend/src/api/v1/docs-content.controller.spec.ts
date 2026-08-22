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

import type {
  DocsDocument,
  SlidesDocument,
} from '../../yorkie/yorkie.types';

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

function makeSlidesFixture(): SlidesDocument {
  return {
    meta: {
      title: 'Imported Deck',
      themeId: 'default-light',
      masterId: 'default',
    },
    themes: [],
    masters: [],
    layouts: [],
    slides: [
      {
        id: 'slide-1',
        layoutId: 'title-body',
        background: { fill: { kind: 'role', role: 'background' } },
        elements: [],
        notes: [],
      },
    ],
  } as unknown as SlidesDocument;
}

describe('ApiV1DocsContentController', () => {
  let controller: ApiV1DocsContentController;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let yorkieService: { withDocument: jest.Mock };

  // The API key `write` scope is enforced by `ApiKeyWriteScopeGuard` on the
  // controller rather than inside the handler, so a read-scoped key never
  // reaches `putContent` — see `api-key-write-scope.guard.spec.ts`, which
  // covers every mutating method and asserts the guard is mounted here.
  const putContent = (workspaceId: string, documentId: string, body: unknown) =>
    controller.putContent(workspaceId, documentId, body);

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

    it('returns the SlidesDocument JSON for a slides-typed document', async () => {
      const deck = makeSlidesFixture();
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'slides',
      });
      yorkieService.withDocument.mockResolvedValue(deck);

      const result = await controller.getContent('ws-1', 'd1');

      expect(result).toEqual(deck);
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        expect.objectContaining({
          docKeyPrefix: 'slides-',
          syncMode: 'readonly',
        }),
      );
    });

    it('returns the note content JSON for a note-typed document', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'note',
      });
      yorkieService.withDocument.mockResolvedValue({ content: '# Hi' });

      const result = await controller.getContent('ws-1', 'd1');

      expect(result).toEqual({ content: '# Hi' });
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        expect.objectContaining({
          docKeyPrefix: 'note-',
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
    it('writes a docs body via doc.update and echoes it back', async () => {
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

      const result = await putContent('ws-1', 'd1', doc);

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

    it('writes a slides body via doc.update and echoes it back', async () => {
      const deck = makeSlidesFixture();
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'slides',
      });

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

      const result = await putContent('ws-1', 'd1', deck);

      expect(result).toEqual(deck);
      // writeSlidesRoot assigns top-level slides fields onto the root.
      expect(capturedRoot.meta).toEqual(deck.meta);
      expect(capturedRoot.slides).toEqual(deck.slides);
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        { docKeyPrefix: 'slides-' },
      );
    });

    it('writes a note body via doc.update and echoes it back', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'note',
      });

      // Seed a fake `Text` on the root so writeNoteRoot takes the
      // existing-text (edit) branch rather than constructing a real
      // Yorkie `Text` — which would need a live document context.
      const edits: Array<[number, number, string]> = [];
      let value = 'stale';
      const fakeText = {
        get length() {
          return value.length;
        },
        toString: () => value,
        edit: (from: number, to: number, content: string) => {
          edits.push([from, to, content]);
          value = value.slice(0, from) + content + value.slice(to);
        },
      };
      const capturedRoot: Record<string, unknown> = { content: fakeText };
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

      const result = await putContent('ws-1', 'd1', {
        content: 'new markdown',
      } as never);

      expect(result).toEqual({ content: 'new markdown' });
      expect(edits).toEqual([[0, 'stale'.length, 'new markdown']]);
      expect(yorkieService.withDocument).toHaveBeenCalledWith(
        'd1',
        expect.any(Function),
        { docKeyPrefix: 'note-' },
      );
    });

    it('rejects a note payload whose content is not a string', async () => {
      // Only a *string* `content` routes to the note arm, so a non-string
      // value is an unrecognised shape and hits the generic 400 before any
      // metadata/Yorkie work.
      await expect(
        putContent('ws-1', 'd1', { content: 123 } as never),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/'blocks'.*'slides'.*'content'/),
      });
      expect(documentService.getDocumentOrThrow).not.toHaveBeenCalled();
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    it('returns 400 when a note body targets a slides document', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'slides',
      });

      await expect(
        putContent('ws-1', 'd1', { content: '# hi' } as never),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/shape 'note'.*type 'slides'/),
      });
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    it('returns 400 when body shape does not match document type', async () => {
      // Body looks like docs (`blocks` array) but the document is slides.
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'slides',
      });

      await expect(
        putContent('ws-1', 'd1', makeDocFixture()),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/shape 'doc'.*type 'slides'/),
      });
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    it('returns 409 TYPE_MISMATCH when the target is a sheet', async () => {
      // The body must be one of the recognised shapes (docs/slides) for
      // the type check to fire — a sheet's would-be cell payload doesn't
      // hit this endpoint, so we send a docs body and assert the type
      // mismatch.
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: 'd1',
        workspaceId: 'ws-1',
        type: 'sheet',
      });

      await expect(
        putContent('ws-1', 'd1', makeDocFixture()),
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

    it('returns 400 BadRequestException for a payload missing blocks and slides', async () => {
      // The controller should reject malformed input before the type check
      // (and before any Yorkie work) so callers see a clear 400 instead of
      // a 500 thrown from inside the writer.
      await expect(
        putContent('ws-1', 'd1', {} as never),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/'blocks'.*'slides'/),
      });
      expect(documentService.getDocumentOrThrow).not.toHaveBeenCalled();
      expect(yorkieService.withDocument).not.toHaveBeenCalled();
    });

    describe('docs block shape validation', () => {
      function expectReject(body: unknown, messageRe: RegExp) {
        return expect(
          putContent('ws-1', 'd1', body as never),
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

      it('accepts a partial block style', async () => {
        // Validation constrains the *shape* only; every field of a block
        // style is optional and the writer/reader fall back to the block
        // defaults. Getting as far as the metadata lookup proves it passed.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        await expect(
          putContent('ws-1', 'd1', {
            blocks: [{ id: 'b1', type: 'paragraph', style: {}, inlines: [] }],
          } as never),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('rejects an out-of-range alignment', async () => {
        // `style.alignment` is persisted verbatim into the CRDT and read
        // back out into an OOXML attribute by the DOCX exporter.
        await expectReject(
          {
            blocks: [
              {
                id: 'b1',
                type: 'paragraph',
                style: { alignment: 'center"/><w:jc w:val="right' },
                inlines: [],
              },
            ],
          },
          /blocks\[0\].*'style\.alignment'/,
        );
      });

      it('rejects a non-finite block style number', async () => {
        await expectReject(
          {
            blocks: [
              {
                id: 'b1',
                type: 'paragraph',
                style: { marginTop: 'lots' },
                inlines: [],
              },
            ],
          },
          /blocks\[0\].*'style\.marginTop'/,
        );
      });

      it('rejects a malformed inline', async () => {
        await expectReject(
          {
            blocks: [
              { id: 'b1', type: 'paragraph', style: {}, inlines: [{ text: 5 }] },
            ],
          },
          /blocks\[0\]\.inlines\[0\].*'text'/,
        );
      });

      it('rejects a table cell without a style', async () => {
        await expectReject(
          {
            blocks: [
              {
                id: 'b1',
                type: 'table',
                style: {},
                tableData: {
                  columnWidths: [100],
                  rows: [{ cells: [{ blocks: [] }] }],
                },
              },
            ],
          },
          /blocks\[0\]\.tableData\.rows\[0\]\.cells\[0\].*'style'/,
        );
      });

      // `writeDocsRoot` persists header/footer blocks through the same
      // `buildBlockNode`, so validating only `body.blocks` would let the
      // exact value rejected above through the very same endpoint.
      it('rejects a malformed block inside the header', async () => {
        await expectReject(
          {
            blocks: [],
            header: {
              marginFromEdge: 40,
              blocks: [
                {
                  id: 'h1',
                  type: 'paragraph',
                  style: { alignment: 'center"/><w:jc w:val="right' },
                  inlines: [],
                },
              ],
            },
          },
          /header\.blocks\[0\].*'style\.alignment'/,
        );
      });

      it('rejects a malformed block inside the footer', async () => {
        await expectReject(
          {
            blocks: [],
            footer: {
              marginFromEdge: 40,
              blocks: [{ type: 'paragraph', style: {}, inlines: [] }],
            },
          },
          /footer\.blocks\[0\].*'id'/,
        );
      });

      it('rejects a non-finite header marginFromEdge', async () => {
        await expectReject(
          { blocks: [], header: { marginFromEdge: 'top', blocks: [] } },
          /'header\.marginFromEdge'/,
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

    describe('slides body shape validation', () => {
      function expectReject(body: unknown, messageRe: RegExp) {
        return expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: expect.stringMatching(messageRe),
        });
      }

      function withSlides<T extends object>(overrides: T): unknown {
        // Build a payload that sniffBodyShape recognises as slides
        // (`slides` array + `meta` object) but with a specific field
        // intentionally broken.
        return { ...makeSlidesFixture(), ...overrides };
      }

      it("rejects missing meta", async () => {
        await expectReject(
          { slides: [], meta: 'not-an-object' },
          /'meta'.*object/,
        );
      });

      it("rejects missing meta.title", async () => {
        await expectReject(
          withSlides({
            meta: { title: '', themeId: 'x', masterId: 'y' },
          }),
          /meta\.title.*non-empty string/,
        );
      });

      it("rejects non-array layouts", async () => {
        await expectReject(
          withSlides({ layouts: 'not-an-array' as unknown as [] }),
          /'layouts'.*array/,
        );
      });

      it("rejects a slide missing id", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: '',
                layoutId: 'l',
                background: {},
                elements: [],
                notes: [],
              },
            ] as unknown as [],
          }),
          /slides\[0\].*'id'/,
        );
      });

      it("rejects a slide with non-array elements", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: 'oops',
                notes: [],
              },
            ] as unknown as [],
          }),
          /slides\[0\].*'elements'.*array/,
        );
      });

      it("rejects an element missing type", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  { id: 'e1', frame: {} },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /slides\[0\]\.elements\[0\].*'type'/,
        );
      });

      it("rejects an element missing frame", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  { id: 'e1', type: 'shape' },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /slides\[0\]\.elements\[0\].*'frame'/,
        );
      });

      // Slide text bodies hold docs `Block`s — the same shape (and the same
      // layout engine) the docs arm validates — persisted verbatim as JSON.
      // Validating only the docs arm would leave this endpoint accepting
      // through `slides` exactly what it rejects through `blocks`.
      function withTextElement(data: unknown): unknown {
        return withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [{ id: 'e1', type: 'text', frame: {}, data }],
              notes: [],
            },
          ] as unknown as [],
        });
      }

      it('rejects a non-string alignment inside a text element', async () => {
        // Slide text bodies are read back verbatim, so the *allowlist* the
        // docs arm applies would 400 a round-trip of a deck already carrying
        // an out-of-set alignment (the PPTX exporter's closed Map lookup
        // drops one at the sink). A non-string is still rejected: it can
        // never be an alignment.
        await expectReject(
          withTextElement({
            blocks: [{ id: 'b1', type: 'paragraph', style: { alignment: 42 }, inlines: [] }],
          }),
          /elements\[0\]\.data\.blocks\[0\].*'style\.alignment'/,
        );
      });

      it('rejects a non-finite margin inside a text element', async () => {
        await expectReject(
          withTextElement({
            blocks: [{ id: 'b1', type: 'paragraph', style: { marginTop: 'lots' }, inlines: [] }],
          }),
          /elements\[0\]\.data\.blocks\[0\].*'style\.marginTop'/,
        );
      });

      it('rejects a bad block style inside shape text', async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  {
                    id: 'e1',
                    type: 'shape',
                    frame: {},
                    data: {
                      text: {
                        blocks: [
                          { id: 'b1', type: 'paragraph', style: { lineHeight: 'tall' }, inlines: [] },
                        ],
                      },
                    },
                  },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /elements\[0\]\.data\.text\.blocks\[0\].*'style\.lineHeight'/,
        );
      });

      it('rejects a bad block style inside a table cell body', async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  {
                    id: 'e1',
                    type: 'table',
                    frame: {},
                    data: {
                      columnWidths: [100],
                      rows: [
                        {
                          cells: [
                            {
                              body: {
                                blocks: [
                                  { id: 'b1', type: 'paragraph', style: { textIndent: 'x' }, inlines: [] },
                                ],
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /rows\[0\]\.cells\[0\]\.body\.blocks\[0\].*'style\.textIndent'/,
        );
      });

      // A group child carries no `id` here on purpose: children are persisted
      // verbatim and were never held to the element contract, so requiring
      // `id`/`frame` of them would 400 a round-trip of an existing deck. The
      // text body inside is still walked.
      function withGroupChild(child: unknown): unknown {
        return withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                { id: 'g1', type: 'group', frame: {}, data: { children: [child] } },
              ],
              notes: [],
            },
          ] as unknown as [],
        });
      }

      it('rejects a bad block style inside a group child', async () => {
        await expectReject(
          withGroupChild({
            type: 'text',
            data: {
              blocks: [
                { id: 'b1', type: 'paragraph', style: { marginLeft: 'far' }, inlines: [] },
              ],
            },
          }),
          /children\[0\]\.data\.blocks\[0\].*'style\.marginLeft'/,
        );
      });

      it('accepts a group child that omits id and frame', async () => {
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        await expect(
          putContent(
            'ws-1',
            'd1',
            withGroupChild({
              type: 'text',
              data: { blocks: [{ type: 'paragraph', style: { alignment: 'center' } }] },
            }) as never,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('rejects a bad block style inside slide notes', async () => {
        // `Slide.notes` is `Block[]` — the same docs blocks, reaching the same
        // layout engine and the same PPTX notes-slide exporter.
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [],
                notes: [
                  { id: 'n1', type: 'paragraph', style: { marginTop: 'lots' }, inlines: [] },
                ],
              },
            ] as unknown as [],
          }),
          /slides\[0\]\.notes\[0\].*'style\.marginTop'/,
        );
      });

      it('rejects a bad block style inside a layout placeholder', async () => {
        // Layout placeholders / static elements hold the same element shapes
        // as a slide's own elements and go through the same PUT.
        await expectReject(
          withSlides({
            layouts: [
              {
                id: 'l1',
                masterId: 'm1',
                name: 'Title',
                placeholders: [
                  {
                    type: 'text',
                    frame: {},
                    data: {
                      blocks: [
                        { id: 'b1', type: 'paragraph', style: { textIndent: 'x' }, inlines: [] },
                      ],
                    },
                  },
                ],
                staticElements: [],
              },
            ] as unknown as [],
          }),
          /layouts\[0\]\.placeholders\[0\]\.data\.blocks\[0\].*'style\.textIndent'/,
        );
      });

      it('rejects a bad block style inside a layout static element', async () => {
        await expectReject(
          withSlides({
            layouts: [
              {
                id: 'l1',
                masterId: 'm1',
                name: 'Title',
                placeholders: [],
                staticElements: [
                  {
                    id: 'se1',
                    type: 'shape',
                    frame: {},
                    data: {
                      text: {
                        blocks: [
                          { id: 'b1', type: 'paragraph', style: { lineHeight: NaN }, inlines: [] },
                        ],
                      },
                    },
                  },
                ],
              },
            ] as unknown as [],
          }),
          /layouts\[0\]\.staticElements\[0\]\.data\.text\.blocks\[0\].*'style\.lineHeight'/,
        );
      });

      it('accepts null style values in a slide text body', async () => {
        // `null` is how JSON spells "no value", and the CRDT codec already
        // skips it, so a stored `lineHeight: null` must survive a
        // GET → edit → PUT round-trip rather than 400.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        await expect(
          putContent(
            'ws-1',
            'd1',
            withTextElement({
              blocks: [
                {
                  id: 'b1',
                  type: 'paragraph',
                  style: { lineHeight: null, marginTop: null, alignment: null },
                  inlines: [],
                },
              ],
            }) as never,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('accepts an out-of-set alignment string in a slide text body', async () => {
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        await expect(
          putContent(
            'ws-1',
            'd1',
            withTextElement({
              blocks: [{ id: 'b1', type: 'paragraph', style: { alignment: 'middle' }, inlines: [] }],
            }) as never,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('accepts a slide text block that omits id/inlines', async () => {
        // Slide text bodies are stored verbatim with no attribute codec to
        // normalize them on read, so the structural block requirements of
        // the docs arm must NOT apply here — a legacy deck has to survive a
        // GET → edit → PUT round-trip. Reaching the metadata lookup proves
        // validation passed.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        await expect(
          putContent(
            'ws-1',
            'd1',
            withTextElement({
              blocks: [{ type: 'paragraph', style: { alignment: 'center' } }],
            }) as never,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      // The inline runs inside a slide text body reach the *shared* docs
      // layout engine, which dereferences `block.inlines` and `inline.style`
      // unconditionally (`resolveBlockInlines`, `measureSegments`,
      // `resolveColorAtPosition`, the PDF/PPTX font sweep). A deck is stored
      // verbatim, so a malformed run breaks every viewer of that deck, not
      // just the caller who PUT it.
      it('rejects a non-array inlines in a slide text body', async () => {
        await expectReject(
          withTextElement({
            blocks: [{ id: 'b1', type: 'paragraph', style: {}, inlines: 'nope' }],
          }),
          /elements\[0\]\.data\.blocks\[0\].*'inlines'.*array/,
        );
      });

      it('rejects a non-object inline entry in a slide text body', async () => {
        await expectReject(
          withTextElement({
            blocks: [{ id: 'b1', type: 'paragraph', style: {}, inlines: ['hi'] }],
          }),
          /elements\[0\]\.data\.blocks\[0\]\.inlines\[0\].*not an object/,
        );
      });

      it('rejects a non-string inline text in a slide text body', async () => {
        await expectReject(
          withTextElement({
            blocks: [
              { id: 'b1', type: 'paragraph', style: {}, inlines: [{ style: {} }] },
            ],
          }),
          /elements\[0\]\.data\.blocks\[0\]\.inlines\[0\].*'text'.*string/,
        );
      });

      it('rejects a non-object inline style in a slide text body', async () => {
        await expectReject(
          withTextElement({
            blocks: [
              {
                id: 'b1',
                type: 'paragraph',
                style: {},
                inlines: [{ text: 'x', style: 'bold' }],
              },
            ],
          }),
          /elements\[0\]\.data\.blocks\[0\]\.inlines\[0\].*'style'.*object/,
        );
      });

      it('rejects malformed inlines inside slide notes and layout placeholders', async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [],
                notes: [
                  { id: 'n1', type: 'paragraph', style: {}, inlines: [{ text: 1 }] },
                ],
              },
            ] as unknown as [],
          }),
          /slides\[0\]\.notes\[0\]\.inlines\[0\].*'text'/,
        );
        await expectReject(
          withSlides({
            layouts: [
              {
                id: 'l1',
                masterId: 'm1',
                name: 'Title',
                placeholders: [
                  {
                    type: 'text',
                    frame: {},
                    data: {
                      blocks: [
                        { id: 'b1', type: 'paragraph', style: {}, inlines: [null] },
                      ],
                    },
                  },
                ],
                staticElements: [],
              },
            ] as unknown as [],
          }),
          /layouts\[0\]\.placeholders\[0\]\.data\.blocks\[0\]\.inlines\[0\].*not an object/,
        );
      });

      it('fills in an absent inlines / inline style instead of storing a crashing shape', async () => {
        // Rejecting these would 400 a GET → edit → PUT round-trip of a legacy
        // deck, but storing them verbatim is a TypeError for every viewer. So
        // the empty shape is filled in and the repaired body is what reaches
        // the writer (and what the endpoint echoes back).
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withTextElement({
          blocks: [
            { id: 'b1', type: 'paragraph', style: {} },
            { id: 'b2', type: 'paragraph', style: {}, inlines: [{ text: 'x' }] },
          ],
        }) as {
          slides: Array<{
            elements: Array<{
              data: { blocks: Array<{ inlines?: Array<{ style?: unknown }> }> };
            }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const blocks = body.slides[0].elements[0].data.blocks;
        expect(blocks[0].inlines).toEqual([]);
        expect(blocks[1].inlines![0].style).toEqual({});
      });

      it('fills in an absent blocks list instead of storing a crashing shape', async () => {
        // `TextBody.blocks` is required by the model and every consumer of a
        // stored deck dereferences it unconditionally (`body.blocks.map` in
        // the slides text renderer, `for (const block of body.blocks)` in the
        // PDF exporter, `data.blocks.length` in the animation paragraph
        // counter). Accepting an absent `blocks` therefore persists a shape
        // that is a TypeError for every viewer — the same failure mode as an
        // absent `inlines`, and it gets the same repair.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withTextElement({ autofit: 'none' }) as {
          slides: Array<{ elements: Array<{ data: { blocks?: unknown } }> }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(body.slides[0].elements[0].data.blocks).toEqual([]);
      });

      it('fills in an absent block style instead of storing a crashing shape', async () => {
        // `Block.style` is required by the model and the PPTX exporter reads
        // it unconditionally (`ALGN.get(block.style.alignment)` in
        // packages/slides/src/export/pptx/text.ts), so a stored block without
        // one throws when the deck is exported.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withTextElement({
          blocks: [{ id: 'b1', type: 'paragraph', inlines: [] }],
        }) as {
          slides: Array<{
            elements: Array<{ data: { blocks: Array<{ style?: unknown }> } }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(body.slides[0].elements[0].data.blocks[0].style).toEqual({});
      });

      it('repairs an absent blocks list inside notes, shape text and table cells', async () => {
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                { id: 'e1', type: 'shape', frame: {}, data: { text: {} } },
                {
                  id: 'e2',
                  type: 'table',
                  frame: {},
                  data: { rows: [{ cells: [{ body: {} }] }] },
                },
              ],
              notes: [{ id: 'n1', type: 'paragraph', inlines: [] }],
            },
          ] as unknown as [],
        }) as {
          slides: Array<{
            elements: Array<{ data: Record<string, never> }>;
            notes: Array<{ style?: unknown }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const [shape, table] = body.slides[0].elements as unknown as [
          { data: { text: { blocks?: unknown } } },
          { data: { rows: Array<{ cells: Array<{ body: { blocks?: unknown } }> }> } },
        ];
        expect(shape.data.text.blocks).toEqual([]);
        expect(table.data.rows[0].cells[0].body.blocks).toEqual([]);
        expect(body.slides[0].notes[0].style).toEqual({});
      });

      it('rejects an array as a slide block style', async () => {
        // `typeof [] === 'object'`, so the object check alone lets an array
        // through into a field every reader spreads as a record.
        await expectReject(
          withTextElement({
            blocks: [{ id: 'b1', type: 'paragraph', style: [], inlines: [] }],
          }),
          /elements\[0\]\.data\.blocks\[0\].*'style'.*object/,
        );
      });

      it("fills in a text element's absent data instead of storing a crashing shape", async () => {
        // `TextElement.data` *is* the `TextBody`. Skipping the walk when it
        // is absent stores the very shape the walk exists to prevent:
        // `isElementEmpty` reads `el.data.blocks` unconditionally
        // (packages/slides/src/model/element.ts:640) and `migrateElement`
        // only repairs shapes, so nothing fixes it on read. Group children
        // and layout placeholders reach the same walk.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                { id: 'e1', type: 'text', frame: {} },
                {
                  id: 'e2',
                  type: 'group',
                  frame: {},
                  data: { children: [{ type: 'text', frame: {} }] },
                },
              ],
              notes: [],
            },
          ] as unknown as [],
        }) as {
          slides: Array<{
            elements: Array<{ data?: { blocks?: unknown; children?: unknown } }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const [text, group] = body.slides[0].elements as unknown as [
          { data: { blocks?: unknown } },
          { data: { children: Array<{ data?: { blocks?: unknown } }> } },
        ];
        expect(text.data.blocks).toEqual([]);
        expect(group.data.children[0].data!.blocks).toEqual([]);
      });

      it("rejects an array as a text element's data", async () => {
        // `typeof [] === 'object'`, so an array would pass an object check
        // and then take the repair as an array expando (`[].blocks = []`),
        // which JSON serialization drops — the deck would be stored in the
        // crashing shape the repair claims to have fixed. Reject instead:
        // no editor writes it, so nothing round-trips through here.
        await expectReject(
          withTextElement([]),
          /elements\[0\].*'data'.*object/,
        );
      });

      it("fills in a table cell's absent body instead of storing a crashing shape", async () => {
        // `TableCell.body` is required by the model and the table renderer
        // reads `cell.body.blocks` unconditionally
        // (packages/slides/src/view/canvas/table-renderer.ts:229), so an
        // absent body is a TypeError for every viewer of the deck — the
        // same failure mode as an absent `blocks`, and the same repair.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                {
                  id: 'e1',
                  type: 'table',
                  frame: {},
                  data: { rows: [{ cells: [{ style: {} }] }] },
                },
              ],
              notes: [],
            },
          ] as unknown as [],
        }) as {
          slides: Array<{
            elements: Array<{
              data: { rows: Array<{ cells: Array<{ body?: unknown }> }> };
            }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
          body.slides[0].elements[0].data.rows[0].cells[0].body,
        ).toEqual({ blocks: [] });
      });

      it("fills in every element type's absent data, not just text", async () => {
        // The renderer dereferences `element.data` for *every* type
        // (`element.data.effects?.shadow` in element-renderer.ts), and the
        // type-specific readers go further: `drawTable` reads
        // `data.columnWidths.length`, `flattenElements` walks
        // `data.children`. Repairing text only left those stored crashes.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                { id: 'e1', type: 'table', frame: {} },
                { id: 'e2', type: 'group', frame: {} },
                { id: 'e3', type: 'image', frame: {} },
              ],
              notes: [],
            },
          ] as unknown as [],
        }) as { slides: Array<{ elements: Array<{ data?: unknown }> }> };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const [table, group, image] = body.slides[0].elements;
        expect(table.data).toEqual({ rows: [], columnWidths: [] });
        expect(group.data).toEqual({ children: [] });
        expect(image.data).toEqual({});
      });

      it('repairs a table cell style, a null cell and an absent columnWidths', async () => {
        // Each is read *before* the cell body the previous test repairs:
        // `paintCellFills` reads `cell.style.fill`, `paddingOf` reads
        // `cell.style.padding`, `drawTable` reads `data.columnWidths.length`,
        // and the PDF exporter's `for (const cell of row.cells)
        // bodies.push(cell.body)` throws on a null cell the canvas renderer
        // happens to tolerate.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withSlides({
          slides: [
            {
              id: 's1',
              layoutId: 'l',
              background: {},
              elements: [
                {
                  id: 'e1',
                  type: 'table',
                  frame: {},
                  data: { rows: [{ height: 10, cells: [{ body: {} }, null] }] },
                },
              ],
              notes: [],
            },
          ] as unknown as [],
        }) as {
          slides: Array<{
            elements: Array<{
              data: {
                columnWidths?: unknown;
                rows: Array<{ cells: Array<{ style?: unknown; body?: unknown }> }>;
              };
            }>;
          }>;
        };
        await expect(
          putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const data = body.slides[0].elements[0].data;
        expect(data.columnWidths).toEqual([]);
        expect(data.rows[0].cells[0].style).toEqual({});
        expect(data.rows[0].cells[1]).toEqual({ body: { blocks: [] }, style: {} });
      });

      it('rejects a table cell that is not an object', async () => {
        // Previously skipped with `continue`, which stored the crashing
        // shape: an array cell is truthy, so `isCovered(cell)` is false and
        // `paddingOf(cell)` throws on `cell.style.padding`.
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  {
                    id: 'e1',
                    type: 'table',
                    frame: {},
                    data: { rows: [{ cells: [[]] }] },
                  },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /elements\[0\]\.data\.rows\[0\]\.cells\[0\].*not an object/,
        );
      });

      it("rejects a non-array rows on a table element's data", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  { id: 'e1', type: 'table', frame: {}, data: { rows: 'lots' } },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /elements\[0\]\.data.*'rows'.*array/,
        );
      });

      it("rejects a non-array children on a group element's data", async () => {
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  { id: 'e1', type: 'group', frame: {}, data: { children: {} } },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /elements\[0\]\.data.*'children'.*array/,
        );
      });

      it('rejects an array as a shape text body and as a table cell body', async () => {
        // Same reasoning as the text element's `data`: the `blocks` repair on
        // an array is an expando JSON drops, so the crashing shape would be
        // stored anyway.
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  { id: 'e1', type: 'shape', frame: {}, data: { text: [] } },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /elements\[0\]\.data\.text.*text body must be an object/,
        );
        await expectReject(
          withSlides({
            slides: [
              {
                id: 's1',
                layoutId: 'l',
                background: {},
                elements: [
                  {
                    id: 'e1',
                    type: 'table',
                    frame: {},
                    data: { rows: [{ cells: [{ body: [] }] }] },
                  },
                ],
                notes: [],
              },
            ] as unknown as [],
          }),
          /cells\[0\]\.body.*text body must be an object/,
        );
      });

      function withElements(elements: unknown[]): unknown {
        return withSlides({
          slides: [
            { id: 's1', layoutId: 'l', background: {}, elements, notes: [] },
          ] as unknown as [],
        });
      }

      it("fills in a chart element's absent categories and series", async () => {
        // `drawChart` reads `data.series[i]`, `data.series.length` and
        // `data.categories.length` unconditionally, so an absent one is the
        // same stored TypeError as a table's absent `rows`.
        documentService.getDocumentOrThrow.mockRejectedValue(
          new NotFoundException('sentinel'),
        );
        const body = withElements([
          { id: 'e1', type: 'chart', frame: {} },
          { id: 'e2', type: 'chart', frame: {}, data: { kind: 'bar' } },
        ]) as { slides: Array<{ elements: Array<{ data: unknown }> }> };
        await expect(
          controller.putContent('ws-1', 'd1', body as never),
        ).rejects.toBeInstanceOf(NotFoundException);
        const [absent, partial] = body.slides[0].elements;
        expect(absent.data).toEqual({ categories: [], series: [] });
        expect(partial.data).toEqual({
          kind: 'bar',
          categories: [],
          series: [],
        });
      });

      it('rejects a non-array series on a chart element', async () => {
        await expectReject(
          withElements([
            { id: 'e1', type: 'chart', frame: {}, data: { series: 'nope' } },
          ]),
          /'series'.*array/,
        );
      });

      it('rejects an element tree nested past the depth limit', async () => {
        // The walk recurses through `data.children` with no bound, against a
        // 25 MB body limit — a compact payload can exhaust the stack on an
        // authenticated endpoint.
        let node: Record<string, unknown> = {
          type: 'text',
          data: { blocks: [] },
        };
        for (let i = 0; i < 200; i++) {
          node = { type: 'group', data: { children: [node] } };
        }
        await expectReject(
          withElements([{ id: 'e1', frame: {}, ...node }]),
          /nested too deeply/,
        );
      });
    });

  });
});
