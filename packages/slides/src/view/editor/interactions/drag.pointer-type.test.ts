import { describe, it, expect } from 'vitest';
import {
  allowsSlowDoubleClick,
  dragThresholdFor,
  pointerTypeOf,
  DRAG_THRESHOLD_PX,
  TOUCH_DRAG_THRESHOLD_PX,
} from './drag';

describe('dragThresholdFor', () => {
  it('keeps the precise threshold for a mouse', () => {
    expect(dragThresholdFor('mouse')).toBe(DRAG_THRESHOLD_PX);
  });

  it('keeps the precise threshold for a stylus', () => {
    // A pen resolves as finely as a mouse; widening its threshold would
    // only add lag to a device that does not need the slack.
    expect(dragThresholdFor('pen')).toBe(DRAG_THRESHOLD_PX);
  });

  it('widens the threshold for a fingertip', () => {
    expect(dragThresholdFor('touch')).toBe(TOUCH_DRAG_THRESHOLD_PX);
    expect(TOUCH_DRAG_THRESHOLD_PX).toBeGreaterThan(DRAG_THRESHOLD_PX);
  });

  it('falls back to the precise threshold when the device is unknown', () => {
    // Synthetic MouseEvents (the editor dispatches some itself) and test
    // doubles carry no `pointerType`; they must behave as they did
    // before this rule existed.
    expect(dragThresholdFor(undefined)).toBe(DRAG_THRESHOLD_PX);
  });
});

describe('allowsSlowDoubleClick', () => {
  it('is available to a mouse and a stylus', () => {
    expect(allowsSlowDoubleClick('mouse')).toBe(true);
    expect(allowsSlowDoubleClick('pen')).toBe(true);
    expect(allowsSlowDoubleClick(undefined)).toBe(true);
  });

  it('is withheld from touch', () => {
    // Its 3px / 350ms window sits inside a fingertip's own jitter, so on
    // touch it fires on taps the user meant as a single tap. Double-tap
    // (`dblclick`) remains the touch route into text editing.
    expect(allowsSlowDoubleClick('touch')).toBe(false);
  });
});

describe('pointerTypeOf', () => {
  it('reads the device off a pointer event', () => {
    const ev = { pointerType: 'touch' } as unknown as MouseEvent;
    expect(pointerTypeOf(ev)).toBe('touch');
  });

  it('is undefined for an event without one', () => {
    const ev = {} as MouseEvent;
    expect(pointerTypeOf(ev)).toBeUndefined();
  });
});
