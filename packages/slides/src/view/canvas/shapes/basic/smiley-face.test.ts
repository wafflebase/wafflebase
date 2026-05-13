import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildSmileyFace,
  SMILEY_FACE_ADJUSTMENTS,
  SMILEY_FACE_HANDLES,
} from './smiley-face';

describe('buildSmileyFace', () => {
  it('fills the outer face', () => {
    const path = buildSmileyFace({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Forehead area — clearly inside the face, away from eyes/mouth.
    expect(ctx.isPointInPath(path, 50, 15)).toBe(true);
  });

  it('default mouth curvature is the OOXML 4653', () => {
    expect(SMILEY_FACE_ADJUSTMENTS[0].defaultValue).toBe(4653);
  });
});

describe('SMILEY_FACE_HANDLES', () => {
  it('exposes one handle', () => {
    expect(SMILEY_FACE_HANDLES.length).toBe(1);
  });
});
