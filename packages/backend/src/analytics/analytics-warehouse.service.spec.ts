import { ConfigService } from '@nestjs/config';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';

function make(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new AnalyticsWarehouseService(config);
}

describe('AnalyticsWarehouseService', () => {
  it('is disabled when DSN is unset and returns disabled payload', async () => {
    const svc = make({});
    expect(svc.isEnabled()).toBe(false);
    const res = await svc.getDocumentAnalytics(
      'doc-1',
      new Date('2026-07-01'),
      new Date('2026-07-17'),
    );
    expect(res.enabled).toBe(false);
    expect(res.totalViews).toBe(0);
  });

  it('does not throw on a malformed DSN and degrades to disabled', async () => {
    let svc: AnalyticsWarehouseService | undefined;
    expect(() => {
      svc = make({ WAFFLEBASE_STARROCKS_DSN: 'not-a-valid-dsn' });
    }).not.toThrow();
    expect(svc!.isEnabled()).toBe(false);
    const res = await svc!.getDocumentAnalytics(
      'doc-1',
      new Date('2026-07-01'),
      new Date('2026-07-17'),
    );
    expect(res.enabled).toBe(false);
    expect(res.totalViews).toBe(0);
  });

  it('interpolates the document id and date range, scoped to open events for views', () => {
    const svc = make({
      WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase',
    });
    const q = svc.buildQueries(
      'doc-1',
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
    );
    expect(q.totalViews).toContain("document_id = 'doc-1'");
    expect(q.totalViews).toContain("timestamp >= '2026-07-01'");
    // Upper bound is the day AFTER `to` (2026-07-17), so events stamped on
    // the `to` day itself are included (inclusive `to` day).
    expect(q.totalViews).toContain("timestamp < '2026-07-18'");
    expect(q.totalViews).toContain("event_type = 'open'");
    expect(q.dwell).toContain('session_id');
  });

  it('escapes single quotes in the document id to prevent injection', () => {
    const svc = make({
      WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase',
    });
    const q = svc.buildQueries(
      "d'1",
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
    );
    expect(q.totalViews).toContain("document_id = 'd''1'");
  });

  it('builds a workspace roll-up with an escaped document_id IN list', () => {
    const svc = make({
      WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase',
    });
    const q = svc.buildWorkspaceQueries(
      ['d1', "d'2"],
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-17T00:00:00Z'),
    );
    expect(q.totalViews).toContain("document_id IN ('d1', 'd''2')");
    expect(q.totalViews).toContain("timestamp < '2026-07-18'");
    expect(q.byDocument).toContain('GROUP BY document_id');
  });

  it('returns disabled workspace payload when DSN unset or no documents', async () => {
    const off = make({});
    const a = await off.getWorkspaceAnalytics(
      ['d1'],
      new Date('2026-07-01'),
      new Date('2026-07-17'),
    );
    expect(a.enabled).toBe(false);
    expect(a.byDocument).toEqual([]);

    const on = make({
      WAFFLEBASE_STARROCKS_DSN: 'root:@tcp(localhost:9030)/wafflebase',
    });
    // No documents in the workspace -> no query, disabled payload.
    const b = await on.getWorkspaceAnalytics(
      [],
      new Date('2026-07-01'),
      new Date('2026-07-17'),
    );
    expect(b.enabled).toBe(false);
    expect(b.totalViews).toBe(0);
  });
});
