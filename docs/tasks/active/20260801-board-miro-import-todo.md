# Board Miro Import (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a Miro board into a new wafflebase `"board"` document as native elements (stickies, shapes, text, connectors, images, frames, cards).

**Architecture:** Three layers. (1) A NestJS backend proxy holds the user's pasted Miro token for one request — never stored, logged, or returned — fetches `/items` + `/connectors` paginated, and re-hosts image bytes into the workspace image bucket. (2) A **pure** mapper in `@wafflebase/board` turns the returned Miro JSON into `ElementInit[]` using a two-pass id map so connectors resolve endpoints. (3) The frontend creates a `board` document and persists the elements headlessly through a new `board` branch in `applyImportedContent`, driving one `YorkieBoardStore.batch`.

**Tech Stack:** NestJS 11 + Jest (backend), TypeScript + Vitest (board package, frontend), Yorkie CRDT, Miro REST API v2.

## Global Constraints

- **Spec:** `docs/design/board/board-miro-import.md`. target-version 0.6.3.
- **The Miro token is a live credential.** It is accepted in a request body, held in memory for that request, and discarded. NEVER persist it (no Prisma model), NEVER log it, NEVER include it in a response or an error message. No `console.log(token)`, no token in thrown error strings.
- **Connectors are NOT in `/items`.** They come from the separate paginated endpoint `GET /v2/boards/{id}/connectors`. Fetch both.
- **Miro image URLs require the bearer token and expire in ~60 seconds.** Fetch image bytes with `Authorization: Bearer <token>` immediately during the same request, appending `format=original`.
- **Miro geometry:** `position` is the item's **center**; `geometry.rotation` is **degrees**. The board `Frame` is `{ x, y, w, h, rotation }` with top-left origin and **radians**. Convert: `x = position.x - width/2`, `y = position.y - height/2`, `rotation = deg * Math.PI / 180`. Coordinates map **1:1** (no scaling).
- **Miro API limits:** `/items` `limit` max is **50**. Paginate via the top-level `cursor` field.
- **Unsupported item types are skipped and counted in a report — never silently dropped.**
- `packages/board` is NOT currently in the root test fan-out — Task 5 adds it.
- **Commit format:** subject ≤70 chars; blank line; body explains why. End commits with the repo's two trailer lines. Pre-commit runs `pnpm verify:fast`.

---

### Task 1: Miro types + board-URL parser (backend, pure)

**Files:**
- Create: `packages/backend/src/miro/miro.types.ts`
- Create: `packages/backend/src/miro/parse-board-id.ts`
- Test: `packages/backend/src/miro/parse-board-id.spec.ts`

**Interfaces:**
- Produces: `parseMiroBoardId(input: string): string` (throws `BadRequestException` on garbage); the `MiroItem` / `MiroConnector` / `MiroImportResult` types used by every later backend + mapper task.

- [x] **Step 1: Write the failing test**

```ts
// packages/backend/src/miro/parse-board-id.spec.ts
import { BadRequestException } from '@nestjs/common';
import { parseMiroBoardId } from './parse-board-id';

describe('parseMiroBoardId', () => {
  it('extracts the id from a canonical board URL', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI=/')).toBe('uXjVOD50NUI=');
  });

  it('extracts the id when the URL has a trailing path or query', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/o9J_lJWSHdg=/?moveToWidget=123')).toBe('o9J_lJWSHdg=');
  });

  it('decodes a percent-encoded padding character', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI%3D/')).toBe('uXjVOD50NUI=');
  });

  it('accepts a bare board id', () => {
    expect(parseMiroBoardId('uXjVOD50NUI=')).toBe('uXjVOD50NUI=');
  });

  it('trims surrounding whitespace', () => {
    expect(parseMiroBoardId('  uXjVOD50NUI=  ')).toBe('uXjVOD50NUI=');
  });

  it('rejects a non-Miro URL', () => {
    expect(() => parseMiroBoardId('https://example.com/whatever')).toThrow(BadRequestException);
  });

  it('rejects an empty string', () => {
    expect(() => parseMiroBoardId('   ')).toThrow(BadRequestException);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- parse-board-id`
Expected: FAIL — cannot find module `./parse-board-id`.

- [x] **Step 3: Write the types**

```ts
// packages/backend/src/miro/miro.types.ts

/** Position of a Miro item. `x`/`y` address the item's CENTER. */
export interface MiroPosition {
  x: number;
  y: number;
  origin?: string;
  relativeTo?: string;
}

/** Size + rotation. `rotation` is in DEGREES. */
export interface MiroGeometry {
  width?: number;
  height?: number;
  rotation?: number;
}

/**
 * The subset of a Miro board item we read. Deliberately narrow and loose —
 * unknown `type` values and unknown `data`/`style` keys are ignored by the
 * mapper rather than throwing, so Miro API drift degrades instead of breaking.
 */
export interface MiroItem {
  id: string;
  type: string;
  position?: MiroPosition;
  geometry?: MiroGeometry;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
  parent?: { id?: string };
}

/** One end of a connector. `id` is the connected item's id when attached. */
export interface MiroConnectorEnd {
  id?: string;
  position?: { x?: string; y?: string };
}

/** A Miro connector (from the separate /connectors endpoint). */
export interface MiroConnector {
  id: string;
  shape?: string;
  startItem?: MiroConnectorEnd;
  endItem?: MiroConnectorEnd;
  style?: Record<string, unknown>;
  isSupported?: boolean;
}

/** A single skip/degradation the import wants to surface to the user. */
export interface MiroImportNote {
  /** Machine-readable reason, e.g. 'unsupported-type' | 'image-failed' | 'truncated'. */
  reason: string;
  /** The Miro item type this concerns, when applicable. */
  itemType?: string;
  /** How many items this note covers. */
  count: number;
}

/** What the backend proxy returns to the frontend. Contains NO token. */
export interface MiroImportResult {
  items: MiroItem[];
  connectors: MiroConnector[];
  notes: MiroImportNote[];
}
```

- [x] **Step 4: Write the parser**

```ts
// packages/backend/src/miro/parse-board-id.ts
import { BadRequestException } from '@nestjs/common';

/** Matches the board id segment of a canonical Miro board URL. */
const BOARD_URL_RE = /miro\.com\/app\/(?:board|live-embed)\/([^/?#]+)/i;

/**
 * Extract a Miro board id from a pasted board URL, or accept a bare id.
 *
 * Board ids are base64-ish and commonly end in `=`, which some systems
 * percent-encode to `%3D` when the link is copied around — decode it, since
 * the Miro API expects the raw `=` in the path.
 */
export function parseMiroBoardId(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('A Miro board URL or board id is required');
  }

  const match = BOARD_URL_RE.exec(trimmed);
  if (match) {
    return decodeURIComponent(match[1]);
  }

  // A bare id: no scheme, no slashes, no spaces.
  if (!/[/\s]/.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return decodeURIComponent(trimmed);
  }

  throw new BadRequestException(
    'Expected a Miro board URL like https://miro.com/app/board/<id>/ or a bare board id',
  );
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- parse-board-id`
Expected: PASS (7 tests).

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/miro/
git commit -m "Add Miro item types and board-URL id parser"
```

---

### Task 2: Backend fetch of items + connectors (paginated, mocked)

**Files:**
- Create: `packages/backend/src/miro/miro.service.ts`
- Test: `packages/backend/src/miro/miro.service.spec.ts`

**Interfaces:**
- Consumes: `MiroItem`, `MiroConnector`, `MiroImportNote`, `MiroImportResult` (Task 1); `parseMiroBoardId` (Task 1).
- Produces: `class MiroService { constructor(imageService: ImageService); importBoard(token: string, boardUrl: string, workspaceId: string): Promise<MiroImportResult> }`. Task 3 adds the image re-host inside it; this task builds fetch + pagination + error mapping and leaves image items untouched.

**Notes for the implementer:** the backend has **no HTTP client dependency** — use global `fetch` (Node 22). Backend service tests plain-`new` the service with hand-rolled mocks (see `datasource.service.spec.ts`); mock `fetch` with `global.fetch = jest.fn()`.

- [x] **Step 1: Write the failing test**

```ts
// packages/backend/src/miro/miro.service.spec.ts
import { MiroService } from './miro.service';
import type { ImageService } from '../image/image.service';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeService() {
  const imageService = { upload: jest.fn() };
  const service = new MiroService(imageService as unknown as ImageService);
  return { service, imageService };
}

describe('MiroService.importBoard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('paginates items via cursor and fetches connectors separately', async () => {
    const fetchMock = jest.fn()
      // items page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '1', type: 'shape' }],
        cursor: 'CUR1',
      }))
      // items page 2 (no cursor -> last)
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: '2', type: 'text' }],
      }))
      // connectors page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'c1', startItem: { id: '1' }, endItem: { id: '2' } }],
      }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'https://miro.com/app/board/B=/', 'ws-1');

    expect(result.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(result.connectors.map((c) => c.id)).toEqual(['c1']);

    // Requests: 2 item pages + 1 connector page.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(String(firstUrl)).toContain('/v2/boards/B%3D/items');
    expect(String(firstUrl)).toContain('limit=50');
    expect((firstInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=CUR1');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/connectors');
  });

  it('maps a 401 from Miro to an unauthorized error mentioning the token', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, 401)) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('bad', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/token/i);
  });

  it('maps a 404 from Miro to a not-found error', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const { service } = makeService();
    await expect(
      service.importBoard('tok', 'https://miro.com/app/board/B=/', 'ws-1'),
    ).rejects.toThrow(/not found|no access/i);
  });

  it('stops at the item ceiling and reports the truncation', async () => {
    // Every page returns 50 items and a cursor, so only the ceiling stops it.
    const page = {
      data: Array.from({ length: 50 }, (_, i) => ({ id: `i${i}`, type: 'shape' })),
      cursor: 'MORE',
    };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(page)) as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(result.items.length).toBe(MiroService.MAX_ITEMS);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'truncated' }),
    );
  });

  it('never includes the token in the result', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [] })) as unknown as typeof fetch;
    const { service } = makeService();
    const result = await service.importBoard('SECRET-TOKEN', 'B=', 'ws-1');
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- miro.service`
Expected: FAIL — cannot find module `./miro.service`.

- [x] **Step 3: Write the service**

```ts
// packages/backend/src/miro/miro.service.ts
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
    );
    const connectors = await this.fetchPaged<MiroConnector>(
      `${MIRO_API}/boards/${encodeURIComponent(boardId)}/connectors`,
      token,
      notes,
    );

    // Task 3 re-hosts image bytes here before returning.
    return { items, connectors, notes };
  }

  /**
   * Follow Miro's cursor pagination until exhausted or the item ceiling is
   * reached. On truncation a note is pushed rather than failing — a partial
   * import the user knows about is better than none.
   */
  private async fetchPaged<T>(
    baseUrl: string,
    token: string,
    notes: MiroImportNote[],
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;

    for (;;) {
      const url = new URL(baseUrl);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('cursor', cursor);

      const page = await this.getJson<MiroPage<T>>(url.toString(), token);
      out.push(...(page.data ?? []));

      if (out.length >= MiroService.MAX_ITEMS) {
        out.length = MiroService.MAX_ITEMS;
        notes.push({ reason: 'truncated', count: MiroService.MAX_ITEMS });
        return out;
      }
      if (!page.cursor) return out;
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- miro.service`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/miro/
git commit -m "Fetch Miro items and connectors with cursor pagination"
```

---

### Task 3: Image re-host + controller + module registration

**Files:**
- Modify: `packages/backend/src/miro/miro.service.ts` (add `rehostImages`, call it from `importBoard`)
- Create: `packages/backend/src/miro/miro.dto.ts`
- Create: `packages/backend/src/miro/miro.controller.ts`
- Create: `packages/backend/src/miro/miro.module.ts`
- Modify: `packages/backend/src/app.module.ts` (import + register `MiroModule`)
- Test: `packages/backend/src/miro/miro.service.spec.ts` (add re-host cases)

**Interfaces:**
- Consumes: `MiroService.importBoard` (Task 2); `ImageService.upload(file: Buffer, mimeType: string, originalName: string, keyPrefix?: string): Promise<{ id: string; url: string }>` from `packages/backend/src/image/image.service.ts`.
- Produces: `POST /workspaces/:workspaceId/miro/import` accepting `{ token, boardUrl }` and returning `MiroImportResult`.

**Note:** `ImageService.upload` accepts a plain **`Buffer`** and only these mime types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`. The workspace-scoped public URL is built by the caller as `/api/v1/workspaces/${workspaceId}/images/${result.id}` (the service's own `url` field is a different, unscoped path — do not use it).

- [x] **Step 1: Write the failing re-host tests**

Append to `packages/backend/src/miro/miro.service.spec.ts`:

```ts
describe('MiroService image re-hosting', () => {
  afterEach(() => jest.restoreAllMocks());

  function imagePage(imageUrl: string) {
    return {
      data: [{ id: 'img1', type: 'image', data: { imageUrl } }],
    };
  }

  it('downloads image bytes with the token and rewrites the URL to a workspace-scoped one', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse(imagePage('https://api.miro.com/v2/boards/B/resources/r1?format=preview')))
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // connectors
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => bytes,
      } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service, imageService } = makeService();
    imageService.upload.mockResolvedValue({ id: 'new-id', url: '/images/x' });

    const result = await service.importBoard('tok', 'B=', 'ws-1');

    // Downloaded with auth, asking for the original bytes.
    const downloadCall = fetchMock.mock.calls[2];
    expect(String(downloadCall[0])).toContain('format=original');
    expect((downloadCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });

    // Uploaded as a Buffer under the workspace prefix.
    expect(imageService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      expect.any(String),
      'ws-1',
    );

    expect(result.items[0].data).toMatchObject({
      imageUrl: '/api/v1/workspaces/ws-1/images/new-id',
    });
  });

  it('drops the image and reports it when the download fails', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse(imagePage('https://api.miro.com/v2/boards/B/resources/r1')))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { service } = makeService();
    const result = await service.importBoard('tok', 'B=', 'ws-1');

    expect(result.items).toHaveLength(0);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ reason: 'image-failed', count: 1 }),
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- miro.service`
Expected: FAIL — images are returned untouched, no `image-failed` note.

- [x] **Step 3: Add re-hosting to the service**

In `miro.service.ts`, replace the `// Task 3 re-hosts...` comment line with a call, and add the two methods:

```ts
    const rehosted = await this.rehostImages(items, token, workspaceId, notes);
    return { items: rehosted, connectors, notes };
```

```ts
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- miro.service`
Expected: PASS (7 tests).

- [x] **Step 5: Add the DTO, controller, and module**

```ts
// packages/backend/src/miro/miro.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class ImportMiroBoardDto {
  /**
   * The user's Miro access token. Used for this request only — never stored,
   * never logged, never returned.
   */
  @IsString()
  @IsNotEmpty()
  token!: string;

  /** A Miro board URL, or a bare board id. */
  @IsString()
  @IsNotEmpty()
  boardUrl!: string;
}
```

```ts
// packages/backend/src/miro/miro.controller.ts
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import { MiroService } from './miro.service';
import { ImportMiroBoardDto } from './miro.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class MiroController {
  constructor(
    private readonly miroService: MiroService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Fetch a Miro board's items + connectors on the caller's behalf. The token
   * lives only for this request; the response never contains it.
   */
  @Post('workspaces/:workspaceId/miro/import')
  async importBoard(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportMiroBoardDto,
  ) {
    const userId = Number(req.user.id);
    const workspaceId = await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.miroService.importBoard(dto.token, dto.boardUrl, workspaceId);
  }
}
```

```ts
// packages/backend/src/miro/miro.module.ts
import { Module } from '@nestjs/common';
import { MiroController } from './miro.controller';
import { MiroService } from './miro.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ImageModule } from '../image/image.module';

@Module({
  imports: [WorkspaceModule, ImageModule],
  controllers: [MiroController],
  providers: [MiroService],
})
export class MiroModule {}
```

> Confirm `ImageModule` **exports** `ImageService` (`packages/backend/src/image/image.module.ts` — `FileModule` exports `FileService`; check the image one and add `exports: [ImageService]` if it is missing, which is a one-line, additive change).

- [x] **Step 6: Register the module**

In `packages/backend/src/app.module.ts`, add the import beside the other module imports:

```ts
import { MiroModule } from './miro/miro.module';
```

and add `MiroModule,` to the `imports:` array (next to `ImageModule,` / `FolderModule,`).

- [x] **Step 7: Verify backend builds + all backend tests pass**

Run: `pnpm --filter @wafflebase/backend build`
Run: `pnpm --filter @wafflebase/backend test`
Expected: build clean; full backend suite green.

- [x] **Step 8: Commit**

```bash
git add packages/backend/src/miro/ packages/backend/src/app.module.ts packages/backend/src/image/image.module.ts
git commit -m "Re-host Miro images and expose the board import endpoint"
```

---

### Task 4: Mapper primitives — geometry, shape kinds, sticky colors, HTML text

**Files:**
- Create: `packages/board/src/import/miro/geometry.ts`
- Create: `packages/board/src/import/miro/shape-kind.ts`
- Create: `packages/board/src/import/miro/colors.ts`
- Create: `packages/board/src/import/miro/text.ts`
- Test: `packages/board/src/import/miro/primitives.test.ts`

**Interfaces:**
- Produces (all consumed by Task 5):
  - `miroFrame(position, geometry, fallback?): Frame` — center+degrees → top-left+radians
  - `miroShapeKind(name: string | undefined): { kind: ShapeKind; known: boolean }`
  - `stickyHex(named: string | undefined): string`
  - `miroHtmlToBlocks(html: string | undefined): Block[]`

**Note:** `Frame` is `{ x, y, w, h, rotation }`. `packages/board` tests run under **vitest + jsdom** (`pnpm --filter @wafflebase/board test`), and jsdom gives you `DOMParser` for the HTML parsing.

- [x] **Step 1: Write the failing test**

```ts
// packages/board/src/import/miro/primitives.test.ts
import { describe, it, expect } from 'vitest';
import { miroFrame } from './geometry';
import { miroShapeKind } from './shape-kind';
import { stickyHex } from './colors';
import { miroHtmlToBlocks } from './text';

describe('miroFrame', () => {
  it('converts a center position + degrees into a top-left frame in radians', () => {
    const f = miroFrame({ x: 100, y: 200 }, { width: 40, height: 20, rotation: 90 });
    expect(f).toMatchObject({ x: 80, y: 190, w: 40, h: 20 });
    expect(f.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('defaults missing size and rotation', () => {
    const f = miroFrame({ x: 0, y: 0 }, undefined, { w: 100, h: 50 });
    expect(f).toMatchObject({ x: -50, y: -25, w: 100, h: 50, rotation: 0 });
  });

  it('treats a missing position as the board origin', () => {
    const f = miroFrame(undefined, { width: 10, height: 10 });
    expect(f).toMatchObject({ x: -5, y: -5 });
  });
});

describe('miroShapeKind', () => {
  it('maps known Miro shape names to slides ShapeKinds', () => {
    expect(miroShapeKind('rectangle')).toEqual({ kind: 'rect', known: true });
    expect(miroShapeKind('round_rectangle')).toEqual({ kind: 'roundRect', known: true });
    expect(miroShapeKind('circle')).toEqual({ kind: 'ellipse', known: true });
    expect(miroShapeKind('rhombus')).toEqual({ kind: 'diamond', known: true });
    expect(miroShapeKind('star')).toEqual({ kind: 'star5', known: true });
    expect(miroShapeKind('cross')).toEqual({ kind: 'plus', known: true });
    expect(miroShapeKind('flow_chart_predefined_process'))
      .toEqual({ kind: 'flowChartPredefinedProcess', known: true });
  });

  it('falls back to rect and flags unknown names', () => {
    expect(miroShapeKind('sombrero')).toEqual({ kind: 'rect', known: false });
    expect(miroShapeKind(undefined)).toEqual({ kind: 'rect', known: false });
  });
});

describe('stickyHex', () => {
  it('maps Miro named sticky colors to hex', () => {
    expect(stickyHex('yellow')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(stickyHex('light_green')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(stickyHex('yellow')).not.toBe(stickyHex('light_green'));
  });

  it('falls back to the default sticky yellow for unknown or missing names', () => {
    expect(stickyHex('chartreuse')).toBe(stickyHex(undefined));
  });
});

describe('miroHtmlToBlocks', () => {
  it('returns one paragraph block with the plain text', () => {
    const blocks = miroHtmlToBlocks('<p>Hello</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Hello');
  });

  it('splits multiple paragraphs into multiple blocks', () => {
    const blocks = miroHtmlToBlocks('<p>One</p><p>Two</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks[1].inlines.map((i) => i.text).join('')).toBe('Two');
  });

  it('carries bold and italic onto the inline style', () => {
    const blocks = miroHtmlToBlocks('<p>a<strong>b</strong><em>c</em></p>');
    const inlines = blocks[0].inlines;
    expect(inlines.find((i) => i.text === 'b')?.style.bold).toBe(true);
    expect(inlines.find((i) => i.text === 'c')?.style.italic).toBe(true);
  });

  it('degrades an unknown tag to its text content', () => {
    const blocks = miroHtmlToBlocks('<p>x<marquee>y</marquee></p>');
    expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('xy');
  });

  it('returns a single empty paragraph for empty or missing content', () => {
    expect(miroHtmlToBlocks(undefined)).toHaveLength(1);
    expect(miroHtmlToBlocks('')).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/board test -- primitives`
Expected: FAIL — modules not found.

- [x] **Step 3: Write `geometry.ts`**

```ts
// packages/board/src/import/miro/geometry.ts
import type { Frame } from '@wafflebase/slides';

/** Miro position (item CENTER) and geometry (rotation in DEGREES). */
export interface MiroPositionLike { x?: number; y?: number }
export interface MiroGeometryLike { width?: number; height?: number; rotation?: number }

const DEFAULT_SIZE = { w: 100, h: 100 };

/**
 * Convert Miro's center-origin position + degree rotation into the board's
 * top-left-origin `Frame` in radians. Coordinates map 1:1 — the board plane is
 * unbounded, so no scaling is needed.
 */
export function miroFrame(
  position: MiroPositionLike | undefined,
  geometry: MiroGeometryLike | undefined,
  fallbackSize: { w: number; h: number } = DEFAULT_SIZE,
): Frame {
  const w = geometry?.width ?? fallbackSize.w;
  const h = geometry?.height ?? fallbackSize.h;
  const cx = position?.x ?? 0;
  const cy = position?.y ?? 0;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    rotation: ((geometry?.rotation ?? 0) * Math.PI) / 180,
  };
}
```

- [x] **Step 4: Write `shape-kind.ts`**

```ts
// packages/board/src/import/miro/shape-kind.ts
import type { ShapeKind } from '@wafflebase/slides';

/**
 * Miro's 21 documented shape names → the slides `ShapeKind` union. Every Miro
 * shape has a direct counterpart, so this table is total; an unknown name
 * (API drift) degrades to `rect` and is reported by the caller.
 */
const SHAPE_MAP: Record<string, ShapeKind> = {
  rectangle: 'rect',
  round_rectangle: 'roundRect',
  circle: 'ellipse',
  triangle: 'triangle',
  rhombus: 'diamond',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  wedge_round_rectangle_callout: 'wedgeRoundRectCallout',
  star: 'star5',
  flow_chart_predefined_process: 'flowChartPredefinedProcess',
  cloud: 'cloud',
  cross: 'plus',
  can: 'can',
  right_arrow: 'rightArrow',
  left_arrow: 'leftArrow',
  left_right_arrow: 'leftRightArrow',
  left_brace: 'leftBrace',
  right_brace: 'rightBrace',
};

/** Resolve a Miro shape name; `known` is false when we fell back. */
export function miroShapeKind(name: string | undefined): { kind: ShapeKind; known: boolean } {
  const mapped = name ? SHAPE_MAP[name] : undefined;
  return mapped ? { kind: mapped, known: true } : { kind: 'rect', known: false };
}
```

- [x] **Step 5: Write `colors.ts`**

```ts
// packages/board/src/import/miro/colors.ts

/**
 * Miro sticky notes use NAMED colors (not hex). Map them onto pastel hexes in
 * the same family as the SP2 sticky palette so an imported board looks like a
 * natively-created one.
 */
const STICKY_HEX: Record<string, string> = {
  gray: '#E6E6E6',
  light_yellow: '#FFF8B8',
  yellow: '#FFF176',
  orange: '#FFE0B2',
  light_green: '#DCEDC8',
  green: '#CDEFC4',
  dark_green: '#A5D6A7',
  cyan: '#B2EBF2',
  light_pink: '#FFD6E7',
  pink: '#F8BBD0',
  violet: '#E5D4FF',
  red: '#FFCDD2',
  light_blue: '#C7E5FF',
  blue: '#BBDEFB',
  dark_blue: '#AEC7F0',
  black: '#CFCFCF',
};

/** Miro's documented default sticky color. */
const DEFAULT_STICKY = STICKY_HEX.light_yellow;

/** Named Miro sticky color → hex, falling back to the default yellow. */
export function stickyHex(named: string | undefined): string {
  return (named && STICKY_HEX[named]) || DEFAULT_STICKY;
}
```

- [x] **Step 6: Write `text.ts`**

```ts
// packages/board/src/import/miro/text.ts
import { DEFAULT_BLOCK_STYLE, type Block, type Inline } from '@wafflebase/docs';

/** Inline formatting accumulated while walking the HTML tree. */
interface Marks { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean }

const TAG_MARKS: Record<string, keyof Marks> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  S: 'strikethrough',
};

function makeBlock(inlines: Inline[], index: number): Block {
  return {
    id: `miro-${index}`,
    type: 'paragraph',
    inlines: inlines.length ? inlines : [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

/**
 * Parse Miro's `data.content` HTML fragment into docs `Block[]`.
 *
 * Deliberately conservative: block breaks come from `<p>`/`<br>`, and
 * bold/italic/underline/strikethrough carry onto the inline style. Every other
 * tag degrades to its text content — rich-text fidelity is best-effort, and a
 * tag we do not model must never lose the user's words.
 */
export function miroHtmlToBlocks(html: string | undefined): Block[] {
  const source = (html ?? '').trim();
  if (!source) return [makeBlock([], 0)];

  const doc = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const blocks: Block[] = [];
  let current: Inline[] = [];

  const flush = () => {
    if (current.length) {
      blocks.push(makeBlock(current, blocks.length));
      current = [];
    }
  };

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === 3 /* text */) {
      const text = node.textContent ?? '';
      if (text) current.push({ text, style: { ...marks } });
      return;
    }
    if (node.nodeType !== 1 /* element */) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      flush();
      return;
    }

    const isBlock = tag === 'P' || tag === 'DIV' || tag === 'LI';
    if (isBlock) flush();

    const mark = TAG_MARKS[tag];
    const next = mark ? { ...marks, [mark]: true } : marks;
    for (const child of Array.from(el.childNodes)) walk(child, next);

    if (isBlock) flush();
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child, {});
  flush();

  return blocks.length ? blocks : [makeBlock([], 0)];
}
```

- [x] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/board test -- primitives`
Expected: PASS (all 4 describes).

- [x] **Step 8: Commit**

```bash
git add packages/board/src/import/miro/
git commit -m "Add Miro import primitives: geometry, shapes, colors, text"
```

---

### Task 5: `mapMiroItems` — items + connectors → `ElementInit[]`

**Files:**
- Create: `packages/board/src/import/miro/map-items.ts`
- Create: `packages/board/src/import/miro/types.ts`
- Modify: `packages/board/src/index.ts` (re-export the new module)
- Modify: `package.json` (root — add `@wafflebase/board` to the test fan-out)
- Test: `packages/board/src/import/miro/map-items.test.ts`

**Interfaces:**
- Consumes: `miroFrame`, `miroShapeKind`, `stickyHex`, `miroHtmlToBlocks` (Task 4).
- Produces: `mapMiroItems(input: MiroImportInput): MiroMapResult` where
  `MiroImportInput = { items: MiroItemLike[]; connectors: MiroConnectorLike[] }` and
  `MiroMapResult = { inits: ElementInit[]; skipped: Record<string, number> }`.
  Task 6 (the frontend) consumes `inits`; the dialog surfaces `skipped`.

**Note:** the board package has exactly ONE barrel (`src/index.ts`) and no subpath exports, so the new module must be re-exported there to be importable from the frontend. `ConnectorElement.arrowheads` is **required** — pass `{}` for a plain line. `Endpoint` is `{ kind:'free'; x; y } | { kind:'attached'; elementId; siteIndex }`.

> **Superseded — connector fallback.** The plan text below (Step 1's
> "falls back to a free endpoint at the target centre" test and Step 4's
> `centreOf`/`endpoint` helper) describes behavior that did **not** ship. The
> shipped rule is **skip and count**: a connector is emitted only when BOTH
> ends resolve to a mapped element, otherwise it is dropped and counted under
> `skipped.connector`. Miro exposes no absolute coordinate for an unmapped end,
> so the "centre" fallback degenerated to the world origin and drew a stray
> line across boards that sit far from (0, 0). An item that cannot produce an
> element (an `image` with no `imageUrl`) is therefore also rejected in pass 1,
> before an id is minted, so it can never become a connector target. See
> `docs/design/board/board-miro-import.md` and `map-items.ts`. The original
> text is left intact as the historical plan.

- [x] **Step 1: Write the failing test**

```ts
// packages/board/src/import/miro/map-items.test.ts
import { describe, it, expect } from 'vitest';
import { mapMiroItems } from './map-items';

const at = (x: number, y: number, w = 100, h = 100) => ({
  position: { x, y },
  geometry: { width: w, height: h },
});

describe('mapMiroItems', () => {
  it('maps a sticky note to a roundRect shape with fill and text', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 's1', type: 'sticky_note', ...at(0, 0), data: { content: '<p>Hi</p>' }, style: { fillColor: 'green' } }],
      connectors: [],
    });
    expect(inits).toHaveLength(1);
    const data = inits[0].data as Record<string, any>;
    expect(inits[0].type).toBe('shape');
    expect(data.kind).toBe('roundRect');
    expect(data.fill).toMatchObject({ kind: 'srgb' });
    expect(data.text.verticalAnchor).toBe('middle');
    expect(data.text.blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Hi');
  });

  it('maps a shape with its kind, hex fill and border', () => {
    const { inits } = mapMiroItems({
      items: [{
        id: 'sh1', type: 'shape', ...at(10, 10, 40, 20),
        data: { shape: 'circle', content: 'Round' },
        style: { fillColor: '#ff9d48', borderColor: '#1a1a1a', borderWidth: 3 },
      }],
      connectors: [],
    });
    const data = inits[0].data as Record<string, any>;
    expect(data.kind).toBe('ellipse');
    expect(data.fill).toEqual({ kind: 'srgb', value: '#ff9d48' });
    expect(data.stroke).toMatchObject({ width: 3 });
    expect(inits[0].frame).toMatchObject({ x: -10, y: 0, w: 40, h: 20 });
  });

  it('maps a text item to a text element', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 't1', type: 'text', ...at(0, 0), data: { content: '<p>Words</p>' } }],
      connectors: [],
    });
    expect(inits[0].type).toBe('text');
    expect((inits[0].data as any).blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Words');
  });

  it('maps an image item to an image element using the re-hosted url', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 'i1', type: 'image', ...at(0, 0), data: { imageUrl: '/api/v1/workspaces/w/images/x' } }],
      connectors: [],
    });
    expect(inits[0].type).toBe('image');
    expect((inits[0].data as any).src).toBe('/api/v1/workspaces/w/images/x');
  });

  it('maps a frame to a labelled rectangle and a card to a roundRect', () => {
    const { inits } = mapMiroItems({
      items: [
        { id: 'f1', type: 'frame', ...at(0, 0), data: { title: 'Sprint' } },
        { id: 'c1', type: 'card', ...at(0, 0), data: { title: 'Task', description: 'Do it' } },
      ],
      connectors: [],
    });
    const frame = inits[0].data as any;
    const card = inits[1].data as any;
    expect(frame.kind).toBe('rect');
    expect(frame.text.blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Sprint');
    expect(card.kind).toBe('roundRect');
    const cardText = card.text.blocks.map((b: any) => b.inlines.map((i: any) => i.text).join('')).join(' ');
    expect(cardText).toContain('Task');
    expect(cardText).toContain('Do it');
  });

  it('attaches connector endpoints to the mapped elements via the id map', () => {
    const { inits } = mapMiroItems({
      items: [
        { id: 'a', type: 'shape', ...at(0, 0), data: { shape: 'rectangle' } },
        { id: 'b', type: 'shape', ...at(300, 0), data: { shape: 'rectangle' } },
      ],
      connectors: [{ id: 'c1', shape: 'elbowed', startItem: { id: 'a' }, endItem: { id: 'b' }, style: { endStrokeCap: 'arrow' } }],
    });

    const connector = inits.find((i) => i.type === 'connector') as any;
    expect(connector).toBeTruthy();
    expect(connector.routing).toBe('elbow');
    expect(connector.start.kind).toBe('attached');
    expect(connector.end.kind).toBe('attached');
    // The attached ids must be the NEW element ids, not the Miro ids.
    const shapeIds = inits.filter((i) => i.type === 'shape').map((i: any) => i.__id);
    expect(shapeIds).toContain(connector.start.elementId);
    expect(shapeIds).toContain(connector.end.elementId);
    expect(connector.arrowheads.end).toBeTruthy();
  });

  it('falls back to a free endpoint at the target centre when one end is unmapped', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 'a', type: 'shape', ...at(0, 0), data: { shape: 'rectangle' } }],
      connectors: [{ id: 'c1', startItem: { id: 'a' }, endItem: { id: 'ghost' } }],
    });
    const connector = inits.find((i) => i.type === 'connector') as any;
    expect(connector.start.kind).toBe('attached');
    expect(connector.end.kind).toBe('free');
  });

  it('skips a connector whose ends are both unmapped, and counts it', () => {
    const { inits, skipped } = mapMiroItems({
      items: [],
      connectors: [{ id: 'c1', startItem: { id: 'x' }, endItem: { id: 'y' } }],
    });
    expect(inits).toHaveLength(0);
    expect(skipped.connector).toBe(1);
  });

  it('skips unsupported item types and counts them by type', () => {
    const { inits, skipped } = mapMiroItems({
      items: [
        { id: 'd1', type: 'document', ...at(0, 0) },
        { id: 'e1', type: 'embed', ...at(0, 0) },
        { id: 'e2', type: 'embed', ...at(0, 0) },
      ],
      connectors: [],
    });
    expect(inits).toHaveLength(0);
    expect(skipped).toEqual({ document: 1, embed: 2 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/board test -- map-items`
Expected: FAIL — cannot find module `./map-items`.

- [x] **Step 3: Write `types.ts`**

```ts
// packages/board/src/import/miro/types.ts
import type { ElementInit } from '@wafflebase/slides';

/** Loose mirrors of the backend's Miro payload — the mapper reads no more. */
export interface MiroItemLike {
  id: string;
  type: string;
  position?: { x?: number; y?: number };
  geometry?: { width?: number; height?: number; rotation?: number };
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

export interface MiroConnectorLike {
  id: string;
  shape?: string;
  startItem?: { id?: string };
  endItem?: { id?: string };
  style?: Record<string, unknown>;
}

export interface MiroImportInput {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
}

/**
 * `inits` are ready for `store.addElement`. Each carries a non-model `__id`
 * so connectors can reference the element the store will create; the applier
 * strips it before writing.
 */
export interface MiroMapResult {
  inits: (ElementInit & { __id?: string })[];
  /** Count of skipped entries keyed by Miro item type. */
  skipped: Record<string, number>;
}
```

- [x] **Step 4: Write `map-items.ts`**

```ts
// packages/board/src/import/miro/map-items.ts
import { generateId, type ElementInit, type Endpoint } from '@wafflebase/slides';
import { miroFrame } from './geometry';
import { miroShapeKind } from './shape-kind';
import { stickyHex } from './colors';
import { miroHtmlToBlocks } from './text';
import type { MiroImportInput, MiroItemLike, MiroMapResult } from './types';

const SUPPORTED = new Set(['sticky_note', 'shape', 'text', 'image', 'frame', 'card', 'app_card']);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Miro connector `shape` → the board's connector routing. */
function routingOf(shape: string | undefined): 'straight' | 'elbow' | 'curved' {
  if (shape === 'straight') return 'straight';
  if (shape === 'elbowed') return 'elbow';
  return 'curved';
}

/**
 * Map a Miro board's items + connectors to board `ElementInit`s.
 *
 * Two passes, mirroring the PPTX importer's `parseSpTree`: pass 1 assigns an
 * element id to every mappable item and records `miroId → elementId`, so pass
 * 2 can resolve connector endpoints regardless of the order items arrived in.
 *
 * Pure: no I/O, no secrets, no DOM beyond `DOMParser` for the text fragments.
 */
export function mapMiroItems(input: MiroImportInput): MiroMapResult {
  const skipped: Record<string, number> = {};
  const bump = (type: string) => { skipped[type] = (skipped[type] ?? 0) + 1; };

  // --- pass 1: id map + frames ---
  const idMap = new Map<string, string>();
  const frames = new Map<string, ReturnType<typeof miroFrame>>();
  const mappable: MiroItemLike[] = [];

  for (const item of input.items) {
    if (!SUPPORTED.has(item.type)) {
      bump(item.type);
      continue;
    }
    const elementId = generateId();
    idMap.set(item.id, elementId);
    frames.set(item.id, miroFrame(item.position, item.geometry));
    mappable.push(item);
  }

  // --- pass 2: build the elements ---
  const inits: (ElementInit & { __id?: string })[] = [];

  for (const item of mappable) {
    const __id = idMap.get(item.id)!;
    const frame = frames.get(item.id)!;
    const data = item.data ?? {};
    const style = item.style ?? {};

    if (item.type === 'sticky_note') {
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind: 'roundRect',
          fill: { kind: 'srgb', value: stickyHex(str(style.fillColor)) },
          text: {
            blocks: miroHtmlToBlocks(str(data.content)),
            verticalAnchor: 'middle',
            autofit: 'shrink',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'shape') {
      const { kind, known } = miroShapeKind(str(data.shape));
      if (!known) bump('shape-kind');
      const borderWidth = num(style.borderWidth);
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind,
          fill: { kind: 'srgb', value: str(style.fillColor) ?? '#ffffff' },
          ...(borderWidth && borderWidth > 0
            ? { stroke: { color: str(style.borderColor) ?? '#1a1a1a', width: borderWidth } }
            : {}),
          text: {
            blocks: miroHtmlToBlocks(str(data.content)),
            verticalAnchor: 'middle',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'text') {
      inits.push({
        __id,
        type: 'text',
        frame,
        data: { blocks: miroHtmlToBlocks(str(data.content)) },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'image') {
      const src = str(data.imageUrl);
      if (!src) { bump('image'); continue; }
      inits.push({
        __id, type: 'image', frame, data: { src },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'frame') {
      // A board has no container concept — a frame becomes a labelled region.
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind: 'rect',
          fill: { kind: 'srgb', value: '#FFFFFF' },
          stroke: { color: '#B0B7C3', width: 1 },
          text: {
            blocks: miroHtmlToBlocks(str(data.title)),
            verticalAnchor: 'top',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    // card | app_card
    const title = str(data.title) ?? '';
    const description = str(data.description) ?? '';
    const html = [title ? `<p>${title}</p>` : '', description ? `<p>${description}</p>` : ''].join('');
    inits.push({
      __id,
      type: 'shape',
      frame,
      data: {
        kind: 'roundRect',
        fill: { kind: 'srgb', value: '#FFFFFF' },
        stroke: { color: str(style.cardTheme) ?? str(style.fillColor) ?? '#2d9bf0', width: 2 },
        text: { blocks: miroHtmlToBlocks(html), verticalAnchor: 'top' },
      },
    } as ElementInit & { __id: string });
  }

  // --- connectors ---
  for (const connector of input.connectors) {
    const startId = connector.startItem?.id;
    const endId = connector.endItem?.id;
    const startElement = startId ? idMap.get(startId) : undefined;
    const endElement = endId ? idMap.get(endId) : undefined;

    // Nothing to anchor to on either end — the connector would float at the
    // origin, which is worse than reporting it.
    if (!startElement && !endElement) {
      bump('connector');
      continue;
    }

    const centreOf = (miroId: string | undefined): { x: number; y: number } => {
      const f = miroId ? frames.get(miroId) : undefined;
      return f ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : { x: 0, y: 0 };
    };

    const endpoint = (elementId: string | undefined, otherMiroId: string | undefined): Endpoint =>
      elementId
        ? { kind: 'attached', elementId, siteIndex: 0 }
        : { kind: 'free', ...centreOf(otherMiroId) };

    const style = connector.style ?? {};
    const strokeWidth = num(style.strokeWidth);
    inits.push({
      __id: generateId(),
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: routingOf(connector.shape),
      start: endpoint(startElement, startId),
      end: endpoint(endElement, endId),
      arrowheads: {
        ...(str(style.startStrokeCap) && str(style.startStrokeCap) !== 'none'
          ? { start: { kind: 'triangle', size: 'md' } }
          : {}),
        ...(str(style.endStrokeCap) !== 'none'
          ? { end: { kind: 'triangle', size: 'md' } }
          : {}),
      },
      ...(strokeWidth
        ? { stroke: { color: str(style.strokeColor) ?? '#000000', width: strokeWidth } }
        : {}),
    } as ElementInit & { __id: string });
  }

  return { inits, skipped };
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/board test -- map-items`
Expected: PASS (9 tests).

- [x] **Step 6: Export from the barrel and add the package to the test fan-out**

`packages/board/src/index.ts` — append:

```ts
export * from './import/miro/map-items';
export * from './import/miro/types';
```

Root `package.json`: the `verify:fast` script chains per-package `test` calls. Add board alongside the others so its suite runs in the gate — insert `pnpm --filter @wafflebase/board typecheck && pnpm --filter @wafflebase/board test &&` into the `verify:fast` chain (mirror the exact style of the neighbouring `@wafflebase/notes` entries).

- [x] **Step 7: Verify the package builds and the gate includes it**

Run: `pnpm --filter @wafflebase/board build`
Run: `pnpm --filter @wafflebase/board test`
Run: `pnpm verify:fast`
Expected: all green, and the board suite visibly runs in `verify:fast`.

- [x] **Step 8: Commit**

```bash
git add packages/board/src/ package.json
git commit -m "Map Miro items and connectors to board elements"
```

---

### Task 6: Headless persistence — `board` branch in `applyImportedContent`

**Files:**
- Modify: `packages/frontend/src/app/documents/apply-imported-content.ts`
- Test: `packages/frontend/src/app/documents/apply-imported-content-board.test.ts`

**Interfaces:**
- Consumes: `mapMiroItems`'s `inits` (Task 5) — `(ElementInit & { __id?: string })[]`.
- Produces: `ImportedContent` gains `| { type: "board"; elements: ElementInit[] }`; `applyImportedContent(docId, content)` handles it.

**Note:** the board docKey is `` `board-${docId}` `` and the seed is `initialBoardRoot()` (`@/types/board-document`). `YorkieBoardStore` subscribes to the doc in its constructor, so call `store.dispose()` before `client.detach(doc)`. Every mutation must be inside `store.batch(...)` or it throws `Mutations must be wrapped in batch()`.

- [x] **Step 1: Write the failing test**

```ts
// packages/frontend/src/app/documents/apply-imported-content-board.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyBoardElements } from './apply-imported-content';
import type { ElementInit } from '@wafflebase/slides';

describe('applyBoardElements', () => {
  it('adds every element inside a single batch, on the synthetic slide', () => {
    const calls: { slideId: string; init: ElementInit }[] = [];
    let batches = 0;
    const store = {
      batch: (fn: () => void) => { batches++; fn(); },
      addElement: (slideId: string, init: ElementInit) => {
        calls.push({ slideId, init });
        return 'new-id';
      },
    };

    const elements = [
      { type: 'shape', frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, data: { kind: 'rect' } },
      { type: 'text', frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, data: { blocks: [] } },
    ] as unknown as ElementInit[];

    applyBoardElements(store as never, elements);

    expect(batches).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].slideId).toBe('board');
  });

  it('strips the mapper-only __id before writing', () => {
    const seen: ElementInit[] = [];
    const store = {
      batch: (fn: () => void) => fn(),
      addElement: (_s: string, init: ElementInit) => { seen.push(init); return 'x'; },
    };

    applyBoardElements(store as never, [
      { __id: 'tmp', type: 'shape', frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, data: { kind: 'rect' } },
    ] as unknown as ElementInit[]);

    expect(seen[0]).not.toHaveProperty('__id');
  });

  it('no-ops on an empty element list without opening a batch', () => {
    const batch = vi.fn();
    applyBoardElements({ batch, addElement: vi.fn() } as never, []);
    expect(batch).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- apply-imported-content-board`
Expected: FAIL — `applyBoardElements` is not exported.

- [x] **Step 3: Add the exported helper + the board branch**

In `apply-imported-content.ts`, extend the imports:

```ts
import type { ElementInit, SlidesStore } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { initialBoardRoot, type YorkieBoardRoot } from "@/types/board-document";
import { YorkieBoardStore } from "@/app/board/yorkie-board-store";
```

Extend the union:

```ts
export type ImportedContent =
  | { type: "sheet"; document: SpreadsheetDocument }
  | { type: "doc"; document: DocsDocument }
  | { type: "slides"; document: SlidesDocument }
  | { type: "board"; elements: ElementInit[] };
```

Add the docKey case in `buildDocKey`:

```ts
    case "board":
      return `board-${docId}`;
```

Add the exported helper (unit-testable without Yorkie):

```ts
/**
 * Write every mapped element onto the board in ONE batch — a single Yorkie
 * change and a single undo unit. Driving the store (rather than assigning
 * `root.elements` directly) reuses its connector-frame computation and
 * text/connector normalization.
 *
 * `__id` is the mapper's internal handle for wiring connector endpoints; it is
 * not part of the model, so it is stripped here.
 */
export function applyBoardElements(
  store: Pick<SlidesStore, "batch" | "addElement">,
  elements: ElementInit[],
): void {
  if (elements.length === 0) return;
  store.batch(() => {
    for (const element of elements) {
      const { __id: _ignored, ...init } = element as ElementInit & { __id?: string };
      store.addElement(SYNTHETIC_SLIDE_ID, init as ElementInit);
    }
  });
}
```

And the branch inside `applyImportedContent`, alongside the `doc` branch:

```ts
    } else if (content.type === "board") {
      const doc = new Document<YorkieBoardRoot>(docKey);
      await client.attach(doc, { initialRoot: initialBoardRoot() });
      const store = new YorkieBoardStore(doc);
      try {
        applyBoardElements(store, content.elements);
      } finally {
        // The store subscribes to the doc in its constructor — release it
        // before detaching.
        store.dispose();
      }
      await client.detach(doc);
    } else if (content.type === "slides") {
```

> The existing final `else` is the slides branch; convert it to `else if (content.type === "slides")` as shown so the union stays exhaustive, or keep slides as the trailing `else` and put the board branch above it. Either is fine — just don't leave `board` falling into the slides branch.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- apply-imported-content-board`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/apply-imported-content.ts packages/frontend/src/app/documents/apply-imported-content-board.test.ts
git commit -m "Persist imported board elements headlessly in one batch"
```

---

### Task 7: Frontend API client + import dialog + menu entry

**Files:**
- Create: `packages/frontend/src/api/miro.ts`
- Create: `packages/frontend/src/app/documents/miro-import-dialog.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Test: `packages/frontend/src/api/miro.test.ts`

**Interfaces:**
- Consumes: `mapMiroItems` (Task 5), `applyImportedContent` with the `board` type (Task 6), `createDocument` / `createWorkspaceDocument`, `getDocumentPath`.
- Produces: `importMiroBoard(workspaceId, { token, boardUrl }): Promise<MiroImportResult>`; `<MiroImportDialog open onOpenChange workspaceId folderId />`.

**Note:** call the backend through `fetchWithAuth` from `@/api/auth` + `assertOk` from `@/api/http-error` (the repo's established pair). The documents list's Rename dialog (`document-list.tsx`) is the dialog template to mirror: controlled `open`, `<DialogContent className="sm:max-w-md">`, a `<form onSubmit>`, `<Label>`/`<Input>`, `<DialogFooter>` with Cancel + submit buttons.

- [x] **Step 1: Write the failing API test**

```ts
// packages/frontend/src/api/miro.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('@/api/auth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

import { importMiroBoard } from './miro';

describe('importMiroBoard', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('posts the token and board url to the workspace-scoped endpoint', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], connectors: [], notes: [] }),
    });

    await importMiroBoard('ws-1', { token: 'tok', boardUrl: 'https://miro.com/app/board/B=/' });

    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toContain('/workspaces/ws-1/miro/import');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: 'tok',
      boardUrl: 'https://miro.com/app/board/B=/',
    });
  });

  it('throws with the server message on failure', async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'The Miro token was rejected (invalid or expired)' }),
      text: async () => '{"message":"The Miro token was rejected (invalid or expired)"}',
    });

    await expect(
      importMiroBoard('ws-1', { token: 'bad', boardUrl: 'B=' }),
    ).rejects.toThrow(/Miro token/i);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- api/miro`
Expected: FAIL — cannot find module `./miro`.

- [x] **Step 3: Write the API client**

```ts
// packages/frontend/src/api/miro.ts
import { fetchWithAuth } from "@/api/auth";
import { assertOk } from "@/api/http-error";
import type { MiroItemLike, MiroConnectorLike } from "@wafflebase/board";

export interface MiroImportNote {
  reason: string;
  itemType?: string;
  count: number;
}

export interface MiroImportResult {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
  notes: MiroImportNote[];
}

/**
 * Ask the backend to read a Miro board on the user's behalf.
 *
 * The token is sent once and used server-side only — it is never stored here,
 * never put in the URL (which would land in logs/history), and never written
 * into the document.
 */
export async function importMiroBoard(
  workspaceId: string,
  payload: { token: string; boardUrl: string },
): Promise<MiroImportResult> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${workspaceId}/miro/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, "Failed to import the Miro board");
  return res.json();
}
```

> Check `assertOk`'s behavior in `@/api/http-error` — if it does not surface the server's `message` field, the second test will fail. In that case, read the body here and throw an `Error` with the server message, falling back to the generic string. Match whatever the neighbouring API modules do.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- api/miro`
Expected: PASS (2 tests).

- [x] **Step 5: Write the dialog**

```tsx
// packages/frontend/src/app/documents/miro-import-dialog.tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { mapMiroItems } from "@wafflebase/board";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importMiroBoard } from "@/api/miro";
import { createDocument } from "@/api/documents";
import { createWorkspaceDocument } from "@/api/workspaces";
import { applyImportedContent } from "./apply-imported-content";
import { getDocumentPath } from "./document-list-utils";

interface MiroImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  folderId?: string | null;
}

type Phase = "idle" | "fetching" | "creating";

/**
 * Import a Miro board into a new board document.
 *
 * The token is held in local component state for the single request and never
 * persisted — the copy in the dialog says so, because asking for a credential
 * without saying what happens to it is not acceptable.
 */
export function MiroImportDialog({
  open,
  onOpenChange,
  workspaceId,
  folderId,
}: MiroImportDialogProps) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    const form = new FormData(e.target as HTMLFormElement);
    const token = String(form.get("token") ?? "").trim();
    const boardUrl = String(form.get("boardUrl") ?? "").trim();
    if (!token || !boardUrl) return;

    setError(null);
    setPhase("fetching");
    try {
      const result = await importMiroBoard(workspaceId, { token, boardUrl });
      const { inits, skipped } = mapMiroItems({
        items: result.items,
        connectors: result.connectors,
      });

      setPhase("creating");
      const doc = await createWorkspaceDocument(workspaceId, {
        title: "Imported Miro board",
        type: "board",
        folderId: folderId ?? undefined,
      });
      await applyImportedContent(doc.id, { type: "board", elements: inits });

      const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
      const failedImages = result.notes.find((n) => n.reason === "image-failed")?.count ?? 0;
      const truncated = result.notes.some((n) => n.reason === "truncated");
      if (skippedTotal || failedImages || truncated) {
        const parts: string[] = [];
        if (skippedTotal) {
          parts.push(
            Object.entries(skipped)
              .map(([type, count]) => `${count} ${type}`)
              .join(", ") + " skipped",
          );
        }
        if (failedImages) parts.push(`${failedImages} image(s) failed`);
        if (truncated) parts.push("board truncated at the import limit");
        toast.warning(`Imported with notes: ${parts.join("; ")}`);
      } else {
        toast.success("Miro board imported");
      }

      onOpenChange(false);
      navigate(getDocumentPath(doc));
    } catch (err) {
      // Keep the dialog open so the pasted values aren't lost.
      setError(err instanceof Error ? err.message : "Failed to import the Miro board");
    } finally {
      setPhase("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Import from Miro</DialogTitle>
            <DialogDescription>
              Paste a Miro access token and the board URL. The token is used for
              this import only — it is never stored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="miro-token">Access token</Label>
              <Input id="miro-token" name="token" type="password" autoFocus required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="miro-board-url">Board URL</Label>
              <Input
                id="miro-board-url"
                name="boardUrl"
                placeholder="https://miro.com/app/board/uXjVOD50NUI=/"
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !workspaceId}>
              {phase === "fetching"
                ? "Reading board…"
                : phase === "creating"
                  ? "Creating…"
                  : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MiroImportDialog;
```

> `createDocument` is imported above for the no-workspace fallback. If the documents list always has a `workspaceId` in the surfaces where this dialog is rendered, drop that import rather than leaving it unused (lint runs with `--max-warnings 0`).

- [x] **Step 6: Wire the menu entry**

In `document-list.tsx`:

1. Import the dialog and add state beside the other dialog state (e.g. near `renamingDoc`):

```tsx
import { MiroImportDialog } from "./miro-import-dialog";
```
```tsx
  const [miroImportOpen, setMiroImportOpen] = useState(false);
```

2. Give `ImportMenuItems` a second prop and add the entry after the existing items:

```tsx
function ImportMenuItems({
  onImport,
  onImportMiro,
}: {
  onImport: (accept: string) => void;
  onImportMiro: () => void;
}) {
```
```tsx
      <DropdownMenuItem onClick={onImportMiro}>
        <Frame className="mr-2 h-4 w-4 text-fuchsia-600" />
        Import from Miro…
      </DropdownMenuItem>
```

3. Pass it at **both** call sites (the toolbar dropdown and the empty-state dropdown):

```tsx
<ImportMenuItems onImport={handleImportPick} onImportMiro={() => setMiroImportOpen(true)} />
```

4. Render the dialog beside the other dialogs at the end of the component:

```tsx
      <MiroImportDialog
        open={miroImportOpen}
        onOpenChange={setMiroImportOpen}
        workspaceId={workspaceId}
        folderId={folderId}
      />
```

> `Frame` is already imported in this file (it's the New Board icon). Reuse it; don't add a second icon import for the same glyph.

- [x] **Step 7: Verify build, lint, and the full frontend suite**

Run: `pnpm --filter @wafflebase/frontend build`
Run: `pnpm --filter @wafflebase/frontend lint`
Run: `pnpm --filter @wafflebase/frontend test`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add packages/frontend/src/api/miro.ts packages/frontend/src/api/miro.test.ts packages/frontend/src/app/documents/miro-import-dialog.tsx packages/frontend/src/app/documents/document-list.tsx
git commit -m "Add the Miro import dialog and documents-list entry"
```

---

### Task 8: Final integration — verify, chunk gate, docs, lessons

**Files:**
- Possibly modify: `harness.config.json` (only if the frontend chunk gate trips)
- Modify: `packages/backend/README.md` (document the new endpoint)
- Modify: `docs/tasks/active/20260801-board-miro-import-lessons.md`

- [x] **Step 1: Run the fast gate**

Run: `pnpm verify:fast`
Expected: green across packages (now including `@wafflebase/board`). Fix any lint (unused imports are the usual offender).

- [x] **Step 2: Run the self gate**

Run: `pnpm verify:self`
Expected: all lanes green. **If `verify:frontend:chunks` fails on chunk COUNT**, the Miro dialog is a legitimate new lazy surface: bump `maxChunkCount` in `harness.config.json` and prepend a one-paragraph reason to `maxChunkCountReason` naming the Miro dialog + `@wafflebase/board` mapper as the new importers — the established repo pattern. Do NOT suppress a per-chunk KB failure that way; investigate that instead.

- [x] **Step 3: Document the endpoint**

In `packages/backend/README.md`, add a row to the API table (near the Documents/Folders sections):

```markdown
### Miro import

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/miro/import` | JWT (member) | Read a Miro board's items + connectors using a caller-supplied access token (`{ token, boardUrl }`). The token is used for this request only — never stored or logged. Images are re-hosted into the workspace image bucket. |
```

- [ ] **Step 4: Manual smoke**

`docker compose up -d` + `pnpm dev`. With a real Miro token (from a Miro developer app or a personal token with `boards:read`) and a board containing at least one sticky, shape, text item, connector, and image:
- Documents list → New/Import → "Import from Miro…" → paste token + URL → Import.
- Confirm a new board opens with the items positioned as in Miro; the connector links the same two shapes; the image renders (and its URL is a `/api/v1/workspaces/.../images/...` one, not `api.miro.com`).
- Confirm a bad token shows the "token was rejected" message in the dialog and the dialog stays open with values intact.
- Confirm a board containing an unsupported item (e.g. an embed) reports the skip in the toast.

- [x] **Step 5: Self code review over the branch diff**

Dispatch `/code-review` (or `superpowers:requesting-code-review`) over the full branch diff. Pay particular attention to: the token never appearing in a log, a response, or an error message; the image download using the token and `format=original`; and connectors resolving to the NEW element ids rather than Miro ids.

- [ ] **Step 6: Capture lessons and archive**

Lessons are captured; the archive move still runs at merge time. Fill in `docs/tasks/active/20260801-board-miro-import-lessons.md`, then `pnpm tasks:archive && pnpm tasks:index`. Commit the task docs together with `docs/tasks/README.md`.

- [x] **Step 7: Open the PR**

`git fetch && git rebase origin/main`; push; open a PR titled ≤70 chars (e.g. "Board SP3: import a Miro board into a new board document"), body = Summary + Test plan.

- [x] **Step 8: Real progress reporting (post-review follow-up)**

Reported as "the import is stuck": a 3000-element board is ~60 sequential paginated round trips plus up to 100 serial image downloads behind a static "Reading board…". Two commits:

1. **`Download Miro import images through a bounded-concurrency pool`** — `rehostImages` runs 6 workers over a shared cursor instead of one `await` per image. Output order preserved by writing results **by index** (the mapper's id map and frame z-order depend on it); the count ceiling stays exact (charged inside `rehostOne`, after the host check, before the first `await`); the byte ceiling is charged on completion, so a pool may overshoot it by `(concurrency - 1) x MAX_IMAGE_BYTES` and its test asserts a bound + a conservation law rather than an exact count. Tests added: forced reverse-completion order preserves feed order across a mixed success/failure batch; in-flight peak is `> 1` and `<= IMAGE_CONCURRENCY`.
2. **`Stream Miro import progress to the dialog as NDJSON`** — `application/x-ndjson`, one `{"type":"progress","stage",…}` line per page/image completion then exactly one `{"type":"result"}`. `MiroService` splits into `prepareImport` (board-id parse + the FIRST Miro call → 400/401/403/404/429, before a byte is written) and `runImport` (everything after, failures reported in-band as `{"type":"error"}` on a committed 200). Frontend: `importMiroBoard(ws, payload, onProgress)` with a pure line reader (`api/ndjson.ts`) handling split lines / multi-line chunks / no-trailing-newline / multi-byte UTF-8 boundaries; `MiroImportStreamError` for in-band failures; the dialog's Import button becomes the live readout.

Verified: backend 395, board 54, frontend 986, slides 2634, frontend lint clean, `pnpm verify:self` all 11 lanes. Incremental delivery proven over a **real socket** (Nest on an ephemeral port + `http.request` chunk timestamps), not just via `res.write` assertions.

---

## Self-Review

**Spec coverage:**
- Backend proxy: URL parse (T1), paginated items **and** connectors (T2), image re-host + controller + module (T3). ✓
- Token never stored/logged/returned: enforced in T2/T3 code + an explicit test in T2. ✓
- Pure mapper with two-pass id map: primitives (T4), items + connectors (T5). ✓
- Item coverage — sticky/shape/text/image/frame/card/app_card + connectors, unsupported skipped with counts: T5. ✓
- Geometry center→top-left, degrees→radians, 1:1: T4. ✓
- Named sticky colors → hex; HTML subset → Blocks: T4. ✓
- Headless persistence via one `YorkieBoardStore.batch`: T6. ✓
- UX entry + report surfacing: T7. ✓
- Verify lanes, chunk gate, endpoint docs, smoke, review, archive: T8. ✓

**Placeholder scan:** every code step carries real code; the three "confirm/check" notes (ImageModule exports, `assertOk` message behavior, unused `createDocument` import) are verification instructions with a named fallback, not deferred work. ✓

**Type consistency:** `MiroItem`/`MiroConnector`/`MiroImportNote`/`MiroImportResult` (T1) are what T2/T3 return and what T7's client types mirror; `MiroItemLike`/`MiroConnectorLike`/`MiroImportInput`/`MiroMapResult` (T5) are what T7 passes to `mapMiroItems`; `applyBoardElements(store, elements)` + `ImportedContent { type:"board"; elements }` (T6) are what T7 calls. `Frame` is `{x,y,w,h,rotation}` throughout; `miroFrame`/`miroShapeKind`/`stickyHex`/`miroHtmlToBlocks` (T4) match their T5 call sites. ✓
