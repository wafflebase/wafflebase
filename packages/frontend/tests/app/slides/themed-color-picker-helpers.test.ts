import { describe, it, expect } from 'vitest';
import { readShapeGradient } from '@/app/slides/themed-color-picker-helpers';

describe('readShapeGradient', () => {
  it('returns the gradient for a gradient-filled shape', () => {
    const gradient = {
      kind: 'gradient' as const,
      type: 'linear' as const,
      angle: 0,
      stops: [
        { pos: 0, color: { kind: 'srgb' as const, value: '#000' } },
        { pos: 1, color: { kind: 'srgb' as const, value: '#fff' } },
      ],
    };
    const el = {
      type: 'shape',
      id: 'test-shape',
      data: { fill: gradient },
    };
    // Type assertion cast needed for test — data types are complex unions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(readShapeGradient(el as any)?.stops).toHaveLength(2);
  });
  it('returns undefined for a solid-filled shape', () => {
    const el = {
      type: 'shape',
      id: 'test-shape',
      data: { fill: { kind: 'srgb', value: '#f00' } },
    };
    // Type assertion cast needed for test — data types are complex unions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(readShapeGradient(el as any)).toBeUndefined();
  });
  it('returns undefined for a non-shape', () => {
    const el = { type: 'image', id: 'test-image', data: {} };
    // Type assertion cast needed for test — data types are complex unions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(readShapeGradient(el as any)).toBeUndefined();
  });
});
