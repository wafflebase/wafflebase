import { basename } from 'node:path';
import {
  writeBinary,
  defaultBinaryIO,
  type BinaryIO,
} from '../output/binary.js';
import type { BinaryResponse } from '../client/http-client.js';
import { upstreamErrorJson } from '../output/formatter.js';

/**
 * Where the bytes go: the caller's path when given, otherwise the filename the
 * server advertised in `Content-Disposition`, otherwise the document id.
 *
 * Only the caller's own `out` is taken at face value — they typed it, so a
 * path is what they asked for. Everything else is a *name*, not a path, and is
 * reduced to a bare filename before it can reach the filesystem. The server's
 * name is derived from a user-controlled document title, and the document id
 * comes straight from argv (an agent may have written it), so a value of
 * `../../.bashrc` must not decide where the CLI writes in either case.
 * `basename` handles the traversal; the dot cases and the empty string are
 * rejected explicitly because `basename` happily returns them. With neither
 * name usable there is still a download to land, so it lands on a fixed
 * in-CWD name rather than on whatever the id spelled.
 */
export function resolveDownloadTarget(
  out: string | undefined,
  serverName: string | undefined,
  docId: string,
): string {
  if (out) return out;
  return bareFilename(serverName) ?? bareFilename(docId) ?? FALLBACK_FILENAME;
}

/** Name used when neither the server nor the document id yields a usable one. */
const FALLBACK_FILENAME = 'download';

/** `name` reduced to a single filename, or `undefined` if nothing is left. */
function bareFilename(name: string | undefined): string | undefined {
  const safe = name ? basename(name).trim() : '';
  if (!safe || safe === '.' || safe === '..') return undefined;
  // `-` means stdout to `writeBinary`; a document id must not redirect the
  // bytes there behind the caller's back.
  if (safe === '-') return undefined;
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
  if (!res.ok) {
    io.stderr(upstreamErrorJson(res));
    return { exitCode: 1 };
  }
  // A response that succeeded but carried no body is still a failure, but not
  // an upstream *error* — routing it through `upstreamErrorJson` would report
  // the success status it came back with (`HTTP 200`), which tells an agent
  // the opposite of what happened. Say what is actually wrong instead.
  if (!res.bytes) {
    io.stderr(
      JSON.stringify(
        {
          error: {
            code: 'HTTP_ERROR',
            message: `HTTP ${res.status} carried no file content for document ${docId}`,
          },
        },
        null,
        2,
      ),
    );
    return { exitCode: 1 };
  }

  const target = resolveDownloadTarget(out, res.fileName, docId);
  writeBinary(res.bytes, target, { force, quiet }, io);
  return { exitCode: 0 };
}
