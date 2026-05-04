import { writeFileSync } from 'node:fs';

export interface WriteBinaryOptions {
  /** Allow overwriting an existing file. Without this flag, `writeBinary`
   *  refuses to clobber and throws. Mirrors `--force` on the CLI. */
  force?: boolean;
  /** Suppress informational stderr output. The bytes themselves still
   *  reach stdout/the file regardless of this flag. */
  quiet?: boolean;
}

/**
 * Write `bytes` to `target`, where `target` is either a filesystem path
 * or `'-'` for stdout. The default behavior refuses to overwrite an
 * existing file because exports are usually irreversible (the source
 * doc is the canonical store but a stale local copy can still mislead).
 *
 * The function is split out from the command action so binary output
 * paths can be unit-tested without spawning the CLI binary; the action
 * supplies real `process.stdout.write` and the IO surface forwards it.
 *
 * The default `writeFile` honors `force` via the `'w'` (overwrite) /
 * `'wx'` (exclusive create) `fs` flags, folding the existence check
 * and the write into a single syscall — avoids a TOCTOU window where
 * something else could create the file between the check and the
 * write.
 */
export function writeBinary(
  bytes: Uint8Array,
  target: string,
  opts: WriteBinaryOptions = {},
  io: BinaryIO = defaultBinaryIO,
): void {
  if (target === '-') {
    io.stdout(bytes);
    return;
  }
  io.writeFile(target, bytes, opts.force === true);
  if (!opts.quiet) io.stderr(`Wrote ${bytes.length} bytes to ${target}`);
}

export interface BinaryIO {
  stdout: (bytes: Uint8Array) => void;
  stderr: (line: string) => void;
  /**
   * Write `bytes` to `path`. When `force` is `false`, the
   * implementation MUST refuse to overwrite an existing file and
   * throw — the production `defaultBinaryIO` does this via the
   * exclusive-create `'wx'` flag.
   */
  writeFile: (path: string, bytes: Uint8Array, force: boolean) => void;
}

export const defaultBinaryIO: BinaryIO = {
  stdout: (bytes) => {
    process.stdout.write(bytes);
  },
  stderr: (line) => {
    console.error(line);
  },
  writeFile: (path, bytes, force) => {
    try {
      writeFileSync(path, bytes, { flag: force ? 'w' : 'wx' });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code?: unknown }).code === 'EEXIST'
      ) {
        throw new Error(
          `Refusing to overwrite "${path}". Pass --force to allow overwrite.`,
        );
      }
      throw err;
    }
  },
};
