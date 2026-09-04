import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SheetImage, SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetImagesController } from './worksheet-images.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const TAB = 'tab-1';

function image(overrides: Partial<SheetImage> = {}): SheetImage {
  return {
    id: 'img-1',
    src: '/api/v1/workspaces/ws-1/images/abc',
    anchor: 'B2',
    offsetX: 0,
    offsetY: 0,
    width: 100,
    height: 80,
    originalWidth: 100,
    originalHeight: 80,
    ...overrides,
  } as SheetImage;
}

/**
 * `worksheet-images.spec.ts` covers `parseImages`. What only exists here is
 * the controller: the type gate, the tab 404, and the destructive replace —
 * PUT rekeys the collection by `id`, so an image absent from the payload is
 * deleted.
 */
describe('ApiV1WorksheetImagesController', () => {
  let controller: ApiV1WorksheetImagesController;
  let root: SpreadsheetDocument;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let withDocument: jest.Mock;

  beforeEach(() => {
    root = createSpreadsheetDocument();
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    withDocument = jest.fn(
      (_id: string, cb: (d: typeof doc) => unknown, _options?: unknown) =>
        Promise.resolve(cb(doc)),
    );
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1WorksheetImagesController(
      { withDocument } as never,
      documentService as never,
    );
  });

  describe('setImages', () => {
    it('stores the collection keyed by each image id', async () => {
      const res = await controller.setImages(WS, DOC, TAB, {
        images: [image(), image({ id: 'img-2', anchor: 'D4' })],
      });

      expect(res).toEqual({ images: [image(), image({ id: 'img-2', anchor: 'D4' })] });
      expect(Object.keys(root.sheets[TAB].images ?? {})).toEqual([
        'img-1',
        'img-2',
      ]);
      expect(root.sheets[TAB].images?.['img-2'].anchor).toBe('D4');
    });

    it('replaces the whole collection — an omitted image is deleted', async () => {
      await controller.setImages(WS, DOC, TAB, {
        images: [image(), image({ id: 'img-2', anchor: 'D4' })],
      });
      await controller.setImages(WS, DOC, TAB, {
        images: [image({ id: 'img-2', anchor: 'D4' })],
      });

      expect(Object.keys(root.sheets[TAB].images ?? {})).toEqual(['img-2']);
    });

    it('clears the collection for an empty list', async () => {
      await controller.setImages(WS, DOC, TAB, { images: [image()] });
      await controller.setImages(WS, DOC, TAB, { images: [] });
      expect(root.sheets[TAB].images).toEqual({});
    });

    it('404s an unknown tab and writes nothing', async () => {
      await controller.setImages(WS, DOC, TAB, { images: [image()] });
      await expect(
        controller.setImages(WS, DOC, 'nope', { images: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The existing tab's images are untouched by the failed request.
      expect(Object.keys(root.sheets[TAB].images ?? {})).toEqual(['img-1']);
    });

    it('400s a malformed payload before opening Yorkie', async () => {
      await expect(
        controller.setImages(WS, DOC, TAB, { images: [{ id: 'x' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(withDocument).not.toHaveBeenCalled();
    });

    it('refuses a non-sheet document before opening Yorkie', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: DOC,
        workspaceId: WS,
        type: 'slides',
      });
      await expect(
        controller.setImages(WS, DOC, TAB, { images: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(withDocument).not.toHaveBeenCalled();
    });

    it('seeds the canonical spreadsheet root', async () => {
      await controller.setImages(WS, DOC, TAB, { images: [] });
      const opts = withDocument.mock.calls.at(-1)?.[2] as {
        initialRoot?: SpreadsheetDocument;
      };
      expect(opts.initialRoot?.tabOrder).toEqual(['tab-1']);
    });
  });

  describe('getImages', () => {
    it('detaches each stored image through its own toJSON', async () => {
      // A stored image is a Yorkie object proxy whose `toJSON()` answers a
      // JSON *string*; only that hands back something `res.json()` can
      // serialize.
      const stored = image({ id: 'img-9', anchor: 'A1' });
      root.sheets[TAB].images = {
        'img-9': {
          toJSON: () => JSON.stringify(stored),
        } as never,
      };

      expect(await controller.getImages(WS, DOC, TAB)).toEqual({
        images: [stored],
      });
      expect(withDocument.mock.calls.at(-1)?.[2]).toMatchObject({
        syncMode: 'readonly',
      });
    });

    it('reports an empty list for a tab with no images', async () => {
      expect(await controller.getImages(WS, DOC, TAB)).toEqual({ images: [] });
    });

    it('reports an empty list for an unknown tab rather than 404ing', async () => {
      // A read of a tab that is not there has nothing to report and no state
      // to protect, so it answers the empty collection.
      expect(await controller.getImages(WS, DOC, 'nope')).toEqual({
        images: [],
      });
    });
  });
});
