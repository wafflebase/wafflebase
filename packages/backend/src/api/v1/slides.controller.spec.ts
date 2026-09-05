import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MemSlidesStore } from '@wafflebase/slides';
import type { Slide } from '@wafflebase/slides';
import { ApiV1SlidesController } from './slides.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

/**
 * The per-slide verbs. The point they have to demonstrate is the one their
 * docblock claims: a slide operation lands as a **granular** change, so a
 * concurrent edit to another slide (or to another field of the same one)
 * survives — `root.slides = <array>` would be last-write-wins over the deck.
 */
function harness(type = 'slides') {
  const store = new MemSlidesStore();
  store.batch(() => {
    store.addSlide('title-body');
    store.addSlide('title-body');
  });
  const root = store.read() as unknown as Record<string, unknown>;

  const doc = {
    getRoot: () => root,
    update: (fn: (r: Record<string, unknown>) => void) => fn(root),
  };
  const withDocument = jest.fn(
    (_id: string, cb: (d: typeof doc) => unknown, _options?: unknown) =>
      Promise.resolve(cb(doc)),
  );
  const documentService = {
    getDocumentOrThrow: jest
      .fn()
      .mockResolvedValue({ id: DOC, workspaceId: WS, type }),
  };
  const controller = new ApiV1SlidesController(
    documentService as never,
    { withDocument } as never,
  );
  const slides = () => root.slides as Slide[];
  return { controller, withDocument, documentService, root, slides };
}

describe('ApiV1SlidesController', () => {
  it('refuses a non-slides document before opening Yorkie', async () => {
    const { controller, withDocument } = harness('sheet');
    await expect(controller.add(WS, DOC, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('opens the deck’s own Yorkie document', async () => {
    const { controller, withDocument } = harness();
    await controller.layouts(WS, DOC);
    expect(withDocument.mock.calls.at(-1)?.[2]).toMatchObject({
      docKeyPrefix: 'slides-',
      syncMode: 'readonly',
    });
  });

  describe('add', () => {
    it('appends a slide seeded from the layout', async () => {
      const { controller, slides } = harness();
      const res = await controller.add(WS, DOC, {});
      expect(res).toMatchObject({ index: 3, slideCount: 3 });
      expect(slides()).toHaveLength(3);
      expect(slides()[2].id).toBe(res.id);
    });

    it('inserts at a 1-based index and clamps past the end', async () => {
      const { controller, slides } = harness();
      const first = await controller.add(WS, DOC, { index: 1 });
      expect(slides()[0].id).toBe(first.id);
      const last = await controller.add(WS, DOC, { index: 99 });
      expect(slides().at(-1)?.id).toBe(last.id);
      expect(last.slideCount).toBe(4);
    });

    it('400s a non-positive index', async () => {
      const { controller } = harness();
      await expect(
        controller.add(WS, DOC, { index: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps a concurrent edit to another slide', async () => {
      // The whole reason these verbs exist beside `PUT .../content`: only the
      // one slide is written, so nothing else in the array is replaced.
      const { controller, slides } = harness();
      const untouched = slides()[0];
      const peerEdit = { ...untouched.elements[0] };
      await controller.add(WS, DOC, {});
      expect(slides()[0]).toBe(untouched);
      expect(slides()[0].elements[0]).toEqual(peerEdit);
    });
  });

  describe('duplicate', () => {
    it('inserts the copy after the source with fresh element ids', async () => {
      const { controller, slides } = harness();
      const sourceId = slides()[0].id;
      const sourceElementIds = slides()[0].elements.map((e) => e.id);

      const res = await controller.duplicate(WS, DOC, sourceId);

      expect(res).toMatchObject({ index: 2, slideCount: 3 });
      expect(slides()[1].id).toBe(res.id);
      for (const element of slides()[1].elements) {
        expect(sourceElementIds).not.toContain(element.id);
      }
      // The source object itself was never rewritten.
      expect(slides()[0].id).toBe(sourceId);
    });

    it('404s an unknown slide and writes nothing', async () => {
      const { controller, slides } = harness();
      await expect(
        controller.duplicate(WS, DOC, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(slides()).toHaveLength(2);
    });
  });

  describe('move', () => {
    it('moves a slide to a 1-based position', async () => {
      const { controller, slides } = harness();
      const lastId = slides()[1].id;
      expect(await controller.move(WS, DOC, lastId, { index: 1 })).toEqual({
        id: lastId,
        index: 1,
        slideCount: 2,
      });
      expect(slides()[0].id).toBe(lastId);
    });

    it('400s a missing or invalid index', async () => {
      const { controller, slides } = harness();
      const id = slides()[0].id;
      await expect(controller.move(WS, DOC, id, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        controller.move(WS, DOC, id, { index: -2 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s an unknown slide', async () => {
      const { controller } = harness();
      await expect(
        controller.move(WS, DOC, 'nope', { index: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes one slide and leaves the rest untouched', async () => {
      const { controller, slides } = harness();
      const kept = slides()[1];
      const res = await controller.remove(WS, DOC, slides()[0].id);
      expect(res).toMatchObject({ slideCount: 1 });
      expect(slides()).toHaveLength(1);
      expect(slides()[0]).toBe(kept);
    });

    it('409s the last remaining slide', async () => {
      const { controller, slides } = harness();
      await controller.remove(WS, DOC, slides()[0].id);
      await expect(
        controller.remove(WS, DOC, slides()[0].id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(slides()).toHaveLength(1);
    });

    it('404s an unknown slide', async () => {
      const { controller } = harness();
      await expect(controller.remove(WS, DOC, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('layouts', () => {
    it('reports the deck’s own layout ids with their placeholder types', async () => {
      const { controller } = harness();
      const { layouts } = await controller.layouts(WS, DOC);
      expect(layouts.find((l) => l.id === 'title-body')).toMatchObject({
        placeholders: ['title', 'body'],
      });
    });
  });
});
