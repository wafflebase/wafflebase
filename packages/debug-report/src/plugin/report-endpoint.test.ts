import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSafeSegment, isTrustedRequest, prepareCaptures } from './report-endpoint';

const dir = () => mkdtempSync(path.join(tmpdir(), 'wb-debug-'));

const jpeg = `data:image/jpeg;base64,${Buffer.from('pretend jpeg').toString('base64')}`;

describe('isSafeSegment', () => {
  it('accepts a plain identifier', () => {
    expect(isSafeSegment('cap-1a2b')).toBe(true);
    expect(isSafeSegment('wb-abc123')).toBe(true);
  });

  it('rejects traversal, including the forms a character class alone allows', () => {
    // `/^[A-Za-z0-9._-]+$/` matches ".." — and `path.join(root, ".wb-reports",
    // "..")` IS the repository root, so a bundle could have written its JSON and
    // arbitrary image bytes straight into the checkout.
    expect(isSafeSegment('..')).toBe(false);
    expect(isSafeSegment('.')).toBe(false);
    expect(isSafeSegment('../../etc/passwd')).toBe(false);
    expect(isSafeSegment('a/b')).toBe(false);
    expect(isSafeSegment('')).toBe(false);
    expect(isSafeSegment(undefined)).toBe(false);
  });
});

describe('isTrustedRequest', () => {
  const req = (headers: Record<string, string | undefined>) => ({ headers });

  it('accepts a same-origin JSON request', () => {
    expect(
      isTrustedRequest(
        req({ 'content-type': 'application/json', origin: 'http://localhost:5173', host: 'localhost:5173' }),
      ).ok,
    ).toBe(true);
  });

  it('accepts a request with no Origin, which is a same-origin fetch or a tool', () => {
    expect(isTrustedRequest(req({ 'content-type': 'application/json; charset=utf-8' })).ok).toBe(true);
  });

  it('refuses a cross-origin request', () => {
    // These endpoints write into the repository and spend a model credential,
    // on a port every page the developer visits can reach.
    const answer = isTrustedRequest(
      req({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:5173' }),
    );
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toMatch(/cross-origin/);
  });

  it('refuses a content type a cross-origin page could send without a preflight', () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      expect(isTrustedRequest(req({ 'content-type': type })).ok).toBe(false);
    }
  });

  it('refuses an unreadable Origin', () => {
    expect(
      isTrustedRequest(req({ 'content-type': 'application/json', origin: 'not a url', host: 'x' })).ok,
    ).toBe(false);
  });
});

describe('prepareCaptures', () => {
  it('decodes each image under its own filename, and writes nothing', () => {
    const out = dir();
    const { prepared, refused } = prepareCaptures([
      { id: 'cap-1', dataUrl: jpeg },
      { id: 'cap-2', dataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}` },
    ]);
    expect(prepared.map((c) => c.name)).toEqual(['cap-1.jpg', 'cap-2.png']);
    expect(prepared[0].bytes.toString()).toBe('pretend jpeg');
    expect(refused).toEqual([]);
    // Decoding and writing are separate so the handover can be all or nothing.
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses an id that is not a plain filename, and says which', () => {
    const { prepared, refused } = prepareCaptures([
      { id: '../escape', dataUrl: jpeg },
      { id: 'cap-ok', dataUrl: jpeg },
    ]);
    expect(prepared.map((c) => c.name)).toEqual(['cap-ok.jpg']);
    expect(refused).toEqual(['../escape']);
  });

  it('refuses a data URL that is not an image', () => {
    const { prepared, refused } = prepareCaptures([
      { id: 'cap-1', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
      { id: 'cap-2', dataUrl: 'not a data url' },
    ]);
    expect(prepared).toEqual([]);
    expect(refused).toEqual(['cap-1', 'cap-2']);
  });

  it('tolerates a missing or malformed capture list', () => {
    expect(prepareCaptures(undefined)).toEqual({ prepared: [], refused: [] });
    expect(prepareCaptures('nope')).toEqual({ prepared: [], refused: [] });
    expect(prepareCaptures([null]).refused).toEqual(['<unnamed>']);
  });
});
