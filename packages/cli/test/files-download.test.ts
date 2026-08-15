import { describe, it, expect, vi } from 'vitest';
import {
  runFilesDownload,
  resolveDownloadTarget,
} from '../src/files/download.js';
import { parseContentDispositionFilename } from '../src/client/content-disposition.js';
import type { BinaryIO } from '../src/output/binary.js';

function makeIO() {
  const writes: Array<{ path: string; bytes: Uint8Array; force: boolean }> = [];
  const stdout: Uint8Array[] = [];
  const err: string[] = [];
  const io: BinaryIO = {
    stdout: (b) => stdout.push(b),
    stderr: (l) => err.push(l),
    writeFile: (path, bytes, force) => writes.push({ path, bytes, force }),
  };
  return { io, writes, stdout, err };
}

describe('parseContentDispositionFilename', () => {
  it('prefers the RFC 5987 extended form', () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''quarterly%20report.zip",
      ),
    ).toBe('quarterly report.zip');
  });

  it('decodes non-ASCII titles', () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf",
      ),
    ).toBe('보고서.pdf');
  });

  it('falls back to the plain form', () => {
    expect(
      parseContentDispositionFilename('attachment; filename="report.pdf"'),
    ).toBe('report.pdf');
    expect(parseContentDispositionFilename('inline; filename=report.pdf')).toBe(
      'report.pdf',
    );
  });

  it('returns undefined when there is nothing to read', () => {
    expect(parseContentDispositionFilename(null)).toBeUndefined();
    expect(parseContentDispositionFilename('inline')).toBeUndefined();
    expect(parseContentDispositionFilename('attachment; filename=""')).toBeUndefined();
  });

  it('does not throw on malformed percent-encoding', () => {
    expect(
      parseContentDispositionFilename("attachment; filename*=UTF-8''%E0%A4%A"),
    ).toBeUndefined();
  });
});

describe('resolveDownloadTarget', () => {
  it('honors an explicit output path', () => {
    expect(resolveDownloadTarget('out/a.zip', 'server.zip', 'doc-1')).toBe(
      'out/a.zip',
    );
    expect(resolveDownloadTarget('-', 'server.zip', 'doc-1')).toBe('-');
  });

  it('uses the server filename when none is given', () => {
    expect(resolveDownloadTarget(undefined, 'report.pdf', 'doc-1')).toBe(
      'report.pdf',
    );
  });

  it('strips any directory component from the server filename', () => {
    expect(
      resolveDownloadTarget(undefined, '../../.bashrc', 'doc-1'),
    ).toBe('.bashrc');
    expect(resolveDownloadTarget(undefined, '/etc/passwd', 'doc-1')).toBe(
      'passwd',
    );
  });

  it('falls back to the document id when the name is unusable', () => {
    expect(resolveDownloadTarget(undefined, undefined, 'doc-1')).toBe('doc-1');
    expect(resolveDownloadTarget(undefined, '   ', 'doc-1')).toBe('doc-1');
    expect(resolveDownloadTarget(undefined, '..', 'doc-1')).toBe('doc-1');
    expect(resolveDownloadTarget(undefined, '../..', 'doc-1')).toBe('doc-1');
  });
});

describe('runFilesDownload', () => {
  const bytes = new Uint8Array([7, 8, 9]);

  it('writes to the server-advertised filename by default', async () => {
    const { io, writes } = makeIO();
    const client = {
      downloadFileDocument: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, bytes, fileName: 'a.zip' }),
    };
    const res = await runFilesDownload({ docId: 'doc-1' }, client, io);
    expect(res.exitCode).toBe(0);
    expect(writes).toEqual([{ path: 'a.zip', bytes, force: false }]);
  });

  it('writes to stdout for -', async () => {
    const { io, stdout, writes } = makeIO();
    const client = {
      downloadFileDocument: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, bytes, fileName: 'a.zip' }),
    };
    await runFilesDownload({ docId: 'doc-1', out: '-' }, client, io);
    expect(stdout).toEqual([bytes]);
    expect(writes).toHaveLength(0);
  });

  it('forwards --force to the writer', async () => {
    const { io, writes } = makeIO();
    const client = {
      downloadFileDocument: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, bytes, fileName: 'a.zip' }),
    };
    await runFilesDownload({ docId: 'doc-1', force: true }, client, io);
    expect(writes[0].force).toBe(true);
  });

  it('reports a failed request and writes nothing', async () => {
    const { io, writes, err } = makeIO();
    const client = {
      downloadFileDocument: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        data: { error: { code: 'NOT_FOUND' } },
      }),
    };
    const res = await runFilesDownload({ docId: 'doc-1' }, client, io);
    expect(res.exitCode).toBe(1);
    expect(writes).toHaveLength(0);
    expect(err.join('')).toContain('NOT_FOUND');
  });
});
