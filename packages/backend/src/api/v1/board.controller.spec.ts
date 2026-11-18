import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_AGENT_ELEMENTS,
  SECTION_PADDING,
  STICKY_ROLE,
  buildSectionInit,
  buildStickyInit,
  isStickyData,
  sectionOf,
} from '@wafflebase/board';
import type { Element, Frame } from '@wafflebase/slides';
import { Document as YorkieDocument } from '@yorkie-js/sdk';
import { ApiV1BoardController } from './board.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

type Root = Record<string, unknown> & { elements?: Element[] };

function sticky(id: string, x: number, y: number, text = id): Element {
  const init = buildStickyInit(
    '#FFF8B8',
    { x: x + 90, y: y + 90 },
    { text, author: 'ann' },
  );
  return { ...init, id } as Element;
}

function section(
  id: string,
  frame: Omit<Frame, 'rotation'>,
  opts: { locked?: boolean } = {},
): Element {
  const init = buildSectionInit(frame, { title: id });
  const el = { ...init, id } as Element;
  if (opts.locked) {
    (dataOf(el) as { section: { locked?: boolean } }).section.locked = true;
  }
  return el;
}

function harness(
  root: Root,
  opts: {
    type?: string;
    username?: string;
    realDoc?: YorkieDocument<Root>;
  } = {},
) {
  const doc = opts.realDoc ?? {
    getRoot: () => root,
    update: (fn: (r: Root) => void) => fn(root),
  };
  const withDocument = jest.fn(
    (...args: [string, (d: typeof doc) => unknown, unknown?]) =>
      Promise.resolve(args[1](doc)),
  );
  const documentService = {
    getDocumentOrThrow: jest.fn().mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: opts.type ?? 'board',
    }),
  };
  const userService = {
    user: jest.fn().mockResolvedValue({ id: 7, username: 'agent-owner' }),
  };
  const controller = new ApiV1BoardController(
    documentService as never,
    { withDocument } as never,
    userService as never,
  );
  const req = { user: { id: 7, username: opts.username } } as never;
  return { controller, withDocument, userService, root, req };
}

/** An element's `data`, whatever its type (a connector has none). */
const dataOf = (el: Element) =>
  (el as unknown as { data: Record<string, unknown> }).data;
const els = (root: Root) => root.elements as Element[];
const byId = (root: Root, id: string) => els(root).find((el) => el.id === id)!;

function overlaps(a: Frame, b: Frame) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

describe('ApiV1BoardController', () => {
  it('refuses a non-board document before opening Yorkie', async () => {
    const { controller, withDocument } = harness(
      { elements: [] },
      { type: 'slides' },
    );
    await expect(controller.elements(WS, DOC)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('opens the board’s own Yorkie document, read-only for a read', async () => {
    const { controller, withDocument } = harness({ elements: [] });
    await controller.elements(WS, DOC);
    expect(withDocument.mock.calls[0][2]).toEqual({
      docKeyPrefix: 'board-',
      syncMode: 'readonly',
    });
  });

  describe('board size caps', () => {
    const shape = (id: string, x: number, y: number): Element =>
      ({
        id,
        type: 'shape',
        frame: { x, y, w: 200, h: 200, rotation: 0 },
        data: { kind: 'rect' },
      }) as unknown as Element;

    it('refuses a board past the element cap with a 400, not a long walk', async () => {
      const elements = Array.from({ length: MAX_AGENT_ELEMENTS + 1 }, (_, i) =>
        shape(`e${i}`, i, 0),
      );
      const { controller } = harness({ elements });
      await expect(controller.elements(WS, DOC)).rejects.toThrow(
        new BadRequestException(
          `The board has ${MAX_AGENT_ELEMENTS + 1} top-level elements; board API ` +
            `requests process at most ${MAX_AGENT_ELEMENTS}.`,
        ),
      );
    });

    it('refuses stacked locked sections over many elements with a 400 and writes nothing', async () => {
      // A move has to know what every locked section freezes, which here is
      // every element 500 times over.
      const elements: Element[] = [];
      for (let s = 0; s < 500; s++) {
        elements.push(
          section(
            `s${s}`,
            {
              x: -s,
              y: -s,
              w: 60_000 + 2 * s,
              h: 60_000 + 2 * s,
            },
            { locked: true },
          ),
        );
      }
      for (let i = 0; i < 20_000; i++) {
        elements.push(
          shape(`e${i}`, (i % 200) * 250, Math.floor(i / 200) * 250),
        );
      }
      const root: Root = { elements };
      const { controller } = harness(root);
      await expect(controller.elements(WS, DOC)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        controller.moveElements(WS, DOC, [{ id: 'e0', x: 5, y: 5 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(byId(root, 'e0').frame.x).toBe(0);
    });
  });

  describe('GET elements', () => {
    it('summarizes kinds, text, colour, membership, stamps, ended votes and authors', async () => {
      const root: Root = {
        meta: { title: 'Retro' },
        elements: [
          section('s1', { x: 0, y: 0, w: 600, h: 400 }),
          sticky('a', 40, 40, 'Ship faster'),
          sticky('b', 1000, 0, 'Fewer meetings'),
        ],
        stamps: {
          'a~u1~1': {
            el: 'a',
            by: 'u1',
            name: 'x',
            kind: 'plus1',
            u: 0,
            v: 0,
            at: 0,
          },
          'a~u2~1': {
            el: 'a',
            by: 'u2',
            name: 'y',
            kind: 'plus1',
            u: 0,
            v: 0,
            at: 0,
          },
        },
        voting: { status: 'ended', ballots: { u1: ['a', 'a', 'b'] } },
      };
      const { controller } = harness(root);
      const { elements } = await controller.elements(WS, DOC);
      expect(elements.map((e) => e.kind)).toEqual([
        'section',
        'sticky',
        'sticky',
      ]);
      expect(elements[0]).toMatchObject({ title: 's1' });
      expect(elements[1]).toMatchObject({
        id: 'a',
        text: 'Ship faster',
        color: '#FFF8B8',
        section: 's1',
        stamps: { plus1: 2 },
        votes: 2,
        author: 'ann',
      });
      expect(elements[2].section).toBeUndefined();
      expect(elements[2].votes).toBe(1);
    });

    it('hides votes while the session is open and authors on an anonymous board', async () => {
      const root: Root = {
        meta: { title: 'Retro', anonymous: true },
        elements: [sticky('a', 0, 0)],
        voting: { status: 'active', ballots: { u1: ['a'] } },
      };
      const { controller } = harness(root);
      const { elements } = await controller.elements(WS, DOC);
      expect(elements[0].votes).toBeUndefined();
      expect(elements[0].author).toBeUndefined();
    });
  });

  describe('POST stickies', () => {
    it('builds stickies with the canvas factory, laid out in free space', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [sticky('a', 0, 0)],
      };
      const { controller, req } = harness(root, { username: 'agent' });
      const { ids } = await controller.addStickies(
        WS,
        DOC,
        { texts: ['one', 'two', 'three'], color: 'blue' },
        req,
      );
      expect(ids).toHaveLength(3);
      const made = ids.map((id) => byId(root, id));
      for (const el of made) {
        expect(isStickyData(dataOf(el))).toBe(true);
        expect((dataOf(el) as { role?: string }).role).toBe(STICKY_ROLE);
        expect((dataOf(el) as { fill: { value: string } }).fill.value).toBe(
          '#C7E5FF',
        );
        expect((dataOf(el) as { author?: string }).author).toBe('agent');
        expect(overlaps(el.frame, byId(root, 'a').frame)).toBe(false);
      }
      // Identical to what the toolbar makes, apart from id and position.
      const ui = buildStickyInit(
        '#C7E5FF',
        { x: 0, y: 0 },
        { text: 'one', author: 'agent' },
      );
      expect({ ...made[0], id: undefined, frame: undefined }).toEqual({
        ...ui,
        id: undefined,
        frame: undefined,
      });
    });

    it('looks up the author of an API-key caller and records none on an anonymous board', async () => {
      const root: Root = { meta: { title: 'B' }, elements: [] };
      const { controller, req, userService } = harness(root);
      const { ids } = await controller.addStickies(
        WS,
        DOC,
        { texts: ['x'] },
        req,
      );
      expect(userService.user).toHaveBeenCalledWith({ id: 7 });
      expect((dataOf(byId(root, ids[0])) as { author?: string }).author).toBe(
        'agent-owner',
      );

      const anon: Root = {
        meta: { title: 'B', anonymous: true },
        elements: [],
      };
      const h2 = harness(anon);
      const r2 = await h2.controller.addStickies(
        WS,
        DOC,
        { texts: ['x'] },
        h2.req,
      );
      expect(
        (dataOf(byId(anon, r2.ids[0])) as { author?: string }).author,
      ).toBeUndefined();
    });

    it('places explicit top-left positions and grids the rest', async () => {
      const root: Root = { meta: { title: 'B' }, elements: [] };
      const { controller, req } = harness(root);
      const { ids } = await controller.addStickies(
        WS,
        DOC,
        [{ text: 'here', x: 500, y: 600 }, { text: 'anywhere' }],
        req,
      );
      expect(byId(root, ids[0]).frame).toMatchObject({
        x: 500,
        y: 600,
        w: 180,
        h: 180,
      });
      expect(overlaps(byId(root, ids[1]).frame, byId(root, ids[0]).frame)).toBe(
        false,
      );
    });

    it('puts a batch beside the element `near` names', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [section('s', { x: 0, y: 0, w: 400, h: 400 })],
      };
      const { controller, req } = harness(root);
      const { ids } = await controller.addStickies(
        WS,
        DOC,
        { texts: ['a'], near: 's' },
        req,
      );
      expect(byId(root, ids[0]).frame.x).toBeGreaterThanOrEqual(400);
      await expect(
        controller.addStickies(WS, DOC, { texts: ['a'], near: 'nope' }, req),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s malformed bodies without opening Yorkie', async () => {
      const { controller, req, withDocument } = harness({ elements: [] });
      for (const body of [
        {},
        [],
        { texts: [1] },
        { texts: ['a'], color: 'chartreuse' },
        [{ text: 'a', x: 1 }],
        [{ text: 'a', x: Infinity, y: 0 }],
        { texts: ['a'], near: 5 },
      ]) {
        await expect(
          controller.addStickies(WS, DOC, body, req),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(withDocument).not.toHaveBeenCalled();
    });
  });

  describe('POST sections', () => {
    it('wraps elements where they are, behind them in the z-order', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [sticky('a', 0, 0), sticky('b', 300, 0)],
      };
      const { controller } = harness(root);
      const res = await controller.addSection(WS, DOC, {
        title: 'Speed',
        elementIds: ['a', 'b'],
        color: 'green',
      });
      expect(res.frame).toEqual({
        x: -SECTION_PADDING,
        y: -SECTION_PADDING,
        w: 480 + SECTION_PADDING * 2,
        h: 180 + SECTION_PADDING * 2,
        rotation: 0,
      });
      expect(els(root)[0].id).toBe(res.id);
      expect(sectionOf(els(root)[0])).toEqual({ title: 'Speed' });
      expect(res.members.sort()).toEqual(['a', 'b']);
      expect(res.moved).toEqual([]);
    });

    it('lays members out as a grid in free space and wraps the grid', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [
          sticky('a', 0, 0),
          sticky('b', 2000, 2000),
          sticky('c', -900, 50),
          sticky('x', 300, 0),
        ],
      };
      const { controller } = harness(root);
      const res = await controller.addSection(WS, DOC, {
        title: 'Theme',
        elementIds: ['a', 'b', 'c'],
        layout: 'grid',
      });
      expect(res.members.sort()).toEqual(['a', 'b', 'c']);
      expect(res.moved.sort()).toEqual(['a', 'b', 'c']);
      // A 2-column grid of 180px cells, padded.
      expect(res.frame.w).toBe(180 * 2 + 24 + SECTION_PADDING * 2);
      expect(overlaps(res.frame, byId(root, 'x').frame)).toBe(false);
      for (const id of ['a', 'b', 'c']) {
        const f = byId(root, id).frame;
        expect(f.x).toBeGreaterThanOrEqual(res.frame.x);
        expect(f.y).toBeGreaterThanOrEqual(res.frame.y);
      }
    });

    it('fills a given frame, or a default-size free spot', async () => {
      const root: Root = { meta: { title: 'B' }, elements: [] };
      const { controller } = harness(root);
      const a = await controller.addSection(WS, DOC, {
        title: 'A',
        frame: { x: 10, y: 20, w: 300, h: 200 },
      });
      expect(a.frame).toEqual({ x: 10, y: 20, w: 300, h: 200, rotation: 0 });
      const b = await controller.addSection(WS, DOC, { title: 'B' });
      expect(overlaps(a.frame, b.frame)).toBe(false);
    });

    it('404s an unknown member and 400s a bad body', async () => {
      const { controller } = harness({ elements: [sticky('a', 0, 0)] });
      await expect(
        controller.addSection(WS, DOC, { title: 'T', elementIds: ['a', 'zz'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      for (const body of [
        { title: '' },
        { title: 'T', color: 'teal' },
        { title: 'T', elementIds: ['a'], frame: { x: 0, y: 0, w: 1, h: 1 } },
        { title: 'T', layout: 'grid' },
        { title: 'T', elementIds: ['a', 'a'] },
      ]) {
        await expect(
          controller.addSection(WS, DOC, body),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('PATCH elements', () => {
    it('moves a section with its members and keeps glued connectors attached', async () => {
      const connector = {
        id: 'c',
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: 'a', siteIndex: 1 },
        end: { kind: 'free', x: 1000, y: 1000 },
        arrowheads: {},
        // Mostly outside the section, so it is not carried — only re-routed.
        frame: { x: 200, y: 200, w: 800, h: 800, rotation: 0 },
      } as unknown as Element;
      const root: Root = {
        meta: { title: 'B' },
        elements: [
          section('s', { x: 0, y: 0, w: 400, h: 400 }),
          sticky('a', 40, 40),
          connector,
        ],
      };
      const { controller } = harness(root);
      const res = await controller.moveElements(WS, DOC, [
        { id: 's', x: 100, y: 0 },
      ]);
      expect(res).toEqual({ moved: ['s'], carried: ['a'] });
      expect(byId(root, 's').frame.x).toBe(100);
      expect(byId(root, 'a').frame.x).toBe(140);
      // The connector's cached frame was recomputed from its new start.
      expect(byId(root, 'c').frame).not.toEqual({
        x: 200,
        y: 200,
        w: 800,
        h: 800,
        rotation: 0,
      });
      expect(byId(root, 'c').frame.x).toBeGreaterThan(100);
    });

    it('resizes without carrying, and accepts the { moves } envelope', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [
          section('s', { x: 0, y: 0, w: 400, h: 400 }),
          sticky('a', 40, 40),
        ],
      };
      const { controller } = harness(root);
      const res = await controller.moveElements(WS, DOC, {
        moves: [{ id: 's', x: 0, y: 0, w: 900, h: 500 }],
      });
      expect(res.carried).toEqual([]);
      expect(byId(root, 's').frame).toMatchObject({ w: 900, h: 500 });
    });

    it('is all-or-nothing: 404 unknown, 409 locked, 400 connector', async () => {
      const connector = {
        id: 'c',
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 0, y: 0 },
        end: { kind: 'free', x: 10, y: 10 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      } as unknown as Element;
      const root: Root = {
        meta: { title: 'B' },
        elements: [
          section('s', { x: 0, y: 0, w: 400, h: 400 }, { locked: true }),
          sticky('a', 40, 40),
          sticky('b', 900, 0),
          connector,
        ],
      };
      const { controller } = harness(root);
      await expect(
        controller.moveElements(WS, DOC, [
          { id: 'b', x: 1, y: 1 },
          { id: 'zz', x: 0, y: 0 },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.moveElements(WS, DOC, [{ id: 'a', x: 1, y: 1 }]),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        controller.moveElements(WS, DOC, [{ id: 'c', x: 1, y: 1 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(byId(root, 'b').frame.x).toBe(900);
    });

    it('lands a move as field writes, keeping every element and its data node', async () => {
      // A real CRDT, so "granular" is observable: an element replaced as a
      // whole would get a new node id, and a peer's concurrent edit to its
      // text (which lives under that node) would be lost with it.
      const doc = new YorkieDocument<Root>(`board-move-${Date.now()}`);
      doc.update((r) => {
        r.meta = { title: 'B' };
        r.elements = [
          section('s', { x: 0, y: 0, w: 400, h: 400 }),
          sticky('a', 40, 40),
          sticky('b', 900, 0),
        ] as never;
      });
      type Node = { id: string; getID(): { toIDString(): string } };
      const ids = () => {
        const out: Record<string, string> = {};
        const arr = doc.getRoot().elements as unknown as ArrayLike<
          Node & { data: Node & { text?: Node }; frame: Node }
        >;
        for (let i = 0; i < arr.length; i++) {
          const el = arr[i];
          out[el.id] = el.getID().toIDString();
          out[`${el.id}.data`] = el.data.getID().toIDString();
          if (el.data.text)
            out[`${el.id}.text`] = el.data.text.getID().toIDString();
          out[`${el.id}.frame`] = el.frame.getID().toIDString();
        }
        return out;
      };
      const before = ids();
      const { controller } = harness(doc as unknown as Root, { realDoc: doc });
      const res = await controller.moveElements(WS, DOC, [
        { id: 's', x: 100, y: 0 },
      ]);
      expect(res).toEqual({ moved: ['s'], carried: ['a'] });
      const after = ids();
      for (const key of Object.keys(before)) {
        if (key === 's.frame' || key === 'a.frame') {
          // The one thing written: a fresh frame object.
          expect(after[key]).not.toBe(before[key]);
        } else {
          expect(after[key]).toBe(before[key]);
        }
      }
      const a = (doc.getRoot().elements as unknown as Element[]).find(
        (el) => el.id === 'a',
      )!;
      expect(a.frame.x).toBe(140);
    });

    it('400s a malformed batch', async () => {
      const { controller } = harness({ elements: [] });
      for (const body of [
        {},
        [],
        [{ id: 'a' }],
        [{ id: 'a', x: 0, y: 0, w: -1 }],
      ]) {
        await expect(
          controller.moveElements(WS, DOC, body),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('POST text', () => {
    it('adds a grow text box beside a section, one paragraph per line', async () => {
      const root: Root = {
        meta: { title: 'B' },
        elements: [section('s', { x: 0, y: 0, w: 400, h: 400 })],
      };
      const { controller } = harness(root);
      const res = await controller.addText(WS, DOC, {
        text: 'Summary\nShip faster',
        near: 's',
        side: 'below',
      });
      const el = byId(root, res.id);
      expect(el.type).toBe('text');
      expect((dataOf(el) as { autofit: string }).autofit).toBe('grow');
      expect((dataOf(el) as { blocks: unknown[] }).blocks).toHaveLength(2);
      expect(res.frame.y).toBeGreaterThanOrEqual(400);
      expect(res.frame.x).toBe(0);
    });

    it('takes an explicit position and 400s a bad body', async () => {
      const root: Root = { meta: { title: 'B' }, elements: [] };
      const { controller } = harness(root);
      const res = await controller.addText(WS, DOC, {
        text: 'Hi',
        x: 5,
        y: 6,
        w: 300,
      });
      expect(res.frame).toMatchObject({ x: 5, y: 6, w: 300 });
      for (const body of [
        {},
        { text: '' },
        { text: 'a', side: 'up' },
        { text: 'a', fontSize: 1 },
        { text: 'a', x: 0, y: 0, near: 's' },
      ]) {
        await expect(controller.addText(WS, DOC, body)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });
  });
});
