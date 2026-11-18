import { describe, expect, it } from 'vitest';
import type { ElementInit, ShapeElement } from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import type { YorkieElement } from '@/types/slides-document';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc } from './__testkit__';

type FreeformCommand = NonNullable<ShapeElement['data']['path']>['commands'][number];

function rawElements(doc: ReturnType<typeof makeYorkieBoardDoc>): string {
  return (doc.getRoot().elements as unknown as { toJSON(): string }).toJSON();
}

/**
 * Compact ink storage: a marker stroke's path is written as ONE packed
 * string, not one CRDT object per command, and read back as the plain
 * command array the renderer, export and slides code expect.
 */

/** A 200-point marker stroke as `buildFreeformInit` would make it. */
function strokeInit(points = 200): ElementInit {
  const commands: FreeformCommand[] = [{ c: 'M', x: 0, y: 0.5 }];
  for (let i = 1; i <= points; i++) {
    const t = i / points;
    commands.push({
      c: 'Q',
      x1: t,
      y1: 0.5 + Math.sin(i / 7) * 0.4,
      x: Math.min(1, t + 0.5 / points),
      y: 0.5 + Math.sin((i + 0.5) / 7) * 0.4,
    });
  }
  return {
    type: 'shape',
    frame: { x: 10, y: 20, w: 600, h: 300, rotation: 0 },
    data: {
      kind: 'freeform',
      path: { commands },
      stroke: { color: { kind: 'srgb', value: '#1E1E1E' }, width: 4, cap: 'round' },
    },
  };
}

function docSize(doc: ReturnType<typeof makeYorkieBoardDoc>): number {
  const size = doc.getDocSize().live;
  return size.data + size.meta;
}

function commandsOf(store: YorkieBoardStore, id: string): FreeformCommand[] {
  const el = store.read().slides[0].elements.find((e) => e.id === id) as ShapeElement;
  return el.data.path!.commands;
}

describe('YorkieBoardStore compact ink', () => {
  it('stores a 200-point stroke as one string, at a fraction of the CRDT size', () => {
    const init = strokeInit();

    // Before: the array form, written as the store used to.
    const before = makeYorkieBoardDoc();
    const empty = docSize(before);
    before.update((r) => {
      (r.elements as unknown as YorkieElement[]).push({
        ...JSON.parse(JSON.stringify(init)),
        id: 'old',
      } as YorkieElement);
    });
    const arrayBytes = docSize(before) - empty;

    // After: through the store.
    const after = makeYorkieBoardDoc();
    const store = new YorkieBoardStore(after);
    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, init);
    });
    const packedBytes = docSize(after) - empty;

    const raw = JSON.parse(rawElements(after)) as {
      data: { path: { commands: unknown } };
    }[];
    expect(typeof raw[0].data.path.commands).toBe('string');
    // Measured (yorkie getDocSize, data + meta): 60,750 bytes as an
    // array, 6,410 packed — the packed figure is mostly the string's
    // UTF-16 bytes plus the element's frame and stroke.
    expect(arrayBytes).toBeGreaterThan(50_000);
    expect(packedBytes).toBeLessThan(arrayBytes / 8);
    expect(packedBytes).toBeLessThan(8 * 1024);
  });

  it('reads the packed stroke back as the command array, within a quantum', () => {
    const init = strokeInit(50);
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let id = '';
    store.batch(() => {
      id = store.addElement(SYNTHETIC_SLIDE_ID, init);
    });
    const want = (init as { data: { path: { commands: FreeformCommand[] } } }).data.path.commands;
    const got = commandsOf(store, id);
    expect(got).toHaveLength(want.length);
    got.forEach((cmd, i) => {
      expect(cmd.c).toBe(want[i].c);
      if (cmd.c === 'Q' && want[i].c === 'Q') {
        expect(cmd.x1).toBeCloseTo((want[i] as { x1: number }).x1, 4);
        expect(cmd.y).toBeCloseTo((want[i] as { y: number }).y, 4);
      }
    });
  });

  it('still reads an old board whose stroke is a command array', () => {
    const doc = makeYorkieBoardDoc();
    const init = strokeInit(10);
    doc.update((r) => {
      (r.elements as unknown as YorkieElement[]).push({
        ...JSON.parse(JSON.stringify(init)),
        id: 'legacy',
      } as YorkieElement);
    });
    const store = new YorkieBoardStore(doc);
    expect(commandsOf(store, 'legacy')).toEqual(
      (init as { data: { path: { commands: FreeformCommand[] } } }).data.path.commands,
    );
  });

  it('packs a stroke inside a pasted group and a path written by updateElementData', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    const stroke = strokeInit(5);
    let groupId = '';
    let shapeId = '';
    store.batch(() => {
      groupId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'group',
        frame: { x: 0, y: 0, w: 600, h: 300, rotation: 0 },
        data: { children: [{ ...stroke, id: 'child' } as never] },
      });
      shapeId = store.addElement(SYNTHETIC_SLIDE_ID, strokeInit(5));
      store.updateElementData(SYNTHETIC_SLIDE_ID, shapeId, {
        path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }] },
      });
    });
    const raw = JSON.parse(rawElements(store['doc'])) as {
      id: string;
      data: { children?: { data: { path: { commands: unknown } } }[]; path?: { commands: unknown } };
    }[];
    const group = raw.find((e) => e.id === groupId)!;
    expect(typeof group.data.children![0].data.path.commands).toBe('string');
    expect(typeof raw.find((e) => e.id === shapeId)!.data.path!.commands).toBe('string');
    expect(commandsOf(store, shapeId)).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 1, y: 1 },
    ]);
    const readGroup = store.read().slides[0].elements.find((e) => e.id === groupId) as {
      data: { children: ShapeElement[] };
    };
    expect(Array.isArray(readGroup.data.children[0].data.path!.commands)).toBe(true);
  });

  it('one stroke is still one undo unit', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, strokeInit(20));
    });
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(0);
    store.redo();
    expect(commandsOf(store, store.read().slides[0].elements[0].id)).toHaveLength(21);
  });
});
