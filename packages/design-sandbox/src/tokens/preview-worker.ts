/**
 * The token-preview worker — a warm child process that renders the variable map
 * from PATCHED token sources.
 *
 * Ported from the prototype's `vite.config.ts:823-890`. Wafflebase's tokens are
 * TypeScript, so "what will this edit look like" cannot be answered by reading text:
 * `paletteBlock()` has hand-written mode-conditional logic (`--wb-syrup-deep` maps to
 * `palette.butter` in dark) and `semantic.ts` carries computed bindings like
 * `` `rgba(${palette.butterRgb}, 0.30)` ``. Only running the real emitter makes "what
 * you see is what you save" hold, which is `preview-tokens.mts`'s own argument for
 * existing and the reason this indirection is not overkill.
 *
 * WHY A CHILD PROCESS AND NOT AN IMPORT. Measured, on this checkout: a cold
 * `pnpm exec tsx scripts/preview-tokens.mts` costs **2.0 s** to first response, and
 * every request after it comes back in **under a millisecond**. A per-request spawn is
 * therefore unusable for a live preview while a warm one is free, which is the whole
 * design. The prototype had a second reason — the bridge ran inside a Vite config that
 * Node loads as transpiled JS and so could not `import` a `.ts` file — and that reason
 * is gone: this module is TypeScript in a package vitest and Vite both transpile. The
 * measurement is what still justifies it.
 *
 * WHAT CHANGED IN THE PORT, and why:
 *
 *   - **No module-level singleton.** The prototype kept one `previewWorker` in module
 *     scope. This package's whole discipline is that two dev servers in one process must
 *     not share state (see `design-editor`'s `paths.ts`), so the worker is an instance
 *     owned by whoever created it, and `dispose()` exists so a test can end it.
 *   - **stderr is kept.** The prototype discarded it, so a worker that died on startup
 *     reported `preview worker exited` with no cause — and a startup failure is the
 *     likely one (a missing `tsx`, a broken `packages/core`). A bounded tail is retained
 *     and attached to the error instead. Bounded because it is not all diagnostics: on
 *     this repo `pnpm` writes a `pnpm.overrides` deprecation warning to stderr on every
 *     single spawn, which would otherwise accumulate for the worker's lifetime.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { TokenEmitResult } from '@wafflebase/design-editor';

/** The four source texts the emitter needs, keyed as `preview-tokens.mts` expects. */
export type PreviewSources = Record<'palette' | 'semantic' | 'radius' | 'typography', string>;

export interface PreviewWorkerOptions {
  /** Working directory for the child — the package that owns the emitter script. */
  cwd: string;
  /** Command and arguments, e.g. `pnpm exec tsx scripts/preview-tokens.mts`. */
  command: string;
  args: string[];
  /** Per-request ceiling. Defaults to 15 s, the prototype's value. */
  timeoutMs?: number;
}

export interface PreviewWorker {
  render(files: PreviewSources): Promise<TokenEmitResult>;
  /**
   * End the child.
   *
   * Not part of the `TokenAdapter` contract — an adapter that owns no process has
   * nothing to dispose, which is why `cssVariables` has no such method. It exists
   * because a test that spawns one must be able to stop it, and because a caller
   * shutting down deliberately should not rely on the implicit path: closing stdin ends
   * the child's `readline`, so the worker also exits on its own when the parent does.
   */
  dispose(): void;
}

/** How much stderr to retain for the failure message. */
const STDERR_TAIL = 4_000;

/**
 * `pnpm` is not an executable on Windows — it is `pnpm.cmd`, and `spawn` without a
 * shell does not find it.
 *
 * NOT VERIFIED ON WINDOWS: nothing in this package's suite runs there, and the sandbox
 * is wafflebase-only. It is two lines against a known `spawn` behaviour, so it is worth
 * having, but it is stated as untested rather than claimed to work.
 */
const platformCommand = (command: string): string =>
  process.platform === 'win32' && !command.endsWith('.cmd') && !command.includes('.')
    ? `${command}.cmd`
    : command;

/**
 * `detached` on POSIX, so the whole process GROUP can be signalled.
 *
 * `pnpm exec tsx` is two wrappers deep: `pnpm` spawns pnpm's own entry, which spawns
 * `tsx`, which spawns the emitter. Signalling the pid `spawn` returned reaches the
 * OUTERMOST one only. Measured before this was added: after `dispose()`, three of the
 * four processes were still alive two seconds later — the emitter itself had exited
 * (its stdin closed) but the wrapper chain had not.
 *
 * Windows has no process groups in this sense and `detached` there opens a new console,
 * so it stays POSIX-only; `dispose()` falls back to the plain signal.
 */
const DETACH = process.platform !== 'win32';

export function createPreviewWorker(options: PreviewWorkerOptions): PreviewWorker {
  const timeoutMs = options.timeoutMs ?? 15_000;

  interface Live {
    child: ChildProcessWithoutNullStreams;
    pending: Map<number, (v: TokenEmitResult) => void>;
    /** Bounded tail of the child's stderr, for the failure message. */
    stderr: string;
    seq: number;
  }
  let live: Live | null = null;
  let disposed = false;

  /** Spawn if there is nothing running, and wire the line protocol. */
  function ensure(): Live | null {
    if (disposed) return null;
    if (live && !live.child.killed && live.child.exitCode == null) return live;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(platformCommand(options.command), options.args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: DETACH,
      }) as ChildProcessWithoutNullStreams;
    } catch {
      // `spawn` throws synchronously only for an invalid argument shape; an unfindable
      // command arrives later as an `error` event. Either way there is no worker, and
      // reporting that as null lets `render` answer with a reason rather than throw.
      return null;
    }

    const state: Live = { child, pending: new Map(), stderr: '', seq: 0 };
    let buf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      for (;;) {
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Skip anything that is not a JSON object rather than treating it as a
        // protocol error: package managers print banners on stdout, and one of those
        // must not kill a worker whose next line is a perfectly good response.
        //
        // THIS AND THE `catch` BELOW OVERLAP, and the suite cannot tell them apart —
        // stated rather than implied. Every input either satisfies both (a valid
        // response) or neither (a banner, a truncated line, a bare scalar): removing
        // this line leaves the `catch` to drop the same lines, and the banner test
        // below passes either way. It is kept as the intent-revealing filter, with the
        // `catch` as the backstop, not because it changes an outcome.
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as TokenEmitResult & { id?: number };
          if (msg.id == null) continue;
          const resolve = state.pending.get(msg.id);
          if (!resolve) continue;
          state.pending.delete(msg.id);
          resolve({ ok: msg.ok, error: msg.error, light: msg.light, dark: msg.dark });
        } catch {
          /* a malformed line is dropped, not fatal — same reasoning as above */
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      state.stderr = `${state.stderr}${chunk.toString()}`.slice(-STDERR_TAIL);
    });

    /**
     * Fail every in-flight request when the child goes away.
     *
     * Without this they wait for their individual timeouts — 15 s each — on a worker
     * that is already gone, which reads as a hung editor rather than a broken one.
     */
    const die = (why: string) => {
      const detail = state.stderr.trim();
      const error = detail ? `preview worker ${why}: ${detail.split('\n').slice(-3).join(' ')}` : `preview worker ${why}`;
      for (const resolve of state.pending.values()) resolve({ ok: false, error });
      state.pending.clear();
      // NOT REACHABLE BY THE SUITE, and kept anyway on Node's documented contract: the
      // `exit` event "may or may not fire after an error has occurred". When it does not,
      // `exitCode` stays null and `killed` stays false, so `ensure()`'s own liveness check
      // would hand out this dead state forever and every later render would hang. Measured:
      // an ENOENT spawn failure DOES emit both, so reverting this line changes nothing
      // observable here — three consecutive renders respawn and report the same error with
      // or without it. That makes the line unfalsifiable by test, not unnecessary.
      if (live === state) live = null;
    };
    child.on('exit', (code) => die(`exited (code ${code})`));
    child.on('error', (err) => die(`failed to start: ${err.message}`));

    live = state;
    return state;
  }

  return {
    render(files: PreviewSources): Promise<TokenEmitResult> {
      const w = ensure();
      if (!w) {
        return Promise.resolve({
          ok: false,
          error: disposed ? 'preview worker disposed' : 'preview worker unavailable',
        });
      }
      const id = ++w.seq;
      return new Promise<TokenEmitResult>((resolve) => {
        const timer = setTimeout(() => {
          w.pending.delete(id);
          resolve({ ok: false, error: `preview worker timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        w.pending.set(id, (v) => {
          clearTimeout(timer);
          resolve(v);
        });
        try {
          w.child.stdin.write(`${JSON.stringify({ id, files })}\n`);
        } catch (err) {
          // A DEAD CHILD DOES NOT REACH HERE, and the comment that said it did was
          // wrong. Measured against a child that exits before the write, at several
          // timings: `write()` never throws, and no `'error'` event is emitted even
          // with a listener attached — the failure surfaces only through the write
          // callback, as `ERR_STREAM_DESTROYED`, which this call does not pass. So
          // this catch is unreachable for the case it was written for.
          //
          // Nothing is broken by that, which is why it is a comment fix rather than a
          // code one: `die()` already settles every pending request from
          // `child.on('exit')`, milliseconds later, so the 15-second stall the old
          // comment worried about is prevented — just somewhere else. Adding a write
          // callback here would duplicate `die()`.
          //
          // Kept because `write()` CAN throw for reasons unrelated to the child dying
          // (a `null` stdin if the stdio shape ever changes, a write after `end()`),
          // and settling beats an unhandled rejection out of a `.then` nobody owns.
          clearTimeout(timer);
          w.pending.delete(id);
          resolve({ ok: false, error: `preview worker write failed: ${String(err)}` });
        }
      });
    },

    dispose() {
      disposed = true;
      const w = live;
      live = null;
      if (!w) return;
      for (const resolve of w.pending.values()) {
        resolve({ ok: false, error: 'preview worker disposed' });
      }
      w.pending.clear();

      // Closing stdin is what actually stops the emitter: it ends the child's
      // `readline`, which is the documented cooperative exit. Do it first so a
      // well-behaved worker is already leaving before the signal arrives.
      try {
        w.child.stdin.end();
      } catch {
        /* already closed, or the spawn never produced a pipe */
      }

      // Then the wrappers, as a group — see `DETACH`. `pid` is undefined when the
      // spawn itself failed, and a group that has already exited throws ESRCH; both
      // fall back to the direct signal, which is the whole of it in those cases.
      try {
        if (DETACH && w.child.pid != null) process.kill(-w.child.pid, 'SIGTERM');
        else w.child.kill();
      } catch {
        try {
          w.child.kill();
        } catch {
          /* nothing left to kill */
        }
      }
    },
  };
}
