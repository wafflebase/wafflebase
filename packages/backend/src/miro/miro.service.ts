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

/**
 * Hosts we are willing to download image bytes from.
 *
 * `data.imageUrl` is the ONE value in this flow the backend does not choose —
 * it arrives inside upstream board JSON. Without this gate, whoever can seed a
 * board (a shared board, a public one the user imports) picks a URL that the
 * backend then fetches *from inside the deployment network* — cloud metadata
 * (169.254.169.254), cluster-internal services, localhost admin ports — and
 * fetches it with the caller's live Miro credential attached, handing that
 * credential to whoever answers.
 *
 * `EXACT` is matched verbatim; `SUFFIXES` carry a leading dot so they match
 * real subdomains only (`cdn.miro.com` yes, `evilmiro.com` and
 * `miro.com.evil.net` no). Miro serves image binaries from api.miro.com and
 * from CDN hosts under miro.com, so the apex suffix covers both today and
 * new CDN names later.
 *
 * Scope note: this gates the URL we request, not the redirect chain behind it
 * — api.miro.com legitimately 307s to signed CDN URLs, so redirects are still
 * followed. That is deliberate; the credential is safe either way because the
 * fetch spec drops `Authorization` across a cross-origin redirect, and the
 * hop can only be chosen by a genuine Miro host.
 */
const IMAGE_HOST_ALLOWLIST: {
  EXACT: readonly string[];
  SUFFIXES: readonly string[];
} = {
  EXACT: ['miro.com', 'api.miro.com'],
  SUFFIXES: ['.miro.com'],
};

/**
 * Ceiling on a single downloaded image, in bytes.
 *
 * Source of truth is `image.maxFileSizeBytes` in `src/image/image.config.ts`
 * (10 MB); it lives behind `ConfigService` inside `ImageService`, so it is
 * mirrored here rather than imported. Keep the two in step. Checking here as
 * well as in `ImageService.upload` is not redundant: upload only sees a Buffer
 * that has already been fully materialised, so a hostile/oversized response
 * would blow up memory before its check ever runs.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
        // Refuse BEFORE building any request, so there is no code path on
        // which the bearer header exists alongside a non-allowlisted host.
        if (
          url.protocol !== 'https:' ||
          !MiroService.isAllowedImageHost(url.hostname)
        ) {
          throw new Error('image host not allowed');
        }
        url.searchParams.set('format', 'original');

        const controller = new AbortController();
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Lower-cased: HTTP header VALUES are case-sensitive to `Set.has`, but
        // servers legitimately send `Image/PNG`, and dropping a valid image
        // over letter case is a silent data loss.
        const mime =
          res.headers
            ?.get('content-type')
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() ?? '';
        if (!MiroService.IMAGE_MIME.has(mime)) {
          throw new Error(`unsupported mime ${mime}`);
        }

        const declared = Number(res.headers?.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
          controller.abort();
          throw new Error('image too large');
        }

        const buffer = await MiroService.readCapped(res, controller);
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

  /** Exact match, or a true subdomain of an allowlisted apex. */
  private static isAllowedImageHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return (
      IMAGE_HOST_ALLOWLIST.EXACT.includes(host) ||
      IMAGE_HOST_ALLOWLIST.SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  }

  /**
   * Read the body into a Buffer, giving up as soon as it passes
   * `MAX_IMAGE_BYTES`.
   *
   * `content-length` is a claim by the sender, not a fact, so the streaming
   * read is what actually bounds memory: a response that omits or understates
   * the header still cannot make us allocate more than the cap plus one chunk.
   * Aborting rather than draining also stops the transfer instead of paying
   * for bytes we have already decided to discard.
   *
   * The `arrayBuffer()` fallback covers responses with no readable body — an
   * older/edge runtime, or a hand-rolled test double. Degrading to a
   * read-then-check beats throwing a TypeError on a missing `body`.
   */
  private static async readCapped(
    res: Response,
    controller: AbortController,
  ): Promise<Buffer> {
    const body = res.body as unknown as
      | {
          getReader?: () => {
            read: () => Promise<{ done?: boolean; value?: Uint8Array }>;
            cancel?: () => unknown;
          };
          [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
        }
      | null
      | undefined;

    const chunks: Buffer[] = [];
    let total = 0;
    const take = (chunk: Uint8Array): void => {
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        controller.abort();
        throw new Error('image too large');
      }
      chunks.push(Buffer.from(chunk));
    };

    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) take(value);
        }
      } catch (err) {
        // Best-effort release; the abort above is what stops the transfer.
        try {
          await reader.cancel?.();
        } catch {
          /* ignore */
        }
        throw err;
      }
    } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
      // A thrown `take` ends the for-await, which calls the iterator's
      // `return()` and closes the stream.
      for await (const chunk of body as AsyncIterable<Uint8Array>) take(chunk);
    } else {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error('image too large');
      return buffer;
    }

    return Buffer.concat(chunks);
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
