import { BadRequestException } from '@nestjs/common';
import { parseImages } from './worksheet-images';

const IMAGE = {
  id: 'img-1',
  src: '/api/v1/workspaces/ws-1/images/abc.png',
  anchor: 'B2',
  offsetX: 8,
  offsetY: 8,
  width: 400,
  height: 300,
  originalWidth: 800,
  originalHeight: 600,
};

describe('parseImages', () => {
  it('accepts a well-formed collection', () => {
    expect(parseImages({ images: [IMAGE] })).toEqual([IMAGE]);
  });

  it('defaults the natural size to the placed size', () => {
    const { originalWidth: _w, originalHeight: _h, ...rest } = IMAGE;
    expect(parseImages({ images: [rest] })).toEqual([
      { ...rest, originalWidth: 400, originalHeight: 300 },
    ]);
  });

  it('keeps an optional alt text', () => {
    expect(parseImages({ images: [{ ...IMAGE, alt: 'Q3 chart' }] })[0].alt).toBe(
      'Q3 chart',
    );
  });

  it('rejects a body that is not { images: [...] }', () => {
    expect(() => parseImages([IMAGE])).toThrow(BadRequestException);
    expect(() => parseImages({ image: [IMAGE] })).toThrow(BadRequestException);
  });

  it('rejects a malformed A1 anchor', () => {
    expect(() => parseImages({ images: [{ ...IMAGE, anchor: 'nope!' }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-positive size', () => {
    expect(() => parseImages({ images: [{ ...IMAGE, width: 0 }] })).toThrow(
      BadRequestException,
    );
    expect(() => parseImages({ images: [{ ...IMAGE, height: -1 }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a missing id or src', () => {
    expect(() => parseImages({ images: [{ ...IMAGE, id: '' }] })).toThrow(
      BadRequestException,
    );
    expect(() => parseImages({ images: [{ ...IMAGE, src: undefined }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate ids, which the keyed store would silently collapse', () => {
    expect(() => parseImages({ images: [IMAGE, IMAGE] })).toThrow(
      BadRequestException,
    );
  });

  it('accepts an empty collection, which clears the tab', () => {
    expect(parseImages({ images: [] })).toEqual([]);
  });
});
