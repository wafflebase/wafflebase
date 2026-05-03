import { writeFileSync, existsSync } from 'node:fs';

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
  if (existsSync(target) && !opts.force) {
    throw new Error(
      `Refusing to overwrite "${target}". Pass --force to allow overwrite.`,
    );
  }
  io.writeFile(target, bytes);
  if (!opts.quiet) io.stderr(`Wrote ${bytes.length} bytes to ${target}`);
}

export interface BinaryIO {
  stdout: (bytes: Uint8Array) => void;
  stderr: (line: string) => void;
  writeFile: (path: string, bytes: Uint8Array) => void;
}

export const defaultBinaryIO: BinaryIO = {
  stdout: (bytes) => {
    process.stdout.write(bytes);
  },
  stderr: (line) => {
    console.error(line);
  },
  writeFile: (path, bytes) => {
    writeFileSync(path, bytes);
  },
};
