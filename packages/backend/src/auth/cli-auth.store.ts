import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A CLI login in flight.
 *
 * Every field is required: a state entry that is missing one of them is a
 * login with a binding switched off, and each binding closes an attack the
 * others do not (see the field comments). Making them non-optional is what
 * keeps "the CLI simply did not send it" from silently becoming "this login
 * is unbound".
 */
interface StateEntry {
  /**
   * Random value whose twin sits in the `wafflebase_oauth_state` cookie set
   * on the browser that started this login. The callback must present it, so
   * a `state` minted in the attacker's browser (pointing at a loopback port
   * the attacker owns) cannot be walked through consent by the victim's.
   */
  browserBinding: string;
  mode: string;
  port: number;
  /**
   * Nonce the CLI minted for this login. Echoed back to its localhost
   * callback as `state` so the CLI can tell its own flow's code from one an
   * attacker pushed at the guessable callback port (RFC 8252 §8.9).
   */
  nonce: string;
  /**
   * PKCE S256 challenge (RFC 7636) the CLI derived from a verifier it never
   * puts on the wire. Carried onto the authorization code so a code that
   * leaks out of the loopback redirect is not redeemable by whoever holds it.
   */
  codeChallenge: string;
  expiresAt: number;
}

/** The bindings a CLI login must carry; see `StateEntry`. */
export interface CliStateParams {
  mode: string;
  port: number;
  browserBinding: string;
  nonce: string;
  codeChallenge: string;
}

interface CodeEntry {
  userId: number;
  /** Copied from the state that minted this code; see `StateEntry`. */
  codeChallenge?: string;
  expiresAt: number;
}

/** Constant-time compare of two base64url strings. */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class CliAuthStore {
  private states = new Map<string, StateEntry>();
  private codes = new Map<string, CodeEntry>();

  createState(params: CliStateParams): { stateToken: string } {
    const stateToken = randomBytes(32).toString('base64url');
    this.states.set(stateToken, {
      ...params,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    this.cleanup();
    return { stateToken };
  }

  consumeState(stateToken: string): CliStateParams | undefined {
    const entry = this.states.get(stateToken);
    if (!entry || entry.expiresAt < Date.now()) {
      this.states.delete(stateToken);
      return undefined;
    }
    this.states.delete(stateToken);
    return {
      browserBinding: entry.browserBinding,
      mode: entry.mode,
      port: entry.port,
      nonce: entry.nonce,
      codeChallenge: entry.codeChallenge,
    };
  }

  createCode(userId: number, codeChallenge?: string): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      userId,
      codeChallenge,
      expiresAt: Date.now() + 60 * 1000,
    });
    this.cleanup();
    return code;
  }

  /**
   * Redeem a code once.
   *
   * A code minted from a PKCE-bearing login is only redeemable by the client
   * that started it: the caller must supply the verifier whose S256 hash is
   * the stored challenge. A mismatch burns the code and is reported as an
   * ordinary miss, so the endpoint is no oracle for "this code exists".
   *
   * A code minted without a challenge (a CLI predating PKCE) stays redeemable
   * with the code alone — but only from a caller that presents no verifier.
   * Redeeming a verifier against an unchallenged code is RFC 7636 §4.6's
   * forbidden case, and refusing it is what stops a downgrade: otherwise an
   * attacker who starts an unchallenged login at the victim's callback port
   * and nonce gets the victim's PKCE-capable CLI to spend the attacker's
   * code, verifier and all, and the terminal ends up logged into the
   * attacker's account.
   */
  consumeCode(code: string, codeVerifier?: string): number | undefined {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(code);
      return undefined;
    }
    this.codes.delete(code);

    if (!entry.codeChallenge) {
      return codeVerifier ? undefined : entry.userId;
    }

    if (!codeVerifier) return undefined;
    const digest = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    if (!secretEquals(entry.codeChallenge, digest)) return undefined;

    return entry.userId;
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt < now) this.states.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
  }
}
