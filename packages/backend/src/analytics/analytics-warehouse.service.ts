import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';
import {
  DocumentAnalytics,
  MetricSeriesPoint,
  ShareLinkBreakdown,
  TargetBreakdown,
} from './analytics.types';

/** Parse Yorkie-style DSN `user:pass@tcp(host:port)/db` into a mysql2 config. */
function parseDSN(dsn: string): mysql.PoolOptions {
  const m = /^([^:]*):([^@]*)@tcp\(([^:]+):(\d+)\)\/(.+)$/.exec(dsn);
  if (!m) throw new Error(`invalid StarRocks DSN: ${dsn}`);
  return {
    user: m[1],
    password: m[2],
    host: m[3],
    port: Number(m[4]),
    database: m[5],
    connectionLimit: 4,
  };
}

/** StarRocks has no prepared statements — quote/escape values ourselves. */
function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const EMPTY: DocumentAnalytics = {
  enabled: false,
  totalViews: 0,
  uniqueVisitors: 0,
  returningVisitors: 0,
  avgDwellSeconds: 0,
  viewsByDay: [],
  byShareLink: [],
  byTarget: [],
};

@Injectable()
export class AnalyticsWarehouseService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsWarehouseService.name);
  private pool: mysql.Pool | null = null;

  constructor(private readonly config: ConfigService) {
    const dsn = this.config.get<string>('WAFFLEBASE_STARROCKS_DSN');
    if (dsn) {
      try {
        this.pool = mysql.createPool(parseDSN(dsn));
      } catch (err) {
        this.logger.error(
          `invalid StarRocks DSN, disabling warehouse: ${String(err)}`,
        );
        this.pool = null;
      }
    }
  }

  isEnabled(): boolean {
    return this.pool !== null;
  }

  /** Pure query builder — unit-tested without a live StarRocks. */
  buildQueries(documentId: string, from: Date, to: Date) {
    const id = sql(documentId);
    const lo = sql(day(from));
    // Exclusive upper bound: the day AFTER `to`, so events stamped on the
    // `to` day itself (e.g. "today" in the default window) are included.
    const hi = sql(day(new Date(to.getTime() + 86400000)));
    const where = `document_id = ${id} AND timestamp >= ${lo} AND timestamp < ${hi}`;
    return {
      totalViews: `SELECT COUNT(*) AS c FROM view_events WHERE ${where} AND event_type = 'open';`,
      uniqueVisitors: `SELECT COUNT(DISTINCT visitor_id) AS c FROM view_events WHERE ${where};`,
      returningVisitors: `SELECT COUNT(*) AS c FROM (SELECT visitor_id FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY visitor_id HAVING COUNT(DISTINCT session_id) > 1) t;`,
      dwell: `SELECT AVG(dwell) AS c FROM (SELECT session_id, TIMESTAMPDIFF(SECOND, MIN(timestamp), MAX(timestamp)) AS dwell FROM view_events WHERE ${where} GROUP BY session_id) t;`,
      viewsByDay: `SELECT DATE(timestamp) AS d, COUNT(*) AS c FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY d ORDER BY d ASC;`,
      byShareLink: `SELECT share_link_id AS k, COUNT(*) AS v, COUNT(DISTINCT visitor_id) AS u FROM view_events WHERE ${where} AND event_type = 'open' GROUP BY share_link_id ORDER BY v DESC;`,
      byTarget: `SELECT target AS k, COUNT(*) AS v FROM view_events WHERE ${where} AND event_type = 'tabchange' GROUP BY target ORDER BY v DESC LIMIT 50;`,
    };
  }

  async getDocumentAnalytics(
    documentId: string,
    from: Date,
    to: Date,
  ): Promise<DocumentAnalytics> {
    if (!this.pool) return EMPTY;
    const q = this.buildQueries(documentId, from, to);
    try {
      const [
        totalViews,
        uniqueVisitors,
        returningVisitors,
        dwell,
        viewsByDay,
        byShareLink,
        byTarget,
      ] = await Promise.all([
        this.count(q.totalViews),
        this.count(q.uniqueVisitors),
        this.count(q.returningVisitors),
        this.count(q.dwell),
        this.series(q.viewsByDay),
        this.shareLinkRows(q.byShareLink),
        this.targetRows(q.byTarget),
      ]);
      const avgDwellSeconds = Math.round(dwell);
      return {
        enabled: true,
        totalViews,
        uniqueVisitors,
        returningVisitors,
        avgDwellSeconds,
        viewsByDay,
        byShareLink,
        byTarget,
      };
    } catch (err) {
      this.logger.error(`warehouse query failed: ${String(err)}`);
      return { ...EMPTY, enabled: true };
    }
  }

  private async count(query: string): Promise<number> {
    const [rows] = await this.pool!.query(query);
    const r = (rows as Array<{ c: number | null }>)[0];
    return r && r.c != null ? Number(r.c) : 0;
  }
  private async series(query: string): Promise<MetricSeriesPoint[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ d: string; c: number }>).map((r) => ({
      date: String(r.d).slice(0, 10),
      value: Number(r.c),
    }));
  }
  private async shareLinkRows(query: string): Promise<ShareLinkBreakdown[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ k: string; v: number; u: number }>).map((r) => ({
      shareLinkId: r.k,
      views: Number(r.v),
      uniqueVisitors: Number(r.u),
    }));
  }
  private async targetRows(query: string): Promise<TargetBreakdown[]> {
    const [rows] = await this.pool!.query(query);
    return (rows as Array<{ k: string; v: number }>).map((r) => ({
      target: r.k,
      views: Number(r.v),
    }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
    }
  }
}
