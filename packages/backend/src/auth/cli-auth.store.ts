import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { timingSafeEqualStr } from './oauth-state';

interface StateEntry {
  csrf: string;
  mode: string;
  port: number;
  /**
   * Nonce the CLI generated for this login attempt. Echoed back on the
   * loopback redirect as `state` so the CLI's callback server can tell
   * our redirect from one forged by a web page (login CSRF).
   */
  nonce?: string;
  /**
   * PKCE-style challenge: `sha256(verifier)` for a verifier the CLI keeps
   * in memory and never puts in a URL. Carried from the login start into
   * the code the callback mints, so the code alone is not enough to
   * redeem it (see `createCode`).
   */
  challenge?: string;
  expiresAt: number;
}

interface CodeEntry {
  userId: number;
  challenge: string;
  expiresAt: number;
}

/** `sha256(verifier)`, base64url — the PKCE S256 transform. */
export function hashCliVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

@Injectable()
export class CliAuthStore {
  private states = new Map<string, StateEntry>();
  private codes = new Map<string, CodeEntry>();

  createState(
    mode: string,
    port: number,
    nonce?: string,
    challenge?: string,
  ): { stateToken: string; csrf: string } {
    const csrf = randomBytes(32).toString('base64url');
    const stateToken = randomBytes(32).toString('base64url');
    this.states.set(stateToken, {
      csrf,
      mode,
      port,
      nonce,
      challenge,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    this.cleanup();
    return { stateToken, csrf };
  }

  consumeState(
    stateToken: string,
  ):
    | {
        csrf: string;
        mode: string;
        port: number;
        nonce?: string;
        challenge?: string;
      }
    | undefined {
    const entry = this.states.get(stateToken);
    if (!entry || entry.expiresAt < Date.now()) {
      this.states.delete(stateToken);
      return undefined;
    }
    this.states.delete(stateToken);
    return {
      csrf: entry.csrf,
      mode: entry.mode,
      port: entry.port,
      nonce: entry.nonce,
      challenge: entry.challenge,
    };
  }

  /**
   * Mint an authorization code bound to the login attempt's challenge.
   *
   * The code travels to the CLI as plaintext over loopback HTTP — a query
   * string in a `http://127.0.0.1:<port>/callback` navigation, on a port
   * taken off the start URL. Anything that can observe that hop (a local
   * process reading it, a redirect logged by a browser extension or
   * proxy, shell history) would otherwise hold a full credential: the
   * code alone used to buy access **and** refresh JWTs from
   * `POST /auth/cli/exchange`, unauthenticated. Requiring the challenge
   * makes it a proof-of-possession code instead — only the process that
   * generated the verifier can redeem it, and the verifier never appears
   * in any URL.
   */
  createCode(userId: number, challenge: string): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      userId,
      challenge,
      expiresAt: Date.now() + 60 * 1000,
    });
    this.cleanup();
    return code;
  }

  /**
   * Redeem a code, which requires the verifier its challenge was derived
   * from. The entry is spent on *any* attempt — a mismatched verifier
   * burns the code rather than leaving it up for another try, so a stolen
   * code cannot be probed and never survives a redemption.
   */
  consumeCode(code: string, verifier: string): number | undefined {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) {
      return undefined;
    }
    if (!timingSafeEqualStr(entry.challenge, hashCliVerifier(verifier))) {
      return undefined;
    }
    return entry.userId;
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt < now) this.states.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
  }
}
