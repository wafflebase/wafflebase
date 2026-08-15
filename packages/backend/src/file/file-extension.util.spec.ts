import { safeExtension } from './file-extension.util';

describe('safeExtension', () => {
  it('lowercases a normal extension', () => {
    expect(safeExtension('Report.PDF')).toBe('pdf');
    expect(safeExtension('archive.zip')).toBe('zip');
  });

  it('takes only the last segment', () => {
    expect(safeExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns null when there is no usable extension', () => {
    expect(safeExtension('Makefile')).toBeNull();
    expect(safeExtension('trailing.')).toBeNull();
  });

  it('rejects anything that is not short and alphanumeric', () => {
    // A path separator must never reach the S3 key.
    expect(safeExtension('../../etc/passwd')).toBeNull();
    expect(safeExtension('shell.php%00')).toBeNull();
    expect(safeExtension('a.' + 'x'.repeat(13))).toBeNull();
    expect(safeExtension('doc.한글')).toBeNull();
    expect(safeExtension('weird.ph p')).toBeNull();
  });
});
