import { VIEW_EVENT_TYPES } from './analytics.types';

describe('analytics.types', () => {
  it('declares the four view event types in order', () => {
    expect(VIEW_EVENT_TYPES).toEqual([
      'open',
      'heartbeat',
      'tabchange',
      'close',
    ]);
  });
});
