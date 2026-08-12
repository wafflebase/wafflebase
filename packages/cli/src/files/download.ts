import { basename } from 'node:path';
import {
  writeBinary,
  defaultBinaryIO,
  type BinaryIO,
} from '../output/binary.js';
import type { BinaryResponse } from '../client/http-client.js';
import { backendErrorEnvelope } from '../output/formatter.js';

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
  /**
   * Dotted name of the command driving this run (`files.download`), stamped
   * into the error envelope so an agent running several calls can tell which
   * one failed. The action passes `commandPath(this)`.
   */
  command?: string;
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
  const { docId, out, force = false, quiet = false, command } = args;

  const res = await client.downloadFileDocument(docId);
  if (!res.ok || !res.bytes) {
    io.stderr(
      backendErrorEnvelope(
        res.data,
        { code: 'HTTP_ERROR', message: `HTTP ${res.status}` },
        command,
      ),
    );
    return { exitCode: 1 };
  }

  const target = resolveDownloadTarget(out, res.fileName, docId);
  writeBinary(res.bytes, target, { force, quiet }, io);
  return { exitCode: 0 };
}
