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
    const res = await fetch(`${server}/auth/refresh`, {
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
   */
  private async send(
    url: string,
    build: (auth: Record<string, string>) => RequestInit,
  ): Promise<{ res: Response; sessionExpired: boolean }> {
    const res = await fetch(url, build(this.authHeaders));

    if (
      res.status === 401 &&
      this.config.authMode === 'jwt' &&
      this.config.refreshToken
    ) {
      if (!(await this.refreshSession())) {
        return { res, sessionExpired: true };
      }
      return {
        res: await fetch(url, build(this.authHeaders)),
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

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const { res, sessionExpired } = await this.send(
      `${this.base}${path}`,
      (auth) => ({
        method,
        headers: this.jsonHeaders(auth),
        body: body ? JSON.stringify(body) : undefined,
      }),
    );

    if (sessionExpired) {
      return { ok: false, status: 401, data: this.sessionExpiredBody<T>() };
    }

    const data = (await res.json().catch(() => null)) as T;
    return { ok: res.ok, status: res.status, data };
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

  // API Keys (management endpoints use different base — `apiKeysUrl()` is
  // shared with the `--dry-run` preview so the two cannot drift)
  async listApiKeys() {
    const url = apiKeysUrl(this.config);
    const res = await fetch(url, { headers: this.jsonHeaders() });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  async createApiKey(name: string) {
    const url = apiKeysUrl(this.config);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  async revokeApiKey(id: string) {
    const url = apiKeysUrl(this.config, id);
    const res = await fetch(url, { method: 'DELETE', headers: this.jsonHeaders() });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
}
