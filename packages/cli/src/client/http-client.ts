import type { Document } from '@wafflebase/docs';
import type { SlidesDocument } from '@wafflebase/slides/node';
import type { CliConfig } from '../config/config.js';
import { parseContentDispositionFilename } from './content-disposition.js';
// Every identifier interpolated into a request path goes through `seg()`,
// and the two non-v1 URL shapes come from the same builders the `--dry-run`
// preview prints — see `./url.js` for why escaping alone is not enough.
import { apiKeysUrl, apiV1Base, seg } from './url.js';
import {
  loadSession,
  saveSession,
  decodeJwtExpiry,
} from '../config/session.js';
import { fetchOrThrow } from '../errors.js';

/**
 * Canonical note content JSON exchanged with the content endpoint. A note's
 * whole content is a single markdown string — mirrors the backend's
 * `NoteDocument` (`packages/backend/src/yorkie/note-content.ts`).
 */
export interface NoteContent {
  content: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    command?: string;
  };
}

/** A blob document as returned by the files endpoint. */
export interface FileDocument {
  id: string;
  title: string;
  type: string;
  fileId?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
}

export interface BinaryResponse {
  ok: boolean;
  status: number;
  bytes?: Uint8Array;
  /** Filename advertised by `Content-Disposition`, if the server sent one. */
  fileName?: string;
  /** Parsed error envelope when the request failed. */
  data?: unknown;
}

/**
 * Worksheet payload types.
 *
 * These mirror the sheets engine's own types (`CellStyle`, `RangeStylePatch`,
 * `MergeSpan`, `SheetChart`, `WorksheetFilterState`, `PivotTableDefinition`)
 * and carry the engine's names so the two are greppable together — but they
 * are declared here rather than imported: `@wafflebase/sheets` is not in this
 * package's dependency graph, and every one of these values is relayed
 * verbatim between the caller's JSON and the API, which validates them
 * server-side with the engine's own normalizers. Only the fields this client
 * or its callers actually address are named; the rest stay open.
 */

/** A cell style object (`bold`, `backgroundColor`, …). */
export type CellStyle = Record<string, unknown>;

/** A grid coordinate — 1-based row and column (the engine's `Ref`). */
export interface CellRef {
  r: number;
  c: number;
}

/** One entry of the compact range-style layer. */
export interface RangeStylePatch {
  range: [CellRef, CellRef];
  style: CellStyle;
}

/** Span of a merged block, keyed in `merges` by its top-left cell ref. */
export interface MergeSpan {
  rs: number;
  cs: number;
}

/** A chart on a worksheet; the collection is keyed by `id` server-side. */
export type SheetChart = { id: string } & Record<string, unknown>;

/** A conditional-format or a data-validation rule. */
export type WorksheetRule = Record<string, unknown>;

/** A worksheet's filter state (`startRow`/`endRow`/`columns`/`hiddenRows`…). */
export type WorksheetFilterState = Record<string, unknown>;

/** A worksheet's pivot definition (`id`/`sourceRange`/`rowFields`…). */
export type PivotTableDefinition = Record<string, unknown>;

/** The axis a structural row/column operation runs along. */
export type WorksheetAxis = 'row' | 'column';

/** A row/column insert or delete. All indices are 1-based. */
export interface AxisShift {
  axis: WorksheetAxis;
  index: number;
  count: number;
}

/** A row/column move: `count` entries from `srcIndex` to before `dstIndex`. */
export interface AxisMove {
  axis: WorksheetAxis;
  srcIndex: number;
  count: number;
  dstIndex: number;
}

/** An image stored in the workspace image bucket. */
export interface WorkspaceImage {
  id: string;
  /** Workspace-scoped read path, e.g. `/api/v1/workspaces/ws/images/<id>`. */
  url: string;
}

export class HttpClient {
  constructor(private config: CliConfig) {}

  /** Auth only — kept separate so multipart requests can omit Content-Type
   *  and let fetch generate the boundary. */
  private get authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};

    if (this.config.authMode === 'api-key' && this.config.apiKey) {
      h['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (this.config.authMode === 'jwt' && this.config.accessToken) {
      h['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    return h;
  }

  /**
   * Auth plus the JSON content type — the single definition of a JSON
   * request's headers. `send()` hands its per-attempt auth headers in;
   * everything else takes the current ones.
   */
  private jsonHeaders(
    auth: Record<string, string> = this.authHeaders,
  ): Record<string, string> {
    return { 'Content-Type': 'application/json', ...auth };
  }

  private get base(): string {
    return apiV1Base(this.config);
  }

  /**
   * Attempt to refresh the JWT session. Returns true on success.
   */
  private async refreshSession(): Promise<boolean> {
    if (!this.config.refreshToken) return false;

    const server = this.config.server.replace(/\/$/, '');
    const res = await fetchOrThrow(`${server}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.config.refreshToken }),
    });

    if (!res.ok) return false;

    const data = (await res.json().catch(() => null)) as {
      accessToken?: string;
      refreshToken?: string;
    } | null;

    if (!data?.accessToken || !data?.refreshToken) return false;

    // Update in-memory config
    this.config.accessToken = data.accessToken;
    this.config.refreshToken = data.refreshToken;

    // Persist refreshed tokens to session file (if it exists).
    // If the session file is missing the in-memory config is already
    // updated, so the current process will keep working; the user can
    // run `wafflebase login` to recreate the session file.
    const session = loadSession();
    if (session) {
      session.accessToken = data.accessToken;
      session.refreshToken = data.refreshToken;
      session.expiresAt = decodeJwtExpiry(data.accessToken);
      saveSession(session);
    }

    return true;
  }

  /**
   * Send a request, retrying once with a refreshed session on a 401 under JWT
   * auth. `build` is invoked per attempt so the retry picks up the new access
   * token — and so a multipart body is rebuilt rather than replayed.
   *
   * `fetchOrThrow` rather than a bare `fetch`, so a request that never
   * reached an HTTP server (DNS, refused connection, TLS) raises a
   * `SystemError` and exits `2` — every request the CLI makes, including
   * the multipart file endpoints, is classified the same way.
   */
  private async send(
    url: string,
    build: (auth: Record<string, string>) => RequestInit,
  ): Promise<{ res: Response; sessionExpired: boolean }> {
    const res = await fetchOrThrow(url, build(this.authHeaders));

    if (
      res.status === 401 &&
      this.config.authMode === 'jwt' &&
      this.config.refreshToken
    ) {
      if (!(await this.refreshSession())) {
        return { res, sessionExpired: true };
      }
      return {
        res: await fetchOrThrow(url, build(this.authHeaders)),
        sessionExpired: false,
      };
    }

    return { res, sessionExpired: false };
  }

  /** The envelope returned when the session could not be refreshed. */
  private sessionExpiredBody<T>(): T {
    return {
      error: {
        code: 'SESSION_EXPIRED',
        message: 'Session expired. Run `wafflebase login`.',
      },
    } as T;
  }

  /**
   * One authenticated JSON round trip against an absolute URL. Every JSON
   * endpoint goes through here — the workspace-scoped `/api/v1` ones via
   * `request()` and the management endpoints (API keys) with their own
   * base — so all of them refresh a JWT session on a 401 and report the
   * same `SESSION_EXPIRED` envelope when the refresh fails. The management
   * endpoints used to call `fetch` directly, which made `api-keys` the one
   * namespace where an expired session surfaced as whatever the backend's
   * 401 body happened to be.
   */
  private async sendJson<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const { res, sessionExpired } = await this.send(url, (auth) => ({
      method,
      headers: this.jsonHeaders(auth),
      body: body ? JSON.stringify(body) : undefined,
    }));

    if (sessionExpired) {
      return { ok: false, status: 401, data: this.sessionExpiredBody<T>() };
    }

    const data = (await res.json().catch(() => null)) as T;
    return { ok: res.ok, status: res.status, data };
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    return this.sendJson<T>(method, `${this.base}${path}`, body);
  }

  // Documents
  listDocuments() {
    return this.request<unknown[]>('GET', '/documents');
  }
  createDocument(title: string, type?: 'doc' | 'sheet' | 'slides' | 'note') {
    const body: { title: string; type?: 'doc' | 'sheet' | 'slides' | 'note' } =
      { title };
    if (type) body.type = type;
    return this.request('POST', '/documents', body);
  }
  getDocument(id: string) {
    return this.request('GET', `/documents/${seg(id)}`);
  }
  updateDocument(id: string, title: string) {
    return this.request('PATCH', `/documents/${seg(id)}`, { title });
  }
  deleteDocument(id: string) {
    return this.request('DELETE', `/documents/${seg(id)}`);
  }

  // Files (blob documents) — no CRDT content, just bytes. Upload stores the
  // blob and creates the document in one call; see the controller comment in
  // `packages/backend/src/api/v1/files.controller.ts` for why it is not the
  // browser's two-step flow.
  async uploadFileDocument(
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
    fields: { title?: string; folderId?: string } = {},
  ): Promise<ApiResponse<FileDocument>> {
    const { res, sessionExpired } = await this.send(
      `${this.base}/files`,
      (auth) => {
        // Built per attempt: a FormData body is consumed by the first send.
        const form = new FormData();
        // A Blob part must be `Uint8Array<ArrayBuffer>`; a Node `Buffer` is
        // typed over `ArrayBufferLike` to admit `SharedArrayBuffer`, which
        // `readFileSync` never returns. Re-view the same memory rather than
        // copying — these bytes can be 50 MB.
        const part = new Uint8Array(
          bytes.buffer as ArrayBuffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        form.append('file', new Blob([part], { type: mimeType }), fileName);
        if (fields.title) form.append('title', fields.title);
        if (fields.folderId) form.append('folderId', fields.folderId);
        // No Content-Type — fetch sets it with the multipart boundary.
        return { method: 'POST', headers: auth, body: form };
      },
    );

    if (sessionExpired) {
      return {
        ok: false,
        status: 401,
        data: this.sessionExpiredBody<FileDocument>(),
      };
    }

    const data = (await res.json().catch(() => null)) as FileDocument;
    return { ok: res.ok, status: res.status, data };
  }

  async downloadFileDocument(docId: string): Promise<BinaryResponse> {
    const { res, sessionExpired } = await this.send(
      `${this.base}/files/${seg(docId)}`,
      (auth) => ({ method: 'GET', headers: auth }),
    );

    if (sessionExpired) {
      return { ok: false, status: 401, data: this.sessionExpiredBody() };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: await res.json().catch(() => null),
      };
    }

    return {
      ok: true,
      status: res.status,
      bytes: new Uint8Array(await res.arrayBuffer()),
      fileName: parseContentDispositionFilename(
        res.headers.get('content-disposition'),
      ),
    };
  }

  // Docs (word-processor) content
  getDocContent(docId: string) {
    return this.request<Document>(
      'GET',
      `/documents/${seg(docId)}/content`,
    );
  }
  putDocContent(docId: string, doc: Document) {
    return this.request<Document>(
      'PUT',
      `/documents/${seg(docId)}/content`,
      doc,
    );
  }

  // Slides content — same endpoint as docs; the backend dispatches on
  // the persisted document type, picking the docs writer for `'doc'`
  // and the slides writer for `'slides'`.
  getSlidesContent(docId: string) {
    return this.request<SlidesDocument>(
      'GET',
      `/documents/${seg(docId)}/content`,
    );
  }
  putSlidesContent(docId: string, deck: SlidesDocument) {
    return this.request<SlidesDocument>(
      'PUT',
      `/documents/${seg(docId)}/content`,
      deck,
    );
  }

  // Notes content — same endpoint as docs/slides; the backend dispatches
  // on the persisted document type, picking the note writer for `'note'`.
  // A note's content is a single markdown string (`{ content }`).
  getNoteContent(docId: string) {
    return this.request<NoteContent>(
      'GET',
      `/documents/${seg(docId)}/content`,
    );
  }
  putNoteContent(docId: string, note: NoteContent) {
    return this.request<NoteContent>(
      'PUT',
      `/documents/${seg(docId)}/content`,
      note,
    );
  }

  // Tabs
  listTabs(docId: string) {
    return this.request<unknown[]>('GET', `/documents/${seg(docId)}/tabs`);
  }
  createTab(docId: string, body: { name?: string; type?: string }) {
    return this.request('POST', `/documents/${seg(docId)}/tabs`, body);
  }
  renameTab(docId: string, tabId: string, name: string) {
    return this.request('PATCH', `/documents/${seg(docId)}/tabs/${seg(tabId)}`, {
      name,
    });
  }

  // Cells
  getCells(docId: string, tabId: string, range?: string) {
    const query = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/cells${query}`,
    );
  }
  getCell(docId: string, tabId: string, sref: string) {
    return this.request(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/cells/${seg(sref)}`,
    );
  }
  setCell(docId: string, tabId: string, sref: string, value?: string, formula?: string) {
    return this.request(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/cells/${seg(sref)}`,
      { value, formula },
    );
  }
  deleteCell(docId: string, tabId: string, sref: string) {
    return this.request(
      'DELETE',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/cells/${seg(sref)}`,
    );
  }
  batchCells(
    docId: string,
    tabId: string,
    cells: Record<string, { value?: string; formula?: string } | null>,
  ) {
    return this.request(
      'PATCH',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/cells`,
      { cells },
    );
  }

  // Worksheet formatting — the range-style layer and the single sheet-wide
  // style. A PUT replaces the range-style list outright; the sheet style
  // merges onto the stored one, and `null` clears it (an omitted `style` is a
  // 400 server-side, which is why it is a required argument here).
  getRangeStyles(docId: string, tabId: string) {
    return this.request<{ rangeStyles: RangeStylePatch[] }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/range-styles`,
    );
  }
  setRangeStyles(
    docId: string,
    tabId: string,
    rangeStyles: RangeStylePatch[],
  ) {
    return this.request<{ rangeStyles: RangeStylePatch[] }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/range-styles`,
      { rangeStyles },
    );
  }
  getSheetStyle(docId: string, tabId: string) {
    return this.request<{ style: CellStyle | null }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/sheet-style`,
    );
  }
  setSheetStyle(docId: string, tabId: string, style: CellStyle | null) {
    return this.request<{ style: CellStyle | null }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/sheet-style`,
      { style },
    );
  }

  // Worksheet dimensions — whole-column and whole-row styles and sizes. Every
  // map is keyed by the 1-based column/row index rendered as a string (`"1"` =
  // column A / the first row). A PUT merges per index; a `null` value clears
  // that index rather than setting it.
  getColumnStyles(docId: string, tabId: string) {
    return this.request<{ columnStyles: Record<string, CellStyle> }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/column-styles`,
    );
  }
  setColumnStyles(
    docId: string,
    tabId: string,
    columnStyles: Record<string, CellStyle | null>,
  ) {
    return this.request<{ columnStyles: Record<string, CellStyle> }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/column-styles`,
      { columnStyles },
    );
  }
  getRowStyles(docId: string, tabId: string) {
    return this.request<{ rowStyles: Record<string, CellStyle> }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/row-styles`,
    );
  }
  setRowStyles(
    docId: string,
    tabId: string,
    rowStyles: Record<string, CellStyle | null>,
  ) {
    return this.request<{ rowStyles: Record<string, CellStyle> }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/row-styles`,
      { rowStyles },
    );
  }
  getColumnWidths(docId: string, tabId: string) {
    return this.request<{ columnWidths: Record<string, number> }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/column-widths`,
    );
  }
  setColumnWidths(
    docId: string,
    tabId: string,
    columnWidths: Record<string, number | null>,
  ) {
    return this.request<{ columnWidths: Record<string, number> }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/column-widths`,
      { columnWidths },
    );
  }
  getRowHeights(docId: string, tabId: string) {
    return this.request<{ rowHeights: Record<string, number> }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/row-heights`,
    );
  }
  setRowHeights(
    docId: string,
    tabId: string,
    rowHeights: Record<string, number | null>,
  ) {
    return this.request<{ rowHeights: Record<string, number> }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/row-heights`,
      { rowHeights },
    );
  }

  // Worksheet rules — conditional formats and data validations. Both endpoints
  // speak the same `{ rules }` envelope, and a PUT replaces the whole array.
  getConditionalFormats(docId: string, tabId: string) {
    return this.request<{ rules: WorksheetRule[] }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/conditional-formats`,
    );
  }
  setConditionalFormats(
    docId: string,
    tabId: string,
    rules: WorksheetRule[],
  ) {
    return this.request<{ rules: WorksheetRule[] }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/conditional-formats`,
      { rules },
    );
  }
  getDataValidations(docId: string, tabId: string) {
    return this.request<{ rules: WorksheetRule[] }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/data-validations`,
    );
  }
  setDataValidations(docId: string, tabId: string, rules: WorksheetRule[]) {
    return this.request<{ rules: WorksheetRule[] }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/data-validations`,
      { rules },
    );
  }

  // Worksheet filter and pivot. Each is a single object; `null` clears it, and
  // an omitted key is a 400 server-side rather than a clear — hence the
  // required argument, exactly as for `setSheetStyle`.
  getFilter(docId: string, tabId: string) {
    return this.request<{ filter: WorksheetFilterState | null }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/filter`,
    );
  }
  setFilter(
    docId: string,
    tabId: string,
    filter: WorksheetFilterState | null,
  ) {
    return this.request<{ filter: WorksheetFilterState | null }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/filter`,
      { filter },
    );
  }
  getPivot(docId: string, tabId: string) {
    return this.request<{ pivot: PivotTableDefinition | null }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/pivot`,
    );
  }
  setPivot(docId: string, tabId: string, pivot: PivotTableDefinition | null) {
    return this.request<{ pivot: PivotTableDefinition | null }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/pivot`,
      { pivot },
    );
  }

  // Worksheet settings — freeze panes, hidden rows/columns, merged cells and
  // charts. Freeze and hidden take the payload as the body itself (no envelope
  // key); merges and charts are enveloped, and both PUTs replace the whole
  // collection, so an omitted merge or chart is deleted.
  getFreeze(docId: string, tabId: string) {
    return this.request<{ rows: number; cols: number }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/freeze`,
    );
  }
  setFreeze(
    docId: string,
    tabId: string,
    freeze: { rows?: number; cols?: number },
  ) {
    return this.request<{ rows: number; cols: number }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/freeze`,
      freeze,
    );
  }
  getHidden(docId: string, tabId: string) {
    return this.request<{ rows: number[]; columns: number[] }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/hidden`,
    );
  }
  setHidden(
    docId: string,
    tabId: string,
    hidden: { rows?: number[]; columns?: number[] },
  ) {
    return this.request<{ rows: number[]; columns: number[] }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/hidden`,
      hidden,
    );
  }
  getMerges(docId: string, tabId: string) {
    return this.request<{ merges: Record<string, MergeSpan> }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/merges`,
    );
  }
  setMerges(
    docId: string,
    tabId: string,
    merges: Record<string, MergeSpan>,
  ) {
    return this.request<{ merges: Record<string, MergeSpan> }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/merges`,
      { merges },
    );
  }
  getCharts(docId: string, tabId: string) {
    return this.request<{ charts: SheetChart[] }>(
      'GET',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/charts`,
    );
  }
  setCharts(docId: string, tabId: string, charts: SheetChart[]) {
    return this.request<{ charts: SheetChart[] }>(
      'PUT',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/charts`,
      { charts },
    );
  }

  // Worksheet structure — clearing a range, and inserting, deleting or moving
  // rows and columns. Each verb echoes the request back on success; `clear`
  // reports how many cells it emptied. All indices are 1-based.
  clearRange(docId: string, tabId: string, range: string) {
    return this.request<{ cleared: number }>(
      'POST',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/clear`,
      { range },
    );
  }
  insertAxis(docId: string, tabId: string, shift: AxisShift) {
    return this.request<AxisShift>(
      'POST',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/insert`,
      shift,
    );
  }
  deleteAxis(docId: string, tabId: string, shift: AxisShift) {
    return this.request<AxisShift>(
      'POST',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/delete`,
      shift,
    );
  }
  moveAxis(docId: string, tabId: string, move: AxisMove) {
    return this.request<AxisMove>(
      'POST',
      `/documents/${seg(docId)}/tabs/${seg(tabId)}/move`,
      move,
    );
  }

  // Workspace images — the bucket the slides/board/docs renderers fetch an
  // embedded image from. Upload is multipart like `uploadFileDocument`, and
  // download is binary like `downloadFileDocument`; unlike the file endpoint
  // the read route sends no `Content-Disposition`, so `fileName` is normally
  // absent and the caller names the file itself.
  async uploadImage(
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
  ): Promise<ApiResponse<WorkspaceImage>> {
    const { res, sessionExpired } = await this.send(
      `${this.base}/images`,
      (auth) => {
        // Built per attempt: a FormData body is consumed by the first send.
        const form = new FormData();
        // A Blob part must be `Uint8Array<ArrayBuffer>`; see
        // `uploadFileDocument` for why a Node `Buffer` is re-viewed rather
        // than copied.
        const part = new Uint8Array(
          bytes.buffer as ArrayBuffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        form.append('file', new Blob([part], { type: mimeType }), fileName);
        // No Content-Type — fetch sets it with the multipart boundary.
        return { method: 'POST', headers: auth, body: form };
      },
    );

    if (sessionExpired) {
      return {
        ok: false,
        status: 401,
        data: this.sessionExpiredBody<WorkspaceImage>(),
      };
    }

    const data = (await res.json().catch(() => null)) as WorkspaceImage;
    return { ok: res.ok, status: res.status, data };
  }

  async downloadImage(imageId: string): Promise<BinaryResponse> {
    const { res, sessionExpired } = await this.send(
      `${this.base}/images/${seg(imageId)}`,
      (auth) => ({ method: 'GET', headers: auth }),
    );

    if (sessionExpired) {
      return { ok: false, status: 401, data: this.sessionExpiredBody() };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: await res.json().catch(() => null),
      };
    }

    return {
      ok: true,
      status: res.status,
      bytes: new Uint8Array(await res.arrayBuffer()),
      fileName: parseContentDispositionFilename(
        res.headers.get('content-disposition'),
      ),
    };
  }

  deleteImage(imageId: string) {
    return this.request<{ deleted: boolean }>(
      'DELETE',
      `/images/${seg(imageId)}`,
    );
  }

  // API Keys. These management endpoints sit outside the `/api/v1` base, but
  // go through the same authenticated round trip (see `sendJson`), so the 401
  // refresh and the SESSION_EXPIRED envelope apply here too. The URL comes
  // from `apiKeysUrl()`, shared with the `--dry-run` preview so the two
  // cannot drift.
  listApiKeys() {
    return this.sendJson('GET', apiKeysUrl(this.config));
  }
  createApiKey(name: string) {
    return this.sendJson('POST', apiKeysUrl(this.config), { name });
  }
  revokeApiKey(id: string) {
    return this.sendJson('DELETE', apiKeysUrl(this.config, id));
  }
}
