import type { CliConfig } from '../config/config.js';
import {
  loadSession,
  saveSession,
  decodeJwtExpiry,
} from '../config/session.js';

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

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, {
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
        const retryRes = await fetch(url, {
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
  createDocument(title: string) {
    return this.request('POST', '/documents', { title });
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

  // API Keys (management endpoints use different base)
  async listApiKeys() {
    const server = this.config.server.replace(/\/$/, '');
    const url = `${server}/workspaces/${this.config.workspace}/api-keys`;
    const res = await fetch(url, { headers: this.headers });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  async createApiKey(name: string) {
    const server = this.config.server.replace(/\/$/, '');
    const url = `${server}/workspaces/${this.config.workspace}/api-keys`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
  async revokeApiKey(id: string) {
    const server = this.config.server.replace(/\/$/, '');
    const url = `${server}/workspaces/${this.config.workspace}/api-keys/${id}`;
    const res = await fetch(url, { method: 'DELETE', headers: this.headers });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
}
