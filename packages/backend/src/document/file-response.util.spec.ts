import { fileResponseHeaders } from './file-response.util';

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('fileResponseHeaders', () => {
  it('pins a pdf document to application/pdf regardless of what is stored', () => {
    expect(fileResponseHeaders('pdf', 'text/html', 'report')).toEqual({
      contentType: 'application/pdf',
      disposition: "inline; filename*=UTF-8''report",
    });
  });

  it('names the file on inline dispositions too', () => {
    // "Save as" in a browser, and `files download` in the CLI, both take the
    // name from here; without it a PDF saves as the uuid in the URL.
    expect(
      fileResponseHeaders(
        'pdf',
        'application/pdf',
        'report',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      ).disposition,
    ).toBe("inline; filename*=UTF-8''report.pdf");
    expect(
      fileResponseHeaders(
        'image',
        'image/png',
        'shot',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png',
      ).disposition,
    ).toBe("inline; filename*=UTF-8''shot.png");
  });

  it('serves an image inline only for the four safe raster types', () => {
    expect(fileResponseHeaders('image', 'image/png', 'shot')).toEqual({
      contentType: 'image/png',
      disposition: "inline; filename*=UTF-8''shot",
    });
    // The adversarial case: a blob stored as html on an image document must
    // never render in the backend origin.
    expect(fileResponseHeaders('image', 'text/html', 'shot').contentType).toBe(
      'application/octet-stream',
    );
    expect(
      fileResponseHeaders('image', 'image/svg+xml', 'shot').disposition,
    ).toMatch(/^attachment/);
  });

  it('always serves a file document as an opaque attachment', () => {
    const headers = fileResponseHeaders('file', 'text/html', 'page');
    expect(headers.contentType).toBe('application/octet-stream');
    expect(headers.disposition).toBe("attachment; filename*=UTF-8''page");
  });

  it('encodes the filename so a crafted title cannot inject a header', () => {
    const headers = fileResponseHeaders(
      'file',
      'application/zip',
      'evil\r\nX-Injected: 1',
    );
    expect(headers.disposition).not.toContain('\r');
    expect(headers.disposition).not.toContain('\n');
  });

  it('percent-encodes non-ascii titles', () => {
    expect(
      fileResponseHeaders('file', 'application/zip', '보고서').disposition,
    ).toBe("attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C");
  });

  it("appends the blob's extension (from fileId) to a title that lost it at upload", () => {
    const headers = fileResponseHeaders(
      'file',
      'application/zip',
      'report',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.zip',
    );
    expect(headers.disposition).toBe("attachment; filename*=UTF-8''report.zip");
  });

  it('does not double the extension when the title already ends with it', () => {
    const headers = fileResponseHeaders(
      'file',
      'application/zip',
      'report.zip',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.zip',
    );
    expect(headers.disposition).toBe("attachment; filename*=UTF-8''report.zip");
  });

  it('leaves the title bare when the blob key has no dot (extension-less upload)', () => {
    const headers = fileResponseHeaders(
      'file',
      'application/octet-stream',
      'Makefile',
      '11111111-2222-3333-4444-555555555555',
    );
    expect(headers.disposition).toBe("attachment; filename*=UTF-8''Makefile");
  });

  it('still strips CR/LF when an extension is appended from fileId', () => {
    const headers = fileResponseHeaders(
      'file',
      'application/zip',
      'evil\r\nX-Injected: 1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.zip',
    );
    expect(headers.disposition).not.toContain('\r');
    expect(headers.disposition).not.toContain('\n');
    expect(headers.disposition).toContain('.zip');
  });

  it('degrades to the blob key rather than throwing on a missing title', () => {
    const fileId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf';
    expect(
      fileResponseHeaders('pdf', 'application/pdf', undefined as never, fileId)
        .disposition,
    ).toBe(`inline; filename*=UTF-8''${fileId}`);
    expect(
      fileResponseHeaders('file', 'application/zip', '   ').disposition,
    ).toBe("attachment; filename*=UTF-8''download");
  });

  it('falls back to an attachment for any type without a viewer rule', () => {
    // A CRDT-typed row carrying a fileId is not reachable through the API,
    // but a migration or direct write could make one. It must not render.
    for (const type of ['doc', 'sheet', 'slides', 'note', 'board', '']) {
      const headers = fileResponseHeaders(type, 'text/html', 't');
      expect(headers.contentType).toBe('application/octet-stream');
      expect(headers.disposition).toMatch(/^attachment/);
    }
  });

  // Uploads now keep the extension in the title, so the key-based re-append
  // must not double it — while still covering rows stored before that change.
  it('does not double an extension the title already carries', () => {
    expect(
      fileResponseHeaders('file', 'application/zip', 'bundle.zip', `${UUID}.zip`)
        .disposition,
    ).toBe("attachment; filename*=UTF-8''bundle.zip");

    // Case-insensitively, too.
    expect(
      fileResponseHeaders('file', 'application/zip', 'bundle.ZIP', `${UUID}.zip`)
        .disposition,
    ).toBe("attachment; filename*=UTF-8''bundle.ZIP");
  });

  it('keeps a title extension the storage key does not have', () => {
    // `safeExtension` rejects `c++`, so the blob is stored under a bare uuid.
    // The title is the only thing carrying the extension; it must survive.
    expect(
      fileResponseHeaders('file', 'application/octet-stream', 'archive.c++', UUID)
        .disposition,
    ).toBe("attachment; filename*=UTF-8''archive.c%2B%2B");
  });

  it('still re-appends for a row stored before titles kept the extension', () => {
    expect(
      fileResponseHeaders('file', 'application/zip', 'bundle', `${UUID}.zip`)
        .disposition,
    ).toBe("attachment; filename*=UTF-8''bundle.zip");
  });

  it('echoes an image content type only on an exact, case-sensitive match', () => {
    for (const stored of [
      'image/png; charset=x',
      'IMAGE/PNG',
      ' image/png',
      'image/png ',
      'image/pngx',
      'text/html, image/png',
      'image/png\n',
      'image/svg+xml',
    ]) {
      expect(fileResponseHeaders('image', stored, 't').contentType).toBe(
        'application/octet-stream',
      );
    }
  });
});
