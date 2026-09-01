import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/commands/root.js';
import { registerImagesCommand } from '../src/commands/images.js';

/**
 * Drives the REAL command through commander rather than a stand-in, because
 * the behaviours worth guarding here — where the image-type and size checks
 * sit relative to the dry-run branch, that the multipart preview names the
 * part the client actually sends, and which client method each subcommand
 * reaches for — live in the action handler's wiring, not in any function it
 * calls. The filesystem is real (a temp dir), so the read path is exercised
 * rather than mocked away.
 */

const uploadImage = vi.fn();
const downloadImage = vi.fn();
const deleteImage = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    uploadImage = (...a: unknown[]) => uploadImage(...a);
    downloadImage = (...a: unknown[]) => downloadImage(...a);
    deleteImage = (...a: unknown[]) => deleteImage(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const IMAGE_ID = '11111111-2222-3333-4444-555555555555';

/** Eight bytes standing in for a PNG; only its length and extension matter. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function run(argv: string[]) {
  const program = createProgram();
  // `images` is a top-level namespace in the real CLI, mounted on the root
  // program exactly as it is here.
  registerImagesCommand(program);
  return program.parseAsync(
    [
      '--server',
      SERVER,
      '--workspace',
      WORKSPACE,
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('images commands', () => {
  let stdout: string[];
  let stderr: string[];
  let dir: string;
  let png: string;
  const originalEnv = {
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    uploadImage.mockReset();
    downloadImage.mockReset();
    deleteImage.mockReset();
    // Never read the developer's real session/config: the flags above already
    // pin the server and workspace, and an on-disk profile must not change
    // what these assertions see.
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    dir = mkdtempSync(join(tmpdir(), 'wb-images-'));
    png = join(dir, 'logo.png');
    writeFileSync(png, PNG_BYTES);
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation((v) => {
      stderr.push(String(v));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = undefined;
  });

  describe('upload', () => {
    it('posts the bytes, the filename and the derived content type', async () => {
      uploadImage.mockResolvedValue({
        ok: true,
        status: 201,
        data: {
          id: IMAGE_ID,
          url: `/api/v1/workspaces/${WORKSPACE}/images/${IMAGE_ID}`,
        },
      });

      await run(['images', 'upload', png]);

      expect(uploadImage).toHaveBeenCalledTimes(1);
      const [bytes, fileName, mimeType] = uploadImage.mock.calls[0] as [
        Uint8Array,
        string,
        string,
      ];
      expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
      // The basename, not the caller's path: the multipart part is a name.
      expect(fileName).toBe('logo.png');
      expect(mimeType).toBe('image/png');
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ id: IMAGE_ID });
      expect(process.exitCode).toBeUndefined();
    });

    it('previews the multipart part without sending it under --dry-run', async () => {
      await run(['images', 'upload', png, '--dry-run']);

      expect(uploadImage).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/images`,
        body: { file: `<${PNG_BYTES.length} bytes of logo.png>` },
      });
    });

    it('rejects an unsupported image type BEFORE the dry-run branch', async () => {
      // A dry run whose printed request the server's `fileFilter` would reject
      // is worse than no dry run at all.
      const svg = join(dir, 'logo.svg');
      writeFileSync(svg, '<svg/>');

      await run(['images', 'upload', svg, '--dry-run']);

      expect(stdout).toEqual([]);
      expect(uploadImage).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { code: string; message: string; command: string };
      };
      expect(err.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
      expect(err.error.message).toMatch(/png, jpeg, gif, and webp/);
      expect(err.error.command).toBe('images.upload');
    });

    it('reports a missing file without reaching the client', async () => {
      await run(['images', 'upload', join(dir, 'absent.png')]);

      expect(uploadImage).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('FILE_NOT_FOUND');
    });

    it('envelopes a rejected upload instead of printing a body', async () => {
      uploadImage.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['images', 'upload', png]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    it('forwards the upstream envelope of a rejected session verbatim', async () => {
      uploadImage.mockResolvedValue({
        ok: false,
        status: 401,
        data: { error: { code: 'SESSION_EXPIRED', message: 'expired' } },
      });

      await run(['images', 'upload', png]);

      expect(stdout).toEqual([]);
      // 401 is not something the caller fixes by retyping — system class.
      expect(process.exitCode).toBe(2);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { code: string; command: string };
      };
      expect(err.error.code).toBe('SESSION_EXPIRED');
      expect(err.error.command).toBe('images.upload');
    });

    it('rejects a bad --format before storing the image', async () => {
      await run(['images', 'upload', png, '--format', 'bogus']);

      expect(uploadImage).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('get', () => {
    it('writes the downloaded bytes to the given path', async () => {
      downloadImage.mockResolvedValue({
        ok: true,
        status: 200,
        bytes: PNG_BYTES,
      });
      const out = join(dir, 'out.png');

      await run(['images', 'get', IMAGE_ID, out]);

      expect(downloadImage).toHaveBeenCalledWith(IMAGE_ID);
      expect(Array.from(readFileSync(out))).toEqual(Array.from(PNG_BYTES));
      expect(stderr.join('\n')).toMatch(/Wrote 8 bytes/);
      expect(process.exitCode).toBeUndefined();
    });

    it('falls back to the image id when no output path is given', async () => {
      // The read route sends no `Content-Disposition`, so the id is the only
      // name left; it lands in the working directory like `files download`.
      downloadImage.mockResolvedValue({
        ok: true,
        status: 200,
        bytes: PNG_BYTES,
      });
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        await run(['images', 'get', IMAGE_ID]);
      } finally {
        process.chdir(cwd);
      }

      expect(Array.from(readFileSync(join(dir, IMAGE_ID)))).toEqual(
        Array.from(PNG_BYTES),
      );
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['images', 'get', IMAGE_ID, '--dry-run']);

      expect(downloadImage).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/images/${IMAGE_ID}`,
      });
    });

    it('envelopes a missing image instead of writing a file', async () => {
      downloadImage.mockResolvedValue({
        ok: false,
        status: 404,
        data: { message: 'Image not found' },
      });

      await run(['images', 'get', IMAGE_ID, join(dir, 'out.png')]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { code: string; message: string };
      };
      expect(err.error.code).toBe('HTTP_ERROR');
      expect(err.error.message).toMatch(/404: Image not found/);
    });

    it('treats an empty 200 as a server fault, not an HTTP 200 success', async () => {
      downloadImage.mockResolvedValue({ ok: true, status: 200 });

      await run(['images', 'get', IMAGE_ID, join(dir, 'out.png')]);

      expect(process.exitCode).toBe(2);
      expect(stderr.join('\n')).toMatch(/carried no image content/);
    });

    it('envelopes a dot-segment id from the preview rather than rejecting the action promise', async () => {
      // Why the dry-run branch lives inside the try: the preview interpolates
      // the id with `seg()`, which refuses `.` / `..`, and that refusal has to
      // reach `outputError` as the documented envelope.
      await run(['images', 'get', '..', join(dir, 'out.png'), '--dry-run']);

      expect(stdout).toEqual([]);
      expect(downloadImage).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string; command: string };
      };
      expect(err.error.message).toMatch(/Invalid path segment/);
      expect(err.error.command).toBe('images.get');
    });
  });

  describe('delete', () => {
    it('deletes the image and prints the server response', async () => {
      deleteImage.mockResolvedValue({
        ok: true,
        status: 200,
        data: { deleted: true },
      });

      await run(['images', 'delete', IMAGE_ID]);

      expect(deleteImage).toHaveBeenCalledWith(IMAGE_ID);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ deleted: true });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['images', 'delete', IMAGE_ID, '--dry-run']);

      expect(deleteImage).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'DELETE',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/images/${IMAGE_ID}`,
      });
    });

    it('envelopes a rejected delete instead of printing a body', async () => {
      deleteImage.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['images', 'delete', 'not-a-uuid']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    it('rejects a bad --format before deleting the image', async () => {
      await run(['images', 'delete', IMAGE_ID, '--format', 'bogus']);

      expect(deleteImage).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('images command registration', () => {
  it('mounts upload, get and delete under an `images` group aliased `image`', () => {
    const program = new Command();
    registerImagesCommand(program);
    const images = program.commands.find((c) => c.name() === 'images');
    expect(images?.aliases()).toEqual(['image']);
    expect(images?.commands.map((c) => c.name()).sort()).toEqual([
      'delete',
      'get',
      'upload',
    ]);
  });
});
