import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, ClientHttp2Session } from 'http2';

/**
 * Projected "currently editing" user. Backend-shaped so the React layer
 * never sees Yorkie's wire format (per-client maps, JSON-stringified
 * values, etc.).
 */
export type PresenceUser = {
  username: string;
  photo?: string;
  email?: string;
};

type RawPresences = {
  [clientId: string]: { data: { [key: string]: string } };
};

type RawDocumentSummary = {
  key: string;
  presences?: RawPresences;
  // RFC3339 timestamp of the last document change. Yorkie's connect-go
  // protojson response emits camelCase (`updatedAt`); the snake_case name is
  // accepted too for resilience across gateway/transcoding configs.
  updatedAt?: string;
  updated_at?: string;
};

type GetDocumentsResponse = {
  documents?: Array<RawDocumentSummary>;
  error?: { message?: string; code?: string };
};

/**
 * Per-document metadata read from Yorkie's admin `GetDocuments`: the live
 * editors and the last-modified time. `updatedAt` is an ISO string, or
 * undefined when Yorkie has no valid timestamp for the document.
 */
export type DocumentSummary = {
  editors: PresenceUser[];
  updatedAt?: string;
};

const REQUEST_TIMEOUT_MS = 800;

/**
 * HTTP/2 client for Yorkie's AdminService. Holds a single long-lived
 * ClientHttp2Session and multiplexes requests on it; the session is
 * lazily re-created on close/error. Failures degrade silently to an
 * empty map — presence is decorative, the listing must still succeed.
 */
@Injectable()
export class YorkieAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(YorkieAdminService.name);
  private readonly apiAddr: string;
  private readonly secretKey?: string;
  private session?: ClientHttp2Session;

  constructor(configService: ConfigService) {
    this.apiAddr =
      configService.get<string>('YORKIE_RPC_ADDR') ?? 'http://localhost:8080';
    this.secretKey = configService.get<string>('YORKIE_SECRET_KEY');
  }

  onModuleDestroy(): void {
    if (this.session && !this.session.destroyed) {
      this.session.close();
      this.session = undefined;
    }
  }

  /**
   * Fetch per-document metadata (live editors + last-modified time) for the
   * given Yorkie document keys. Returns a map keyed by document key;
   * documents Yorkie has never seen (or when no admin key is configured)
   * are absent, letting callers fall back to Postgres data.
   */
  async getSummaries(
    documentKeys: ReadonlyArray<string>,
  ): Promise<Map<string, DocumentSummary>> {
    const out = new Map<string, DocumentSummary>();
    if (documentKeys.length === 0) return out;
    if (!this.secretKey) {
      // No admin key configured — degrade silently. Expected for local
      // environments that haven't provisioned a project secret yet.
      return out;
    }

    try {
      const response = await this.requestGetDocuments(documentKeys);
      for (const doc of response.documents ?? []) {
        out.set(doc.key, projectSummary(doc));
      }
    } catch (err) {
      this.logger.warn(
        `Yorkie admin getSummaries failed: ${(err as Error).message}`,
      );
    }
    return out;
  }

  /**
   * Fetch "currently editing" users for the given Yorkie document keys.
   * Returns a map keyed by document key. Documents with no active clients
   * are absent. Thin projection over {@link getSummaries}.
   */
  async getEditors(
    documentKeys: ReadonlyArray<string>,
  ): Promise<Map<string, PresenceUser[]>> {
    const out = new Map<string, PresenceUser[]>();
    for (const [key, summary] of await this.getSummaries(documentKeys)) {
      if (summary.editors.length > 0) out.set(key, summary.editors);
    }
    return out;
  }

  private getSession(): ClientHttp2Session {
    if (this.session && !this.session.destroyed && !this.session.closed) {
      return this.session;
    }
    const session = connect(this.apiAddr);
    // Detach on any terminal state so the next call lazily reconnects.
    const drop = () => {
      if (this.session === session) this.session = undefined;
    };
    session.once('close', drop);
    session.once('error', (err) => {
      this.logger.warn(`Yorkie admin session error: ${err.message}`);
      drop();
      if (!session.destroyed) session.close();
    });
    // Yorkie admin idle timeouts can otherwise kill the multiplexed session
    // mid-request; allow the session to outlive the event loop while idle.
    session.unref();
    this.session = session;
    return session;
  }

  private requestGetDocuments(
    documentKeys: ReadonlyArray<string>,
  ): Promise<GetDocumentsResponse> {
    return new Promise((resolve, reject) => {
      let session: ClientHttp2Session;
      try {
        session = this.getSession();
      } catch (err) {
        reject(err as Error);
        return;
      }
      // Re-ref while a request is in-flight so a busy session keeps the
      // process alive; unref again on settle.
      session.ref();

      const body = JSON.stringify({
        document_keys: documentKeys,
        include_root: false,
        include_presences: true,
      });

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.unref();
        fn();
      };

      let req;
      try {
        req = session.request({
          ':method': 'POST',
          ':path': '/yorkie.v1.AdminService/GetDocuments',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
          authorization: `API-Key ${this.secretKey}`,
        });
      } catch (err) {
        session.unref();
        reject(err as Error);
        return;
      }

      const timeout = setTimeout(() => {
        req.close();
        settle(() => reject(new Error('Yorkie admin request timed out')));
      }, REQUEST_TIMEOUT_MS);

      let status = 0;
      req.on('response', (headers) => {
        status = Number(headers[':status']) || 0;
      });

      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        settle(() => {
          if (status >= 400) {
            reject(
              new Error(
                `Yorkie admin returned HTTP ${status}${data ? `: ${data.slice(0, 200)}` : ''}`,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(data) as GetDocumentsResponse;
            if (parsed.error) {
              reject(new Error(parsed.error.message ?? 'Yorkie admin error'));
              return;
            }
            resolve(parsed);
          } catch (err) {
            reject(
              new Error(
                `Failed to parse Yorkie admin response: ${(err as Error).message}`,
              ),
            );
          }
        });
      });
      req.on('error', (err) => {
        settle(() => reject(err));
      });

      req.write(body);
      req.end();
    });
  }
}

/**
 * Strip Yorkie's per-field JSON-stringification (`"\"alice\""` → `"alice"`)
 * and decode-uri-component-safe usernames; bail to undefined for malformed
 * input rather than emitting `"undefined"` text.
 */
function unwrap(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let next: unknown = value;
  try {
    next = JSON.parse(value);
  } catch {
    // Keep raw on parse failure — most fields are strings JSON.stringify'd
    // by the SDK but very early test data could be bare.
  }
  if (typeof next !== 'string') return undefined;
  return next;
}

/**
 * Project a raw Yorkie `GetDocuments` entry into our backend-shaped summary.
 * Reads the last-modified timestamp from camelCase `updatedAt` (protojson's
 * output form), falling back to snake_case for resilience.
 */
export function projectSummary(doc: RawDocumentSummary): DocumentSummary {
  return {
    editors: projectUsers(doc.presences),
    updatedAt: parseTimestamp(doc.updatedAt ?? doc.updated_at),
  };
}

/**
 * Normalize a Yorkie RFC3339 timestamp into an ISO string. Returns
 * undefined for missing, empty, epoch-zero (Yorkie's "unset"), or
 * unparseable values so callers can fall back to Postgres data.
 */
export function parseTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}

function projectUsers(presences: RawPresences | undefined): PresenceUser[] {
  if (!presences) return [];
  const seen = new Map<string, PresenceUser>();
  for (const [clientId, entry] of Object.entries(presences)) {
    const data = entry?.data ?? {};
    const username = unwrap(data.username) ?? '';
    const email = unwrap(data.email) ?? '';
    const photo = unwrap(data.photo) || undefined;
    if (!username && !email) continue;
    const key = email || username || clientId;
    if (seen.has(key)) continue;
    seen.set(key, {
      username: username || email,
      photo,
      email: email || undefined,
    });
  }
  return Array.from(seen.values());
}
