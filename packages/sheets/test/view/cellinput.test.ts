// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { CellInput } from '../../src/view/cellinput';

describe('CellInput primed placement', () => {
  it('keeps pointer events disabled while primed after placement updates', () => {
    const input = new CellInput();

    input.prime(10, 20, 100, 24, 300, 120);
    expect(input.getContainer().style.pointerEvents).toBe('none');

    input.updatePlacement(15, 25, 120, 30, 320, 140);
    expect(input.getContainer().style.pointerEvents).toBe('none');

    input.cleanup();
  });

  it('keeps pointer events enabled in normal editing mode after placement updates', () => {
    const input = new CellInput();

    input.show(10, 20, 'abc', false, 100, 24, 300, 120);
    expect(input.getContainer().style.pointerEvents).toBe('auto');

    input.updatePlacement(15, 25, 120, 30, 320, 140);
    expect(input.getContainer().style.pointerEvents).toBe('auto');

    input.cleanup();
  });
});
