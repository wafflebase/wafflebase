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

/**
 * Signal the child's whole process GROUP, falling back to the direct signal.
 *
 * `pid` is undefined when the spawn itself failed, and a group that has already exited
 * throws ESRCH; both fall back to the direct signal, which is the whole of it in those
 * cases. Shared by `dispose()` and the stdin-loss path: each has to reach past the
 * `pnpm exec tsx` wrappers rather than only the pid `spawn` returned — see `DETACH`.
 */
function killTree(child: ChildProcessWithoutNullStreams): void {
  try {
    if (DETACH && child.pid != null) process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch {
    try {
      child.kill();
    } catch {
      /* nothing left to kill */
    }
  }
}

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

    /**
     * The child can outlive its own stdin, and then a write fails with `EPIPE`.
     *
     * `pnpm exec tsx` is a wrapper chain (see `DETACH`), so the process `spawn` returned
     * is not the one reading stdin. When the emitter two levels down dies — a broken
     * `packages/core`, a type error in the patched sources, which is exactly what a live
     * preview feeds it — the read end of the pipe closes while the outer wrapper is still
     * alive. Measured on that shape: `exitCode` stays null and `killed` stays false, so
     * `child.on('exit')` never fires and `die()` never runs; the write reports `EPIPE`
     * ASYNCHRONOUSLY, as an `'error'` event on this stream.
     *
     * Unhandled, that event is an uncaught exception — the dev server or the test worker
     * goes down, taking unrelated work with it, which is what made this flaky rather than
     * merely broken. A write callback does NOT prevent it: measured, the callback receives
     * `EPIPE` and the stream emits `'error'` anyway.
     *
     * Routed through `die()` because both of its halves are needed here. The pending
     * requests must be settled — `child.on('exit')` will not do it, so they would otherwise
     * sit for their full 15 s — and `live` must be dropped, or `ensure()`'s liveness check
     * hands out this same child forever and every later render writes into the dead pipe.
     *
     * This is the one `die()` path that lets go of a child that is still RUNNING, so it
     * is signalled before being dropped. Once `live` is cleared nothing can reach this
     * child again — `dispose()` would only ever stop its replacement — and it is already
     * unusable, being a pipe nobody reads, so leaving it alive leaks one detached process
     * tree per respawn.
     *
     * The late `'exit'` that the signal provokes is harmless: `die()` is bound to one
     * `Live`, so it settles that child's already-empty `pending` and leaves `live` alone
     * unless it still points at the same state.
     */
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      killTree(state.child);
      die(`lost stdin: ${err.code ?? err.message}`);
    });

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
          // NO STREAM FAILURE REACHES HERE — they are all asynchronous. An earlier
          // version of this comment measured one case, a child that exits before the
          // write, and generalised from it: `write()` never throws, no `'error'` event
          // fires, and the failure surfaces only through the write callback as
          // `ERR_STREAM_DESTROYED`, which this call does not pass. That much still
          // holds, and `child.on('exit')` settles those requests through `die()`.
          //
          // The generalisation is what was wrong. It concluded that a callback "would
          // duplicate `die()`", which read as "nothing more is needed" and hid the
          // NEIGHBOURING case, where the child outlives its stdin: there `die()` never
          // runs, the failure is `EPIPE`, and it arrives as an `'error'` event that took
          // the whole process down when nothing listened. See the `child.stdin` handler
          // in `ensure()` for the measurement and the fix. The lesson is that a stream
          // is not one failure mode: which one you get depends on whether the stream has
          // been destroyed yet, and a measurement of one says nothing about the other.
          //
          // This catch is kept for a SYNCHRONOUS throw only, which means a shape change
          // rather than a stream failure — a `null` stdin if the stdio ever stops being
          // `'pipe'`. Even a write after `end()` is async (measured: the callback and an
          // `'error'` event get `ERR_STREAM_WRITE_AFTER_END`; nothing throws), so the
          // earlier comment was wrong about that one too. Settling still beats an
          // unhandled rejection out of a `.then` nobody owns.
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

      // Then the wrappers, as a group.
      killTree(w.child);
    },
  };
}
