import { describe, expect, it } from 'vitest';
import { computePeerOverlays, type PeerView } from './peers';

/** No element frames resolve — isolates cursor behavior from ring behavior. */
const noFrames = () => undefined;

describe('computePeerOverlays cursors', () => {
  it('maps a peer cursor into a coloured, labelled cursor entry', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's1',
        cursor: { x: 120, y: 340 },
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([
      { x: 120, y: 340, color: '#ff0000', label: 'Ada' },
    ]);
  });

  it('yields no cursors when peers publish none (slides regression guard)', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's1',
        selectedElementIds: ['e1'],
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([]);
  });

  it('ignores a cursor from a peer on another slide', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's2',
        cursor: { x: 10, y: 10 },
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([]);
  });
});
