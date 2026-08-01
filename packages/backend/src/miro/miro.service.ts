import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ImageService } from '../image/image.service';
import { parseMiroBoardId } from './parse-board-id';
import type {
  MiroConnector,
  MiroImportNote,
  MiroImportResult,
  MiroItem,
} from './miro.types';

const MIRO_API = 'https://api.miro.com/v2';
/** Miro caps `limit` at 50 for the items endpoint. */
const PAGE_LIMIT = 50;

interface MiroPage<T> {
  data?: T[];
  cursor?: string;
}

/**
 * Thin authenticated proxy to the Miro REST API.
 *
 * The caller's access token is passed in per request, used for the outbound
 * calls, and then dropped — it is never persisted, never logged, and never
 * placed in the response (mirroring how `DataSourceService` decrypts a secret
 * only at the point of the outbound call).
 */
@Injectable()
export class MiroService {
  /**
   * Hard ceiling on imported items. A board larger than this is truncated and
   * the truncation is reported — bounded memory beats a silent partial import.
   */
  static readonly MAX_ITEMS = 5000;

  constructor(private readonly imageService: ImageService) {}

  async importBoard(
    token: string,
    boardUrl: string,
    workspaceId: string,
  ): Promise<MiroImportResult> {
    const boardId = parseMiroBoardId(boardUrl);
    const notes: MiroImportNote[] = [];

    const items = await this.fetchPaged<MiroItem>(
      `${MIRO_API}/boards/${encodeURIComponent(boardId)}/items`,
      token,
      notes,
      'items',
    );
    const connectors = await this.fetchPaged<MiroConnector>(
      `${MIRO_API}/boards/${encodeURIComponent(boardId)}/connectors`,
      token,
      notes,
      'connectors',
    );

    const rehosted = await this.rehostImages(items, token, workspaceId, notes);
    return { items: rehosted, connectors, notes };
  }

  /** Mime types `ImageService.upload` accepts. */
  private static readonly IMAGE_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ]);

  /**
   * Miro's `data.imageUrl` needs the bearer token and expires in ~60s, so it
   * is useless in a persisted document. Download each image now and re-upload
   * it to the workspace's image bucket, rewriting the URL to a stable one.
   *
   * A failure drops just that image (with a note) — one broken asset must not
   * fail the whole import.
   */
  private async rehostImages(
    items: MiroItem[],
    token: string,
    workspaceId: string,
    notes: MiroImportNote[],
  ): Promise<MiroItem[]> {
    let failed = 0;
    const out: MiroItem[] = [];

    for (const item of items) {
      if (item.type !== 'image') {
        out.push(item);
        continue;
      }
      const src = (item.data as { imageUrl?: string } | undefined)?.imageUrl;
      if (!src) {
        failed++;
        continue;
      }
      try {
        const url = new URL(src);
        url.searchParams.set('format', 'original');
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const mime = res.headers?.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (!MiroService.IMAGE_MIME.has(mime)) throw new Error(`unsupported mime ${mime}`);

        const buffer = Buffer.from(await res.arrayBuffer());
        const uploaded = await this.imageService.upload(
          buffer,
          mime,
          `miro-${item.id}`,
          workspaceId,
        );
        out.push({
          ...item,
          data: {
            ...(item.data ?? {}),
            imageUrl: `/api/v1/workspaces/${workspaceId}/images/${uploaded.id}`,
          },
        });
      } catch {
        // Deliberately swallowed: the note is the user-visible signal, and the
        // error could otherwise carry request context we don't want logged.
        failed++;
      }
    }

    if (failed > 0) {
      notes.push({ reason: 'image-failed', itemType: 'image', count: failed });
    }
    return out;
  }

  /**
   * Follow Miro's cursor pagination until exhausted or the item ceiling is
   * reached. On truncation a note is pushed rather than failing — a partial
   * import the user knows about is better than none. `label` names the feed
   * ('items' / 'connectors') so a note says WHICH one was cut.
   */
  private async fetchPaged<T>(
    baseUrl: string,
    token: string,
    notes: MiroImportNote[],
    label: string,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;

    for (;;) {
      const url = new URL(baseUrl);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('cursor', cursor);

      const page = await this.getJson<MiroPage<T>>(url.toString(), token);
      const batch = page.data ?? [];
      out.push(...batch);

      if (out.length >= MiroService.MAX_ITEMS) {
        out.length = MiroService.MAX_ITEMS;
        notes.push({
          reason: 'truncated',
          itemType: label,
          count: MiroService.MAX_ITEMS,
        });
        return out;
      }
      if (!page.cursor) return out;

      // DO NOT REMOVE: this is what makes the loop provably terminate.
      //
      // The item ceiling above bounds the item COUNT, not the ITERATION count.
      // A page that returns zero items while still advertising a cursor (stuck
      // cursor, transient upstream bug) leaves `out.length` frozen, so the
      // ceiling never trips and we would fetch that same cursor forever,
      // hanging the request until an external timeout.
      //
      // Requiring forward progress closes that hole exactly: every iteration
      // that continues appends at least one item, and `out.length` is capped
      // at MAX_ITEMS, so the loop runs at most MAX_ITEMS + 1 times. Stopping
      // here may yield a short read, so it is reported like any other
      // degradation instead of silently looking like a complete import.
      if (batch.length === 0) {
        notes.push({ reason: 'stalled', itemType: label, count: out.length });
        return out;
      }
      cursor = page.cursor;
    }
  }

  /**
   * One authenticated GET. Miro's status codes are translated into Nest
   * exceptions with messages that describe the problem WITHOUT echoing the
   * token.
   */
  private async getJson<T>(url: string, token: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch {
      throw new InternalServerErrorException('Could not reach the Miro API');
    }

    if (res.status === 401) {
      throw new UnauthorizedException('The Miro token was rejected (invalid or expired)');
    }
    if (res.status === 403) {
      throw new ForbiddenException('The Miro token lacks access to this board (needs boards:read)');
    }
    if (res.status === 404) {
      throw new NotFoundException('Miro board not found, or the token has no access to it');
    }
    if (res.status === 429) {
      throw new InternalServerErrorException('Miro rate limit reached — try again in a minute');
    }
    if (!res.ok) {
      throw new InternalServerErrorException(`Miro API error (HTTP ${res.status})`);
    }

    return (await res.json()) as T;
  }
}
