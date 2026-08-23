import { describe, expect, it } from 'vitest';
import type { Target } from '../index';
import { describeTarget } from './appearance';

describe('describeTarget', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };

  it('names a DOM target by its selector', () => {
    expect(
      describeTarget({ kind: 'dom', tag: 'button', testId: 'bold', selector: 'div > button', rect }),
    ).toBe('button · bold · div > button');
  });

  it('names a canvas target by its address, and says when there is none', () => {
    expect(describeTarget({ kind: 'canvas', surface: 'sheet', address: 'Sheet1!C7', rect })).toBe(
      'sheet · Sheet1!C7',
    );
    expect(describeTarget({ kind: 'canvas', surface: 'sheet', rect })).toBe('sheet · no address');
  });

  it('calls a viewport target a region, which is the reporter-facing word', () => {
    expect(describeTarget({ kind: 'viewport', rect })).toBe('region');
    expect(
      describeTarget({
        kind: 'viewport',
        rect,
        elements: [{ selector: 'form > button', tag: 'button', text: 'Sign in', rect }],
      }),
    ).toBe('region · 1 element(s)');
  });

  it('refuses to describe a kind it does not know', () => {
    // The viewport branch used to be the FALLBACK, so a kind added later would
    // have quietly described itself as a region.
    expect(describeTarget({ kind: 'hologram', rect } as unknown as Target)).toBe(
      'unknown target (hologram)',
    );
  });
});
