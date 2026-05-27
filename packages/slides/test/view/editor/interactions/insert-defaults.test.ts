import { describe, it, expect } from 'vitest';
import { buildInsertElement } from '../../../../src/view/editor/interactions/insert';

describe('buildInsertElement text default', () => {
  it('seeds a user-inserted text box with grow autofit', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    expect(el.type).toBe('text');
    if (el.type === 'text') expect(el.data.autofit).toBe('grow');
  });
});
