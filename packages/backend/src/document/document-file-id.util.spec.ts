import { BadRequestException } from '@nestjs/common';
import {
  assertFileIdAllowed,
  blobDocumentTypeFor,
  isBlobBacked,
} from './document-file-id.util';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('isBlobBacked', () => {
  it('is true for exactly the blob types', () => {
    expect(isBlobBacked('pdf')).toBe(true);
    expect(isBlobBacked('image')).toBe(true);
    expect(isBlobBacked('file')).toBe(true);
    expect(isBlobBacked('sheet')).toBe(false);
    expect(isBlobBacked('doc')).toBe(false);
    expect(isBlobBacked(undefined)).toBe(false);
  });
});

describe('assertFileIdAllowed', () => {
  it('allows no fileId on any type', () => {
    expect(() => assertFileIdAllowed('sheet', undefined)).not.toThrow();
    expect(() => assertFileIdAllowed('file', undefined)).not.toThrow();
  });

  it('rejects a fileId on a non-blob type', () => {
    expect(() => assertFileIdAllowed('sheet', `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed(undefined, `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
  });

  it('requires the extension to match the declared type', () => {
    expect(() => assertFileIdAllowed('pdf', `${UUID}.pdf`)).not.toThrow();
    expect(() => assertFileIdAllowed('pdf', `${UUID}.html`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed('pdf', `${UUID}.png`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed('image', `${UUID}.png`)).not.toThrow();
    expect(() => assertFileIdAllowed('image', `${UUID}.jpeg`)).not.toThrow();
    expect(() => assertFileIdAllowed('image', `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
  });

  it('accepts any extension, and none, on a file document', () => {
    expect(() => assertFileIdAllowed('file', `${UUID}.zip`)).not.toThrow();
    expect(() => assertFileIdAllowed('file', `${UUID}.html`)).not.toThrow();
    expect(() => assertFileIdAllowed('file', UUID)).not.toThrow();
  });
});

describe('blobDocumentTypeFor', () => {
  it('routes the viewer-backed formats to their own type', () => {
    expect(blobDocumentTypeFor(`${UUID}.pdf`)).toBe('pdf');
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
      expect(blobDocumentTypeFor(`${UUID}.${ext}`)).toBe('image');
    }
  });

  it('falls back to file for everything else, including no extension', () => {
    expect(blobDocumentTypeFor(`${UUID}.zip`)).toBe('file');
    expect(blobDocumentTypeFor(`${UUID}.html`)).toBe('file');
    // Parseable formats are stored as bytes — `files upload` never parses.
    expect(blobDocumentTypeFor(`${UUID}.xlsx`)).toBe('file');
    expect(blobDocumentTypeFor(`${UUID}.docx`)).toBe('file');
    expect(blobDocumentTypeFor(UUID)).toBe('file');
  });

  it('always returns a type its own fileId satisfies', () => {
    for (const id of [`${UUID}.pdf`, `${UUID}.png`, `${UUID}.zip`, UUID]) {
      expect(() =>
        assertFileIdAllowed(blobDocumentTypeFor(id), id),
      ).not.toThrow();
    }
  });
});
