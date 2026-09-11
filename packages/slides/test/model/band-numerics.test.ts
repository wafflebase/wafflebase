import { describe, it, expect } from 'vitest';
import {
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_TABLE_COLUMNS,
} from '@wafflebase/docs';
import {
  bandElementNumerics,
  bandMasterNumerics,
  bandPlaceholderStyleNumerics,
} from '../../src/model/band-numerics';
import { DEFAULT_MASTER, type Master } from '../../src/model/master';
import { seedPlaceholderBlocks } from '../../src/model/placeholder-blocks';
import { defaultLight } from '../../src/themes/default-light';

/**
 * A `Master` a hostile peer wrote: the stored JSON shape, so the band is
 * exercised through the same door `YorkieSlidesStore.read()` uses.
 */
function poisonedMaster(): Master {
  return {
    ...DEFAULT_MASTER,
    placeholderStyles: {
      title: { ...DEFAULT_MASTER.placeholderStyles.title, fontSize: 1e9 },
      body: {
        ...DEFAULT_MASTER.placeholderStyles.body,
        fontSize: 1e9,
        lineHeight: 1e9,
      },
      // A master's `placeholderStyles` is an open map, so the band has to
      // walk whatever keys are there rather than the two named ones.
      'big-number': {
        ...DEFAULT_MASTER.placeholderStyles['big-number'],
        lineHeight: 1e9,
      },
    },
  };
}

describe('bandMasterNumerics', () => {
  it('clamps every placeholder style a peer poisoned', () => {
    const master = bandMasterNumerics(poisonedMaster());
    expect(master.placeholderStyles.title.fontSize).toBe(MAX_FONT_SIZE);
    expect(master.placeholderStyles.body.fontSize).toBe(MAX_FONT_SIZE);
    expect(master.placeholderStyles.body.lineHeight).toBe(MAX_LINE_HEIGHT);
    expect(master.placeholderStyles['big-number'].lineHeight).toBe(
      MAX_LINE_HEIGHT,
    );
  });

  it('leaves a legitimate master untouched', () => {
    expect(bandMasterNumerics(structuredClone(DEFAULT_MASTER))).toEqual(
      DEFAULT_MASTER,
    );
  });

  it('substitutes the default for a size or spacing it cannot use', () => {
    // `PlaceholderStyle.fontSize` / `lineHeight` are required numbers that
    // are multiplied straight into a canvas font, so a dropped value has to
    // become a usable one rather than `undefined` (which paints `NaNpx`).
    const banded = bandMasterNumerics({
      ...DEFAULT_MASTER,
      placeholderStyles: {
        title: { ...DEFAULT_MASTER.placeholderStyles.title, fontSize: 0 },
        body: {
          ...DEFAULT_MASTER.placeholderStyles.body,
          lineHeight: Number.NaN,
        },
      },
    });
    expect(banded.placeholderStyles.title.fontSize).toBe(
      DEFAULT_MASTER.placeholderStyles.title.fontSize,
    );
    expect(banded.placeholderStyles.body.lineHeight).toBe(
      DEFAULT_MASTER.placeholderStyles.body.lineHeight,
    );
  });

  it('keeps a poisoned size out of the Block it seeds', () => {
    // This is the sink: `seedPlaceholderBlocks` copies `fontSize` and
    // `lineHeight` verbatim into a docs `Block`, which reaches the same
    // `computeLayout` the block bands protect.
    const style = bandMasterNumerics(poisonedMaster()).placeholderStyles.body;
    const [block] = seedPlaceholderBlocks(style, defaultLight);
    expect(block.inlines[0].style.fontSize).toBe(MAX_FONT_SIZE);
    expect(block.style.lineHeight).toBe(MAX_LINE_HEIGHT);
  });

  it('survives a master whose placeholderStyles is not an object', () => {
    const junk = { id: 'm', themeId: 't', placeholderStyles: 7 };
    expect(bandMasterNumerics(junk)).toBe(junk);
  });
});

describe('bandPlaceholderStyleNumerics', () => {
  it('bands the single style cascadeMasterStyles seeds from', () => {
    // `YorkieSlidesStore.cascadeMasterStyles` pulls one style out of the
    // live CRDT by placeholder type and hands it straight to
    // `seedPlaceholderBlocks`, which *commits* these numbers into real
    // blocks — so the band has to reach a lone style, not just a master.
    const style = bandPlaceholderStyleNumerics(
      { ...DEFAULT_MASTER.placeholderStyles.body, fontSize: 1e9 },
      'body',
    );
    expect(style.fontSize).toBe(MAX_FONT_SIZE);
  });

  it('falls back to the body default for a prototype key', () => {
    // `type` comes out of the CRDT: a bare index would read
    // `Object.prototype.constructor` and defeat the band for that slot.
    const style = bandPlaceholderStyleNumerics(
      { fontSize: Number.NaN, lineHeight: Number.NaN },
      'constructor',
    );
    expect(style.fontSize).toBe(DEFAULT_MASTER.placeholderStyles.body.fontSize);
    expect(style.lineHeight).toBe(
      DEFAULT_MASTER.placeholderStyles.body.lineHeight,
    );
  });
});

describe('bandElementNumerics table columns', () => {
  it('caps columnWidths on count and repairs each width', () => {
    // The length is `computeTableLayout`'s `nCols`, which allocates and
    // loops a cell per (row, column) pair; `colX` is a running sum, so an
    // unusable entry becomes 0 rather than being dropped.
    const el = bandElementNumerics({
      id: 'e1',
      type: 'table',
      frame: { x: 0, y: 0, w: 100, h: 100 },
      data: {
        columnWidths: [
          100,
          Number.POSITIVE_INFINITY,
          -5,
          'wide',
          ...new Array(400).fill(1),
        ],
        rows: [],
      },
    }) as { data: { columnWidths: number[] } };
    expect(el.data.columnWidths).toHaveLength(MAX_TABLE_COLUMNS);
    expect(el.data.columnWidths.slice(0, 4)).toEqual([100, 0, 0, 0]);
  });
});
