import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { FileDocument } from '../client/http-client.js';
import { exitCodeForStatus } from '../errors.js';

/** Mirrors `MAX_FILE_UPLOAD_BYTES` in the backend's `file.constants.ts`. */
export const MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Mirrors `MAX_IMAGE_UPLOAD_BYTES` — images have no reason to be larger. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * Content types the CLI names explicitly. The browser gets `File.type` for
 * free; Node has no MIME database and pulling one in for this would be
 * disproportionate. So we name exactly the types the *serving* rule can act on
 * — the formats `file-response.util.ts` is willing to send inline — and leave
 * everything else opaque, which is what the server does with them regardless.
 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * Extensions another namespace parses into an editable document. `files
 * upload` deliberately does not: it stores bytes verbatim. Hitting one of
 * these earns a one-line stderr hint, not a redirect — a CLI should do what
 * the command says.
 */
const PARSED_BY: Record<string, string> = {
  xlsx: 'sheets import',
  csv: 'sheets import',
  docx: 'docs import',
  pptx: 'slides import',
  md: 'notes import',
  markdown: 'notes import',
};

/** Lowercased extension without the dot, or `''` when there is none. */
export function extensionOf(fileName: string): string {
  return extname(basename(fileName)).replace(/^\./, '').toLowerCase();
}

export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXT[extensionOf(fileName)] ?? 'application/octet-stream';
}

/**
 * The server-side cap this file will be measured against. Checked client-side
 * so an oversized file fails before the bytes go over the wire — the whole
 * point once arbitrary files (a multi-GB video) are accepted.
 */
export function uploadSizeCap(fileName: string): number {
  return IMAGE_EXTENSIONS.has(extensionOf(fileName))
    ? MAX_IMAGE_UPLOAD_BYTES
    : MAX_FILE_UPLOAD_BYTES;
}

/** Hint to show when a richer namespace would parse this file instead. */
export function parseHintFor(fileName: string): string | undefined {
  const command = PARSED_BY[extensionOf(fileName)];
  if (!command) return undefined;
  return `Note: uploading as raw bytes. Use \`wafflebase ${command}\` to import it as an editable document instead.`;
}

/** Optional document fields sent alongside the blob in the multipart body. */
export interface FileDocumentFields {
  title?: string;
  folderId?: string;
}

export interface FilesUploadClient {
  uploadFileDocument: (
    bytes: Uint8Array,
    fileName: string,
    mimeType: string,
    fields: FileDocumentFields,
  ) => Promise<{ ok: boolean; status: number; data: FileDocument }>;
}

export interface FilesUploadIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Bytes at `path`. */
  readBytes: (path: string) => Uint8Array;
  /** Size of `path` in bytes, without reading it. */
  sizeOf: (path: string) => number;
}

export const defaultFilesUploadIO: FilesUploadIO = {
  stdout: (line) => {
    process.stdout.write(line);
    if (!line.endsWith('\n')) process.stdout.write('\n');
  },
  stderr: (line) => {
    console.error(line);
  },
  readBytes: (path) => readFileSync(path),
  sizeOf: (path) => statSync(path).size,
};

export interface RunFilesUploadArgs {
  /** Source path. Unlike the import commands there is no `'-'` form: the
   *  document type and download extension both come from the filename, and
   *  stdin has none. */
  file: string;
  /** Document title. Defaults to the filename, extension included. */
  title?: string;
  /** Folder id to create the document in. Defaults to the workspace root. */
  folder?: string;
  quiet?: boolean;
  dryRun?: boolean;
}

export interface RunFilesUploadResult {
  exitCode: number;
}

/**
 * Pure orchestration for `files upload`. One request: the backend stores the
 * blob and creates the document together, so there is no partial state to
 * recover from here.
 */
export async function runFilesUpload(
  args: RunFilesUploadArgs,
  client: FilesUploadClient,
  io: FilesUploadIO = defaultFilesUploadIO,
): Promise<RunFilesUploadResult> {
  const { file, title, folder, quiet = false, dryRun = false } = args;
  const fields: FileDocumentFields = {
    ...(title ? { title } : {}),
    ...(folder ? { folderId: folder } : {}),
  };

  if (file === '-') {
    io.stderr(
      errorJson(
        'STDIN_UNSUPPORTED',
        'files upload needs a real path: the document type and download extension are derived from the filename.',
      ),
    );
    return { exitCode: 1 };
  }

  const fileName = basename(file);
  const mimeType = mimeTypeFor(fileName);

  let size: number;
  try {
    size = io.sizeOf(file);
  } catch {
    io.stderr(errorJson('FILE_NOT_FOUND', `Cannot read "${file}".`));
    return { exitCode: 1 };
  }

  const cap = uploadSizeCap(fileName);
  if (size > cap) {
    io.stderr(
      errorJson(
        'FILE_TOO_LARGE',
        `"${fileName}" is ${mb(size)} MB; the limit is ${mb(cap)} MB.`,
      ),
    );
    return { exitCode: 1 };
  }

  if (dryRun) {
    io.stdout(
      JSON.stringify(
        {
          method: 'POST',
          path: '/files',
          body: {
            file: `<${size} bytes of ${fileName}>`,
            // The server defaults the title to the whole filename, extension
            // included — a blob document *is* the file.
            title: title ?? fileName,
            ...(folder ? { folderId: folder } : {}),
          },
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  if (!quiet) {
    const hint = parseHintFor(fileName);
    if (hint) io.stderr(hint);
  }

  // `sizeOf` succeeding does not mean the bytes are readable: a directory
  // stats fine and then fails with EISDIR, and a file can be stat-able but
  // unreadable. Report it in the same envelope shape so an agent parsing
  // stderr never has to handle a bare stack trace.
  let bytes: Uint8Array;
  try {
    bytes = io.readBytes(file);
  } catch (err) {
    io.stderr(
      errorJson(
        'FILE_READ_FAILED',
        `Cannot read "${file}": ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { exitCode: 1 };
  }

  const res = await client.uploadFileDocument(bytes, fileName, mimeType, fields);
  if (!res.ok) {
    io.stderr(
      JSON.stringify(res.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2),
    );
    // The status decides the exit class: a rejected session or a broken
    // server is not something the caller can fix by picking another file.
    return { exitCode: exitCodeForStatus(res.status) };
  }

  io.stdout(JSON.stringify(res.data, null, 2));
  return { exitCode: 0 };
}

function errorJson(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } }, null, 2);
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
