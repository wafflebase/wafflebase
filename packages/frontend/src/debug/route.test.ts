import { describe, expect, it } from 'vitest';
import { anonymiseRoute } from './route';

describe('anonymiseRoute', () => {
  it('replaces document ids in every editor route', () => {
    const id = '2f4c1e6a-7b90-4d3e-8a5f-1c2b3d4e5f60';
    for (const prefix of ['d', 'p', 's', 'b', 'n', 'f']) {
      expect(anonymiseRoute(`/${prefix}/${id}`)).toBe(`/${prefix}/:id`);
    }
  });

  it('replaces workspace, share, analytics and invite identifiers', () => {
    expect(anonymiseRoute('/w/ws-123/analytics')).toBe('/w/:workspaceId/analytics');
    expect(anonymiseRoute('/shared/abcdef123456')).toBe('/shared/:token');
    // The REAL route is `/w/:workspaceId/analytics/:id` (`App.tsx`): an
    // anchored rule never matched it, because the workspace rule had already
    // moved `analytics` off position 0, so the raw uuid travelled.
    expect(
      anonymiseRoute('/w/abc/analytics/2f4c1e6a-7b90-4d3e-8a5f-1c2b3d4e5f60'),
    ).toBe('/w/:workspaceId/analytics/:id');
    expect(anonymiseRoute('/invite/tok-1')).toBe('/invite/:token');
  });

  it('leaves the workspace analytics LIST route alone', () => {
    // `/w/:wid/analytics` has no document id to hide, and must not gain one.
    expect(anonymiseRoute('/w/abc/analytics')).toBe('/w/:workspaceId/analytics');
  });

  it('keeps a route with nothing to hide', () => {
    expect(anonymiseRoute('/documents')).toBe('/documents');
    expect(anonymiseRoute('/login')).toBe('/login');
  });

  it('keeps query keys and load-bearing values, and hides opaque ids', () => {
    // `?surface=` selects the harness surface and a report is meaningless
    // without it; a hex id is exactly what should not travel.
    expect(anonymiseRoute('/harness/hunt', '?surface=sheet')).toBe(
      '/harness/hunt?surface=sheet',
    );
    expect(anonymiseRoute('/s/abc', '?tab=0f1e2d3c4b5a69788796a5b4c3d2e1f0')).toBe(
      '/s/:id?tab=:id',
    );
  });
});
