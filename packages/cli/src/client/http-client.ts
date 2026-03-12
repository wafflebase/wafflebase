import type { CliConfig } from '../config/config.js';

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
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private get base(): string {
    const server = this.config.server.replace(/\/$/, '');
    return `${server}/api/v1/workspaces/${this.config.workspace}`;
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
