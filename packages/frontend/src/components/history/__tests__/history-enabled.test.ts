import { describe, expect, it } from 'vitest';
import { isHistoryEnabled } from '../history-enabled';

describe('isHistoryEnabled', () => {
  it('is off without the flag', () => {
    expect(isHistoryEnabled({}, 'member')).toBe(false);
  });

  it('is on for a member with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'member')).toBe(true);
  });

  it('is on for a share-link editor with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'editor')).toBe(true);
  });

  // Google Docs does not show version history to viewers, and until upstream
  // gates the RPCs, showing it would hand them a restore button.
  it('is off for a viewer even with the flag', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: 'true' }, 'viewer')).toBe(false);
  });

  it('treats any value other than "true" as off', () => {
    expect(isHistoryEnabled({ VITE_WB_REVISION_HISTORY: '1' }, 'member')).toBe(false);
  });
});
