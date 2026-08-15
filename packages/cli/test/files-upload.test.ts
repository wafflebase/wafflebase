import { describe, it, expect, vi } from 'vitest';
import {
  runFilesUpload,
  mimeTypeFor,
  uploadSizeCap,
  parseHintFor,
  MAX_FILE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  type FilesUploadIO,
} from '../src/files/upload.js';

function makeIO(size = 10) {
  const out: string[] = [];
  const err: string[] = [];
  const io: FilesUploadIO = {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readBytes: () => new Uint8Array([1, 2, 3]),
    sizeOf: () => size,
  };
  return { io, out, err };
}

function makeClient(ok = true) {
  return {
    uploadFileDocument: vi.fn().mockResolvedValue({
      ok,
      status: ok ? 201 : 500,
      data: ok
        ? { id: 'doc-1', title: 'bundle', type: 'file' }
        : { error: { code: 'HTTP_ERROR' } },
    }),
  };
}

describe('mimeTypeFor', () => {
  it('names the types the serving rule can act on', () => {
    expect(mimeTypeFor('a.png')).toBe('image/png');
    expect(mimeTypeFor('a.JPG')).toBe('image/jpeg');
    expect(mimeTypeFor('a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('a.pdf')).toBe('application/pdf');
  });

  it('leaves everything else opaque', () => {
    expect(mimeTypeFor('a.zip')).toBe('application/octet-stream');
    expect(mimeTypeFor('Makefile')).toBe('application/octet-stream');
  });
});

describe('uploadSizeCap', () => {
  it('applies the tighter image cap to image extensions', () => {
    expect(uploadSizeCap('photo.png')).toBe(MAX_IMAGE_UPLOAD_BYTES);
    expect(uploadSizeCap('photo.WEBP')).toBe(MAX_IMAGE_UPLOAD_BYTES);
    expect(uploadSizeCap('bundle.zip')).toBe(MAX_FILE_UPLOAD_BYTES);
    expect(uploadSizeCap('Makefile')).toBe(MAX_FILE_UPLOAD_BYTES);
  });
});

describe('parseHintFor', () => {
  it('points at the namespace that would parse the file', () => {
    expect(parseHintFor('a.xlsx')).toContain('sheets import');
    expect(parseHintFor('a.docx')).toContain('docs import');
    expect(parseHintFor('a.pptx')).toContain('slides import');
    expect(parseHintFor('a.md')).toContain('notes import');
  });

  it('is silent for formats nothing parses', () => {
    expect(parseHintFor('a.zip')).toBeUndefined();
    expect(parseHintFor('a.png')).toBeUndefined();
  });
});

describe('runFilesUpload', () => {
  it('uploads the bytes with the filename and derived MIME', async () => {
    const { io, out } = makeIO();
    const client = makeClient();
    const res = await runFilesUpload({ file: '/tmp/photo.png' }, client, io);
    expect(res.exitCode).toBe(0);
    expect(client.uploadFileDocument).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'photo.png',
      'image/png',
      {},
    );
    expect(JSON.parse(out.join(''))).toMatchObject({ id: 'doc-1' });
  });

  it('forwards an explicit title', async () => {
    const { io } = makeIO();
    const client = makeClient();
    await runFilesUpload(
      { file: 'bundle.zip', title: 'Q3 archive' },
      client,
      io,
    );
    expect(client.uploadFileDocument).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'bundle.zip',
      'application/octet-stream',
      { title: 'Q3 archive' },
    );
  });

  it('forwards a folder', async () => {
    const { io } = makeIO();
    const client = makeClient();
    await runFilesUpload({ file: 'bundle.zip', folder: 'folder-7' }, client, io);
    expect(client.uploadFileDocument).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'bundle.zip',
      'application/octet-stream',
      { folderId: 'folder-7' },
    );
  });

  it('rejects an oversized file before sending any bytes', async () => {
    const { io, err } = makeIO(MAX_FILE_UPLOAD_BYTES + 1);
    const client = makeClient();
    const res = await runFilesUpload({ file: 'huge.zip' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(client.uploadFileDocument).not.toHaveBeenCalled();
    expect(JSON.parse(err.join(''))).toMatchObject({
      error: { code: 'FILE_TOO_LARGE' },
    });
  });

  it('applies the image cap to an image, not the generic one', async () => {
    const { io, err } = makeIO(MAX_IMAGE_UPLOAD_BYTES + 1);
    const client = makeClient();
    const res = await runFilesUpload({ file: 'huge.png' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(err.join('')).toContain('FILE_TOO_LARGE');
  });

  it('reports an unreadable path without calling the server', async () => {
    const { io, err } = makeIO();
    io.sizeOf = () => {
      throw new Error('ENOENT');
    };
    const client = makeClient();
    const res = await runFilesUpload({ file: 'nope.zip' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(client.uploadFileDocument).not.toHaveBeenCalled();
    expect(err.join('')).toContain('FILE_NOT_FOUND');
  });

  it('reports a stat-able but unreadable path (e.g. a directory)', async () => {
    const { io, err } = makeIO();
    io.readBytes = () => {
      throw new Error('EISDIR: illegal operation on a directory, read');
    };
    const client = makeClient();
    const res = await runFilesUpload({ file: 'somedir' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(client.uploadFileDocument).not.toHaveBeenCalled();
    const body = JSON.parse(err.join(''));
    expect(body.error.code).toBe('FILE_READ_FAILED');
    expect(body.error.message).toContain('EISDIR');
  });

  it('refuses stdin, which carries no filename to derive a type from', async () => {
    const { io, err } = makeIO();
    const client = makeClient();
    const res = await runFilesUpload({ file: '-' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(client.uploadFileDocument).not.toHaveBeenCalled();
    expect(err.join('')).toContain('STDIN_UNSUPPORTED');
  });

  it('hints at the parsing namespace but still uploads the bytes', async () => {
    const { io, err } = makeIO();
    const client = makeClient();
    const res = await runFilesUpload({ file: 'budget.xlsx' }, client, io);
    expect(res.exitCode).toBe(0);
    expect(client.uploadFileDocument).toHaveBeenCalled();
    expect(err.join('')).toContain('sheets import');
  });

  it('stays silent about the hint under --quiet', async () => {
    const { io, err } = makeIO();
    await runFilesUpload({ file: 'budget.xlsx', quiet: true }, makeClient(), io);
    expect(err).toHaveLength(0);
  });

  it('prints the request and sends nothing under --dry-run', async () => {
    const { io, out } = makeIO();
    const client = makeClient();
    const res = await runFilesUpload(
      { file: 'dir/bundle.zip', dryRun: true },
      client,
      io,
    );
    expect(res.exitCode).toBe(0);
    expect(client.uploadFileDocument).not.toHaveBeenCalled();
    expect(JSON.parse(out.join(''))).toMatchObject({
      method: 'POST',
      path: '/files',
      body: { title: 'bundle.zip' },
    });
  });

  it('shows the folder in the dry-run body', async () => {
    const { io, out } = makeIO();
    const client = makeClient();
    await runFilesUpload(
      { file: 'dir/bundle.zip', folder: 'folder-7', dryRun: true },
      client,
      io,
    );
    expect(JSON.parse(out.join(''))).toMatchObject({
      body: { title: 'bundle.zip', folderId: 'folder-7' },
    });
  });

  it('surfaces a server error envelope and exits non-zero', async () => {
    const { io, err } = makeIO();
    const res = await runFilesUpload(
      { file: 'bundle.zip' },
      makeClient(false),
      io,
    );
    expect(res.exitCode).toBe(1);
    expect(err.join('')).toContain('HTTP_ERROR');
  });
});
