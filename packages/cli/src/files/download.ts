import { basename } from 'node:path';
import {
  writeBinary,
  defaultBinaryIO,
  type BinaryIO,
} from '../output/binary.js';
import type { BinaryResponse } from '../client/http-client.js';

/**
 * Where the bytes go: the caller's path when given, otherwise the filename the
 * server advertised in `Content-Disposition`.
 *
 * That name is server-supplied but derived from a user-controlled document
 * title, so it is reduced to a bare filename before it can reach the
 * filesystem — a title of `../../.bashrc` must not decide where the CLI
 * writes. `basename` handles the traversal; the dot cases and the empty string
 * are rejected explicitly because `basename` happily returns them.
 */
export function resolveDownloadTarget(
  out: string | undefined,
  serverName: string | undefined,
  docId: string,
): string {
  if (out) return out;
  const safe = serverName ? basename(serverName).trim() : '';
  if (!safe || safe === '.' || safe === '..') return docId;
  return safe;
}

export interface FilesDownloadClient {
  downloadFileDocument: (docId: string) => Promise<BinaryResponse>;
}

export interface RunFilesDownloadArgs {
  docId: string;
  /** Output path, `'-'` for stdout, or omitted to use the server's filename. */
  out?: string;
  force?: boolean;
  quiet?: boolean;
}

export interface RunFilesDownloadResult {
  exitCode: number;
}

/** Pure orchestration for `files download`. */
export async function runFilesDownload(
  args: RunFilesDownloadArgs,
  client: FilesDownloadClient,
  io: BinaryIO = defaultBinaryIO,
): Promise<RunFilesDownloadResult> {
  const { docId, out, force = false, quiet = false } = args;

  const res = await client.downloadFileDocument(docId);
  if (!res.ok || !res.bytes) {
    io.stderr(
      JSON.stringify(res.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2),
    );
    return { exitCode: 1 };
  }

  const target = resolveDownloadTarget(out, res.fileName, docId);
  writeBinary(res.bytes, target, { force, quiet }, io);
  return { exitCode: 0 };
}
