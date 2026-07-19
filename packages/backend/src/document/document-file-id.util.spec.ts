import { BadRequestException } from '@nestjs/common';
import { assertFileIdAllowed } from './document-file-id.util';

describe('assertFileIdAllowed', () => {
  it('allows a fileId on pdf and image documents', () => {
    expect(() => assertFileIdAllowed('pdf', 'blob.pdf')).not.toThrow();
    expect(() => assertFileIdAllowed('image', 'blob.png')).not.toThrow();
  });

  it('rejects a fileId on non-blob types', () => {
    for (const type of ['sheet', 'doc', 'slides', 'note', undefined]) {
      expect(() => assertFileIdAllowed(type, 'blob.png')).toThrow(
        BadRequestException,
      );
    }
  });

  it('is a no-op when no fileId is provided', () => {
    expect(() => assertFileIdAllowed('sheet', undefined)).not.toThrow();
  });
});
