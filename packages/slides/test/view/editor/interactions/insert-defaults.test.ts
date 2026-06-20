import { describe, it, expect } from 'vitest';
import { buildInsertElement } from '../../../../src/view/editor/interactions/insert';
import { SLIDES_DEFAULT_TEXT_SIZE } from '../../../../src/view/editor/default-text';

describe('buildInsertElement text default', () => {
  it('seeds a user-inserted text box with grow autofit', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    expect(el.type).toBe('text');
    if (el.type === 'text') expect(el.data.autofit).toBe('grow');
  });

  it('seeds the text box at the slides default font size (18pt), not docs 11pt', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    if (el.type !== 'text') throw new Error('expected a text element');
    const inline = el.data.blocks[0]?.inlines[0];
    expect(inline?.style.fontSize).toBe(SLIDES_DEFAULT_TEXT_SIZE);
    expect(SLIDES_DEFAULT_TEXT_SIZE).toBe(18);
  });
});
