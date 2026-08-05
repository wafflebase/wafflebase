import type { Document } from '@wafflebase/docs';
import type { SlidesDocument } from '@wafflebase/slides/node';
import type { CliConfig } from '../config/config.js';
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

export class HttpClient {
  constructor(private config: CliConfig) {}

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.authMode === 'api-key' && this.config.apiKey) {
      h['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (this.config.authMode === 'jwt' && this.config.accessToken) {
      h['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    return h;
  }

  private get base(): string {
    const server = this.config.server.replace(/\/$/, '');
    return `${server}/api/v1/workspaces/${this.config.workspace}`;
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

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    return this.send<T>(method, `${this.base}${path}`, body);
  }

  /**
   * One authenticated round trip, including the 401 refresh-and-retry.
   * Every endpoint goes through here — the workspace-scoped `/api/v1`
   * ones via `request()` and the management endpoints (API keys) with
   * their own absolute URL — so a refreshable session is never reported
   * as an auth failure just because of which base a call used.
   */
  private async send<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const res = await fetchOrThrow(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-refresh on 401 for JWT auth (one attempt only)
    if (
      res.status === 401 &&
      this.config.authMode === 'jwt' &&
      this.config.refreshToken
    ) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        // Retry the original request with new token
        const retryRes = await fetchOrThrow(url, {
          method,
          headers: this.headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const retryData = (await retryRes.json().catch(() => null)) as T;
        return { ok: retryRes.ok, status: retryRes.status, data: retryData };
      }

      // Refresh failed — return a clear error
      return {
        ok: false,
        status: 401,
        data: {
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Session expired. Run `wafflebase login`.',
          },
        } as T,
      };
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
    return this.request('GET', `/documents/${id}`);
  }
  updateDocument(id: string, title: string) {
    return this.request('PATCH', `/documents/${id}`, { title });
  }
  deleteDocument(id: string) {
    return this.request('DELETE', `/documents/${id}`);
  }

  // Docs (word-processor) content
  getDocContent(docId: string) {
    return this.request<Document>(
      'GET',
      `/documents/${docId}/content`,
    );
  }
  putDocContent(docId: string, doc: Document) {
    return this.request<Document>(
      'PUT',
      `/documents/${docId}/content`,
      doc,
    );
  }

  // Slides content — same endpoint as docs; the backend dispatches on
  // the persisted document type, picking the docs writer for `'doc'`
  // and the slides writer for `'slides'`.
  getSlidesContent(docId: string) {
    return this.request<SlidesDocument>(
      'GET',
      `/documents/${docId}/content`,
    );
  }
  putSlidesContent(docId: string, deck: SlidesDocument) {
    return this.request<SlidesDocument>(
      'PUT',
      `/documents/${docId}/content`,
      deck,
    );
  }

  // Notes content — same endpoint as docs/slides; the backend dispatches
  // on the persisted document type, picking the note writer for `'note'`.
  // A note's content is a single markdown string (`{ content }`).
  getNoteContent(docId: string) {
    return this.request<NoteContent>(
      'GET',
      `/documents/${docId}/content`,
    );
  }
  putNoteContent(docId: string, note: NoteContent) {
    return this.request<NoteContent>(
      'PUT',
      `/documents/${docId}/content`,
      note,
    );
  }

  // Tabs
  listTabs(docId: string) {
    return this.request<unknown[]>('GET', `/documents/${docId}/tabs`);
  }

  // Cells
  getCells(docId: string, tabId: string, range?: string) {
    const query = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request('GET', `/documents/${docId}/tabs/${tabId}/cells${query}`);
  }
  getCell(docId: string, tabId: string, sref: string) {
    return this.request('GET', `/documents/${docId}/tabs/${tabId}/cells/${sref}`);
  }
  setCell(docId: string, tabId: string, sref: string, value?: string, formula?: string) {
    return this.request('PUT', `/documents/${docId}/tabs/${tabId}/cells/${sref}`, {
      value,
      formula,
    });
  }
  deleteCell(docId: string, tabId: string, sref: string) {
    return this.request('DELETE', `/documents/${docId}/tabs/${tabId}/cells/${sref}`);
  }
  batchCells(
    docId: string,
    tabId: string,
    cells: Record<string, { value?: string; formula?: string } | null>,
  ) {
    return this.request('PATCH', `/documents/${docId}/tabs/${tabId}/cells`, { cells });
  }

  // API Keys (management endpoints use a different base, but the same
  // authenticated round trip — see `send`)
  private get apiKeysBase(): string {
    const server = this.config.server.replace(/\/$/, '');
    return `${server}/workspaces/${this.config.workspace}/api-keys`;
  }
  listApiKeys() {
    return this.send('GET', this.apiKeysBase);
  }
  createApiKey(name: string) {
    return this.send('POST', this.apiKeysBase, { name });
  }
  revokeApiKey(id: string) {
    return this.send('DELETE', `${this.apiKeysBase}/${encodeURIComponent(id)}`);
  }
}
