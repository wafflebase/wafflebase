import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  photo: string | null;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export interface Session {
  server: string;
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  activeWorkspace: string;
  workspaces: WorkspaceInfo[];
}

/**
 * Returns the default session file path: ~/.wafflebase/session.json
 */
export function getSessionPath(): string {
  return join(homedir(), '.wafflebase', 'session.json');
}

/**
 * Loads the session from disk. Returns null if the file does not exist or
 * contains invalid JSON.
 */
export function loadSession(path: string = getSessionPath()): Session | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/**
 * Writes the session to disk with owner-only (0600) permissions.
 * Creates the parent directory if it does not exist.
 */
export function saveSession(
  session: Session,
  path: string = getSessionPath(),
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
  // Explicitly chmod in case the file already existed with different permissions
  chmodSync(path, 0o600);
}

/**
 * Deletes the session file if it exists. No-op otherwise.
 */
export function clearSession(path: string = getSessionPath()): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * Returns true when the session's expiresAt timestamp is in the past.
 */
export function isSessionExpired(session: Session): boolean {
  return new Date(session.expiresAt) <= new Date();
}

/**
 * Decodes the `exp` claim from a JWT's payload segment and returns an ISO
 * 8601 string.
 *
 * JWT format: <header>.<payload>.<signature>
 * The payload is base64url-encoded JSON.
 */
export function decodeJwtExpiry(token: string): string {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT: expected at least 2 segments');
  }

  // Add padding back if needed for base64 decoding
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf-8');
  const payload = JSON.parse(decoded) as { exp?: number };

  if (typeof payload.exp !== 'number') {
    throw new Error('JWT payload does not contain an exp claim');
  }

  return new Date(payload.exp * 1000).toISOString();
}
