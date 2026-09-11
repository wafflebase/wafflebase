import { describe, it, expect } from 'vitest';
import { MAX_FONT_SIZE, MAX_LINE_HEIGHT } from '@wafflebase/docs';
import { bandMasterNumerics } from '../../src/model/band-numerics';
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
