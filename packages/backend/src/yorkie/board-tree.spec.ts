import {
  BoardYorkieRoot,
  initialBoardRoot,
  readBoardRoot,
  writeBoardRoot,
} from './board-tree';

const ELEMENT = {
  id: 'e1',
  type: 'shape',
  frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
  data: { kind: 'rect' },
} as never;

describe('readBoardRoot', () => {
  it('reads a board root as plain JSON', () => {
    const root: BoardYorkieRoot = {
      meta: { title: 'Retro', unit: 'cm', recentColors: ['#fff'] },
      elements: [ELEMENT],
    };
    expect(readBoardRoot(root)).toEqual({
      meta: { title: 'Retro', unit: 'cm', recentColors: ['#fff'] },
      elements: [ELEMENT],
    });
  });

  it('defaults an uninitialised root rather than returning undefined fields', () => {
    expect(readBoardRoot({})).toEqual({
      meta: { title: 'Untitled board' },
      elements: [],
    });
  });

  it('unwraps a Yorkie proxy through its own toJSON', () => {
    // A Yorkie value serialises via a `toJSON()` that returns a JSON *string*,
    // so a spread would double-encode it.
    const proxied = {
      toJSON: () => JSON.stringify([ELEMENT]),
    } as unknown as BoardYorkieRoot['elements'];
    expect(readBoardRoot({ elements: proxied }).elements).toEqual([ELEMENT]);
  });
});

describe('writeBoardRoot', () => {
  it('replaces meta and elements', () => {
    const root: BoardYorkieRoot = initialBoardRoot();
    writeBoardRoot(root, {
      meta: { title: 'Roadmap' },
      elements: [ELEMENT],
    });
    expect(root.meta).toEqual({ title: 'Roadmap' });
    expect(root.elements).toEqual([ELEMENT]);
  });

  it('does not leave a stale optional meta field behind', () => {
    const root: BoardYorkieRoot = {
      meta: { title: 'Roadmap', unit: 'cm' },
      elements: [],
    };
    writeBoardRoot(root, { meta: { title: 'Roadmap' }, elements: [] });
    expect(root.meta).toEqual({ title: 'Roadmap' });
  });
});

describe('initialBoardRoot', () => {
  it('matches the shape the editor seeds a new board with', () => {
    expect(initialBoardRoot()).toEqual({
      meta: { title: 'Untitled board' },
      elements: [],
    });
  });
});
