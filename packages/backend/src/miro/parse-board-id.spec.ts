import { BadRequestException } from '@nestjs/common';
import { parseMiroBoardId } from './parse-board-id';

describe('parseMiroBoardId', () => {
  it('extracts the id from a canonical board URL', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI=/')).toBe(
      'uXjVOD50NUI=',
    );
  });

  it('extracts the id when the URL has a trailing path or query', () => {
    expect(
      parseMiroBoardId(
        'https://miro.com/app/board/o9J_lJWSHdg=/?moveToWidget=123',
      ),
    ).toBe('o9J_lJWSHdg=');
  });

  it('decodes a percent-encoded padding character', () => {
    expect(parseMiroBoardId('https://miro.com/app/board/uXjVOD50NUI%3D/')).toBe(
      'uXjVOD50NUI=',
    );
  });

  it('accepts a bare board id', () => {
    expect(parseMiroBoardId('uXjVOD50NUI=')).toBe('uXjVOD50NUI=');
  });

  it('trims surrounding whitespace', () => {
    expect(parseMiroBoardId('  uXjVOD50NUI=  ')).toBe('uXjVOD50NUI=');
  });

  it('extracts the id from a live-embed URL', () => {
    expect(parseMiroBoardId('https://miro.com/app/live-embed/ABC/')).toBe(
      'ABC',
    );
  });

  it('accepts a miro.com subdomain', () => {
    expect(
      parseMiroBoardId('https://app.miro.com/app/board/uXjVOD50NUI=/'),
    ).toBe('uXjVOD50NUI=');
  });

  it('accepts a scheme-less board URL', () => {
    expect(parseMiroBoardId('miro.com/app/board/uXjVOD50NUI=/')).toBe(
      'uXjVOD50NUI=',
    );
  });

  it('rejects a non-Miro URL', () => {
    expect(() => parseMiroBoardId('https://example.com/whatever')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a URL that only mentions miro.com in its path', () => {
    // The host must really be Miro's — an attacker-controlled origin that
    // merely embeds the string `miro.com/app/board/...` must not be honoured.
    expect(() =>
      parseMiroBoardId('https://evil.com/miro.com/app/board/X'),
    ).toThrow(BadRequestException);
  });

  it('rejects a host that merely ends with the miro.com text', () => {
    expect(() => parseMiroBoardId('http://notmiro.com/app/board/X')).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseMiroBoardId('https://miro.com.evil.net/app/board/X'),
    ).toThrow(BadRequestException);
  });

  it('rejects a URL whose userinfo spoofs the Miro host', () => {
    expect(() =>
      parseMiroBoardId('https://miro.com@evil.com/app/board/X'),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty string', () => {
    expect(() => parseMiroBoardId('   ')).toThrow(BadRequestException);
  });

  it('rejects a bare id with a malformed percent sequence', () => {
    expect(() => parseMiroBoardId('ab%zz')).toThrow(BadRequestException);
  });

  it('rejects a bare id that decodes into a path delimiter', () => {
    // The bare-id branch tests for `/` on the STILL-ENCODED input, so `%2F`
    // sails through it and only becomes a delimiter after decoding — at which
    // point the value is spliced into the Miro request path.
    expect(() => parseMiroBoardId('ab%2Fcd')).toThrow(BadRequestException);
    expect(() => parseMiroBoardId('ab%5Ccd')).toThrow(BadRequestException);
  });

  it('rejects a bare id that decodes into whitespace', () => {
    expect(() => parseMiroBoardId('ab%20cd')).toThrow(BadRequestException);
    expect(() => parseMiroBoardId('ab%0Acd')).toThrow(BadRequestException);
  });

  it('rejects a board URL whose id segment decodes into a path delimiter', () => {
    expect(() =>
      parseMiroBoardId('https://miro.com/app/board/ab%2Fcd/'),
    ).toThrow(BadRequestException);
  });

  it('rejects a board URL with a malformed percent sequence', () => {
    expect(() =>
      parseMiroBoardId('https://miro.com/app/board/%E0%A4%A/'),
    ).toThrow(BadRequestException);
  });
});
