import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ImageService } from '../image/image.service';
import { MAX_IMAGE_UPLOAD_BYTES } from '../image/image.constants';
import { parseMiroBoardId } from './parse-board-id';
import type {
  MiroConnector,
  MiroImportNote,
  MiroImportResult,
  MiroImportSession,
  MiroItem,
  MiroPage,
  MiroProgressSink,
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
 * The same cap `ImageService.upload` enforces, taken from the constant
 * `image.config.ts` derives `image.maxFileSizeBytes` from rather than being
 * mirrored as a literal — the comparison here is `> cap`, exactly as it is
 * there, so the two cannot disagree about which byte is one too many.
 *
 * Checking here as well as in `ImageService.upload` is not redundant: upload
 * only sees a Buffer that has already been fully materialised, so a
 * hostile/oversized response would blow up memory before its check ever runs.
 */
const MAX_IMAGE_BYTES = MAX_IMAGE_UPLOAD_BYTES;

/**
 * Deadlines for the outbound calls.
 *
 * Node's `fetch` applies NO overall request deadline: a host that accepts the
 * connection and then stalls holds a Nest request worker until the client
 * gives up. `fetchPaged` makes that worse — it can issue up to `MAX_ITEMS + 1`
 * sequential page requests, so one stalled hop stalls the whole import.
 *
 * The JSON deadline is per PAGE, not per import, which is the right unit: a
 * healthy page answers in well under a second, and a large board is allowed to
 * take many of them. The image deadline is looser because it covers a real
 * binary transfer, bounded independently at `MAX_IMAGE_BYTES`.
 */
const API_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 30_000;

/**
 * Aggregate ceilings on the image re-hosting phase.
 *
 * `MAX_IMAGE_BYTES` bounds ONE image; it says nothing about the total. With
 * `MAX_ITEMS = 5000` an image-heavy board could otherwise drive 5000
 * sequential downloads of up to 10 MB each on a single request — tens of GB of
 * transfer and buffer churn, and a request that never finishes.
 *
 * So the phase is also bounded as a whole: at most `MAX_REHOSTED_IMAGES`
 * downloads, and at most `MAX_TOTAL_IMAGE_BYTES` in aggregate. 100 images /
 * 64 MB covers the boards people actually import while keeping the worst case
 * to a bounded, sub-minute amount of work. Whatever is left over is SKIPPED
 * (not downloaded) and reported under its own note reason, so the user is told
 * their board was too image-heavy rather than silently losing pictures.
 */
const MAX_REHOSTED_IMAGES = 100;
const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;

/**
 * How many image downloads may be in flight at once.
 *
 * Re-hosting is by far the slowest phase — up to `MAX_REHOSTED_IMAGES` (100)
 * transfers, each with its own 30s deadline — and run one at a time it is also
 * the phase most likely to look like a hang. Every one of those downloads is a
 * network wait, not CPU, so the serial loop leaves the connection idle for
 * essentially its whole duration.
 *
 * 6 is chosen, not maximal:
 *
 * - **Memory.** Each in-flight download may buffer up to `MAX_IMAGE_BYTES`
 *   (10 MB) before it is handed to the upload, so the pool's peak footprint is
 *   `CONCURRENCY x 10 MB`. At 6 that is 60 MB — the same order as the 25 MB
 *   JSON body limit the process already accepts, and bounded regardless of how
 *   image-heavy the board is. Unbounded `Promise.all` over 100 items would be
 *   1 GB.
 * - **Upstream politeness.** The downloads hit api.miro.com with the caller's
 *   token; Miro's documented ceiling is 1000 req/min, and 6 in flight cannot
 *   approach it while still cutting the phase's wall clock by ~6x.
 * - **Diminishing returns.** Past ~6 the phase is bound by bandwidth and by
 *   `ImageService.upload`, not by request latency.
 */
const IMAGE_CONCURRENCY = 6;

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

  /** Aggregate image ceilings, exposed so the tests assert the real numbers. */
  static readonly MAX_REHOSTED_IMAGES = MAX_REHOSTED_IMAGES;
  static readonly MAX_TOTAL_IMAGE_BYTES = MAX_TOTAL_IMAGE_BYTES;

  /** Image download pool size, exposed so tests can reason about the bound. */
  static readonly IMAGE_CONCURRENCY = IMAGE_CONCURRENCY;

  constructor(private readonly imageService: ImageService) {}

  /**
   * PHASE 1 — everything that may still fail with a meaningful HTTP status.
   *
   * The import streams its progress, and an HTTP status cannot be changed once
   * the first byte is written. So the two failures that genuinely need a
   * status live here, ahead of the stream:
   *
   * - a board URL/id we cannot parse -> 400 (`parseMiroBoardId`);
   * - the first authenticated Miro call, which is what surfaces a bad token
   *   (401), a missing scope (403), a board the user cannot see (404), and a
   *   rate limit (429).
   *
   * Anything that fails after this — a later page, an image, the upload — is
   * reported in-band, because by then the response is committed to 200.
   */
  async prepareImport(
    token: string,
    boardUrl: string,
  ): Promise<MiroImportSession> {
    const boardId = parseMiroBoardId(boardUrl);
    const firstItemsPage = await this.getJson<MiroPage<MiroItem>>(
      MiroService.pageUrl(MiroService.feedUrl(boardId, 'items')),
      token,
    );
    return { boardId, firstItemsPage };
  }

  /**
   * PHASE 2 — the long tail, reporting progress as it goes.
   *
   * `emit` is called with a monotonic per-stage count; the controller turns
   * each call into one NDJSON line. It is deliberately synchronous and
   * fire-and-forget: progress must never be able to fail the import.
   */
  async runImport(
    session: MiroImportSession,
    token: string,
    workspaceId: string,
    emit: MiroProgressSink,
  ): Promise<MiroImportResult> {
    const notes: MiroImportNote[] = [];

    const items = await this.fetchPaged<MiroItem>(
      MiroService.feedUrl(session.boardId, 'items'),
      token,
      notes,
      'items',
      (done) => emit({ type: 'progress', stage: 'items', done }),
      session.firstItemsPage,
    );
    const connectors = await this.fetchPaged<MiroConnector>(
      MiroService.feedUrl(session.boardId, 'connectors'),
      token,
      notes,
      'connectors',
      (done) => emit({ type: 'progress', stage: 'connectors', done }),
    );

    const rehosted = await this.rehostImages(
      items,
      token,
      workspaceId,
      notes,
      emit,
    );
    return { items: rehosted, connectors, notes };
  }

  /**
   * The non-streaming entry point, kept for callers that just want the result
   * (and for the tests that assert the end-to-end shape). It is exactly the
   * two phases run back to back with the progress discarded, so there is no
   * second code path to keep in step.
   */
  async importBoard(
    token: string,
    boardUrl: string,
    workspaceId: string,
  ): Promise<MiroImportResult> {
    const session = await this.prepareImport(token, boardUrl);
    return this.runImport(session, token, workspaceId, () => {});
  }

  /** `https://api.miro.com/v2/boards/<id>/<feed>`, with the id escaped. */
  private static feedUrl(boardId: string, feed: string): string {
    return `${MIRO_API}/boards/${encodeURIComponent(boardId)}/${feed}`;
  }

  /** A feed URL with the page size and (optionally) a cursor applied. */
  private static pageUrl(baseUrl: string, cursor?: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (cursor) url.searchParams.set('cursor', cursor);
    return url.toString();
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
   *
   * The phase as a whole is bounded by `MAX_REHOSTED_IMAGES` /
   * `MAX_TOTAL_IMAGE_BYTES`; images past either ceiling are skipped without
   * being fetched and reported under `image-budget`, kept separate from
   * `image-failed` because "your board is too image-heavy" and "this image is
   * broken" are different facts.
   */
  private async rehostImages(
    items: MiroItem[],
    token: string,
    workspaceId: string,
    notes: MiroImportNote[],
    emit: MiroProgressSink = () => {},
  ): Promise<MiroItem[]> {
    let failed = 0;
    let overBudget = 0;
    let downloads = 0;
    let downloadedBytes = 0;

    // OUTPUT ORDER IS PART OF THE CONTRACT. `mapMiroItems` walks this array to
    // build its miro-id -> element-id map and to lay frames down behind their
    // contents, so a completion-ordered `push` would silently reshuffle
    // z-order and make the import non-deterministic. Every slot is written BY
    // INDEX and the holes (failed/skipped images) are compacted at the end, so
    // the result is byte-identical to the serial version's.
    const out: (MiroItem | null)[] = new Array<MiroItem | null>(
      items.length,
    ).fill(null);

    // The work list, in feed order. Non-image items are settled inline —
    // there is nothing to await for them.
    const jobs: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type !== 'image') {
        out[i] = items[i];
        continue;
      }
      jobs.push(i);
    }

    const total = jobs.length;
    let done = 0;
    // Announce the phase even when it is empty, so the client can move its
    // label off "reading" for every board rather than only image-bearing ones.
    emit({ type: 'progress', stage: 'images', done: 0, total });
    const complete = (): void => {
      done++;
      emit({ type: 'progress', stage: 'images', done, total });
    };

    // A shared cursor over `jobs` consumed by `IMAGE_CONCURRENCY` workers.
    // Workers claim indices IN ORDER, so the budget is spent on the earliest
    // images exactly as the serial loop spent it; only the completion order
    // differs, and nothing observable depends on that.
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const cursor = next++;
        if (cursor >= jobs.length) return;
        const index = jobs[cursor];
        const item = items[index];

        const src = (item.data as { imageUrl?: string } | undefined)?.imageUrl;
        if (!src) {
          failed++;
          complete();
          continue;
        }
        // Budget is charged against COMPLETED downloads, so with a pool in
        // flight the byte ceiling can be overshot by at most
        // `(IMAGE_CONCURRENCY - 1) x MAX_IMAGE_BYTES` before it trips — still
        // a hard bound (64 MB + 50 MB), and the alternative (reserving
        // `MAX_IMAGE_BYTES` per in-flight slot) would skip images that
        // comfortably fit. The COUNT ceiling is charged at dispatch, so it is
        // exact.
        if (
          downloads >= MAX_REHOSTED_IMAGES ||
          downloadedBytes >= MAX_TOTAL_IMAGE_BYTES
        ) {
          overBudget++;
          complete();
          continue;
        }

        try {
          out[index] = await this.rehostOne(item, src, token, workspaceId, {
            // Charged from inside `rehostOne`, AFTER the host allowlist check
            // and BEFORE its first await — so a refused host still costs no
            // budget (as in the serial version), and no two workers can claim
            // the same slot, keeping the count ceiling exact.
            charge: () => {
              downloads++;
            },
            addBytes: (n) => {
              downloadedBytes += n;
            },
          });
        } catch {
          // Deliberately swallowed: the note is the user-visible signal, and
          // the error could otherwise carry request context we don't want
          // logged.
          failed++;
        }
        complete();
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(IMAGE_CONCURRENCY, jobs.length) }, worker),
    );

    if (failed > 0) {
      notes.push({ reason: 'image-failed', itemType: 'image', count: failed });
    }
    if (overBudget > 0) {
      notes.push({
        reason: 'image-budget',
        itemType: 'image',
        count: overBudget,
      });
    }
    return out.filter((item): item is MiroItem => item !== null);
  }

  /**
   * Download ONE image and re-upload it, returning the item with a stable URL.
   * Throws on any refusal or failure; the caller turns that into a note.
   */
  private async rehostOne(
    item: MiroItem,
    src: string,
    token: string,
    workspaceId: string,
    budget: { charge: () => void; addBytes: (n: number) => void },
  ): Promise<MiroItem> {
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

    // Two independent reasons to stop: the size cap (raised from inside
    // `readCapped`, so it needs a controller we own) and the deadline. Only
    // a combined signal honours both — a bare `controller.signal` gives the
    // transfer no clock, and a bare timeout cannot be tripped by the cap.
    const controller = new AbortController();
    budget.charge();
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      ]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Lower-cased: HTTP header VALUES are case-sensitive to `Set.has`, but
    // servers legitimately send `Image/PNG`, and dropping a valid image
    // over letter case is a silent data loss.
    const mime =
      res.headers?.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
      '';
    if (!MiroService.IMAGE_MIME.has(mime)) {
      throw new Error(`unsupported mime ${mime}`);
    }

    const declared = Number(res.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      controller.abort();
      throw new Error('image too large');
    }

    const buffer = await MiroService.readCapped(res, controller);
    budget.addBytes(buffer.length);
    const uploaded = await this.imageService.upload(
      buffer,
      mime,
      `miro-${item.id}`,
      workspaceId,
    );
    return {
      ...item,
      data: {
        ...(item.data ?? {}),
        imageUrl: `/api/v1/workspaces/${workspaceId}/images/${uploaded.id}`,
      },
    };
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
   *
   * `onPage` receives the running total after every page — this is the only
   * signal a caller has that a 60-round-trip board is progressing rather than
   * hung. `first` lets the caller hand in a page it has already fetched (the
   * pre-stream probe), so the seeded page is never requested twice.
   */
  private async fetchPaged<T>(
    baseUrl: string,
    token: string,
    notes: MiroImportNote[],
    label: string,
    onPage: (done: number) => void = () => {},
    first?: MiroPage<T>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    let seeded = first;

    for (;;) {
      let page: MiroPage<T>;
      if (seeded) {
        page = seeded;
        seeded = undefined;
      } else {
        page = await this.getJson<MiroPage<T>>(
          MiroService.pageUrl(baseUrl, cursor),
          token,
        );
      }
      const batch = page.data ?? [];
      out.push(...batch);
      onPage(Math.min(out.length, MiroService.MAX_ITEMS));

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
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      // A stalled upstream and an unreachable one need different messages —
      // "could not reach" sends the user hunting for a network problem that
      // isn't there. Neither message may carry the URL or the token.
      throw new InternalServerErrorException(
        MiroService.isTimeout(err)
          ? 'The Miro API did not respond in time'
          : 'Could not reach the Miro API',
      );
    }

    if (res.status === 401) {
      throw new UnauthorizedException(
        'The Miro token was rejected (invalid or expired)',
      );
    }
    if (res.status === 403) {
      throw new ForbiddenException(
        'The Miro token lacks access to this board (needs boards:read)',
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(
        'Miro board not found, or the token has no access to it',
      );
    }
    if (res.status === 429) {
      throw new InternalServerErrorException(
        'Miro rate limit reached — try again in a minute',
      );
    }
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Miro API error (HTTP ${res.status})`,
      );
    }

    return (await res.json()) as T;
  }

  /**
   * Did this rejection come from our own deadline?
   *
   * `AbortSignal.timeout` rejects with a `TimeoutError`, but older/edge
   * runtimes and polyfills surface a plain `AbortError`. The feed fetch carries
   * no other abort source, so treating both as the deadline is exact rather
   * than a guess.
   */
  private static isTimeout(err: unknown): boolean {
    const name = (err as { name?: unknown } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
  }
}
