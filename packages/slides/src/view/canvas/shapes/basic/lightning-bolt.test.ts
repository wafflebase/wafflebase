import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildLightningBolt } from './lightning-bolt';

describe('buildLightningBolt', () => {
  it('produces a closed polygon', () => {
    const path = buildLightningBolt({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Upper-middle of the bolt should be filled.
    expect(ctx.isPointInPath(path, 55, 20)).toBe(true);
  });
});
