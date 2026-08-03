import { describe, it, expect, vi } from 'vitest';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
  exitCodeFor,
  exitCodeForStatus,
  fetchOrThrow,
  httpError,
  redactUrl,
} from '../src/errors.js';

describe('exitCodeForStatus', () => {
  it('classifies auth failures as system errors', () => {
    expect(exitCodeForStatus(401)).toBe(EXIT_SYSTEM_ERROR);
    expect(exitCodeForStatus(403)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('classifies server faults as system errors', () => {
    expect(exitCodeForStatus(500)).toBe(EXIT_SYSTEM_ERROR);
    expect(exitCodeForStatus(503)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('classifies client-side statuses as user errors', () => {
    expect(exitCodeForStatus(400)).toBe(EXIT_USER_ERROR);
    expect(exitCodeForStatus(404)).toBe(EXIT_USER_ERROR);
    expect(exitCodeForStatus(409)).toBe(EXIT_USER_ERROR);
  });
});

describe('httpError', () => {
  it('returns a SystemError with AUTH_ERROR for 401/403', () => {
    const err = httpError(401);
    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('AUTH_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('returns a SystemError with SERVER_ERROR for 5xx', () => {
    const err = httpError(502);
    expect((err as SystemError).code).toBe('SERVER_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('returns a plain Error for user-side statuses', () => {
    const err = httpError(404);
    expect(err).not.toBeInstanceOf(SystemError);
    expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
  });

  it('keeps the `HTTP <status>` wording by default', () => {
    expect(httpError(404).message).toBe('HTTP 404');
    expect(httpError(500).message).toBe('HTTP 500');
  });

  it('prefers a server-supplied message when given', () => {
    expect(httpError(404, 'Tab not found').message).toBe('Tab not found');
  });
});

describe('fetchOrThrow', () => {
  it('passes a resolved response through untouched', async () => {
    const res = new Response('{}', { status: 404 });
    const impl = vi.fn().mockResolvedValue(res);
    await expect(fetchOrThrow('http://x/y', undefined, impl)).resolves.toBe(
      res,
    );
  });

  it('turns a transport failure into a NETWORK_ERROR system error', async () => {
    const impl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await fetchOrThrow('http://127.0.0.1:9/api', undefined, impl)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect((err as SystemError).message).toContain('http://127.0.0.1:9/api');
    expect((err as SystemError).message).toContain('fetch failed');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('forwards method and headers to the underlying fetch', async () => {
    const impl = vi.fn().mockResolvedValue(new Response('{}'));
    const init = { method: 'POST', headers: { A: 'b' } };
    await fetchOrThrow('http://x/y', init, impl);
    expect(impl).toHaveBeenCalledWith('http://x/y', init);
  });
});

describe('redactUrl', () => {
  it('drops userinfo credentials', () => {
    expect(redactUrl('https://user:s3cret@api.example/api/v1/documents')).toBe(
      'https://api.example/api/v1/documents',
    );
  });

  it('drops the query string and fragment', () => {
    expect(
      redactUrl('https://cdn.example/img.png?X-Amz-Signature=deadbeef#frag'),
    ).toBe('https://cdn.example/img.png');
  });

  it('keeps scheme, host and path so failures stay diagnosable', () => {
    expect(redactUrl('http://127.0.0.1:9/api/v1/x')).toBe(
      'http://127.0.0.1:9/api/v1/x',
    );
  });

  it('still strips secrets from an unparseable URL', () => {
    expect(redactUrl('//user:pw@host/path?token=abc')).toBe('//host/path');
  });
});

describe('exitCodeFor', () => {
  it('defaults to the user-error code', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT_USER_ERROR);
    expect(exitCodeFor('not an error')).toBe(EXIT_USER_ERROR);
  });

  it('reads a numeric exitCode off the error', () => {
    expect(exitCodeFor(new SystemError('AUTH_ERROR', 'nope'))).toBe(
      EXIT_SYSTEM_ERROR,
    );
  });

  it('ignores a non-numeric exitCode', () => {
    class Weird extends Error {
      readonly exitCode = 'two';
    }
    expect(exitCodeFor(new Weird('weird'))).toBe(EXIT_USER_ERROR);
  });
});
