import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

interface StateEntry {
  csrf: string;
  mode: string;
  port: number;
  /**
   * Nonce minted by the CLI invocation that started this flow, echoed back on
   * the loopback redirect so the CLI can tell its own callback from an
   * injected one. Undefined for a flow started without one.
   */
  cliState?: string;
  expiresAt: number;
}

interface CodeEntry {
  userId: number;
  expiresAt: number;
}

@Injectable()
export class CliAuthStore {
  private states = new Map<string, StateEntry>();
  private codes = new Map<string, CodeEntry>();

  createState(
    mode: string,
    port: number,
    cliState?: string,
  ): { stateToken: string; csrf: string } {
    const csrf = randomBytes(32).toString('base64url');
    const stateToken = randomBytes(32).toString('base64url');
    this.states.set(stateToken, {
      csrf,
      mode,
      port,
      cliState,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    this.cleanup();
    return { stateToken, csrf };
  }

  consumeState(stateToken: string):
    | { csrf: string; mode: string; port: number; cliState?: string }
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
      cliState: entry.cliState,
    };
  }

  createCode(userId: number): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { userId, expiresAt: Date.now() + 60 * 1000 });
    this.cleanup();
    return code;
  }

  consumeCode(code: string): number | undefined {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(code);
      return undefined;
    }
    this.codes.delete(code);
    return entry.userId;
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt < now) this.states.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
  }
}
