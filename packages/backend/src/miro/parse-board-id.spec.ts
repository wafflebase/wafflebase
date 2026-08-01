import { BadRequestException } from '@nestjs/common';
import { parseMiroBoardId } from './parse-board-id';

describe('parseMiroBoardId', () => {
  it('extracts the id from a canonical board URL', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI=/')).toBe('uXjVOD50NUI=');
  });

  it('extracts the id when the URL has a trailing path or query', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/o9J_lJWSHdg=/?moveToWidget=123')).toBe('o9J_lJWSHdg=');
  });

  it('decodes a percent-encoded padding character', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI%3D/')).toBe('uXjVOD50NUI=');
  });

  it('accepts a bare board id', () => {
    expect(parseMiroBoardId('uXjVOD50NUI=')).toBe('uXjVOD50NUI=');
  });

  it('trims surrounding whitespace', () => {
    expect(parseMiroBoardId('  uXjVOD50NUI=  ')).toBe('uXjVOD50NUI=');
  });

  it('rejects a non-Miro URL', () => {
    expect(() => parseMiroBoardId('https://example.com/whatever')).toThrow(BadRequestException);
  });

  it('rejects an empty string', () => {
    expect(() => parseMiroBoardId('   ')).toThrow(BadRequestException);
  });
});
