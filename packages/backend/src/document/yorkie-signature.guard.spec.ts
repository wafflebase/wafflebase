import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { createHmac } from 'crypto';
import { YorkieSignatureGuard } from './yorkie-signature.guard';

const SECRET = 'test-secret-key';

function makeGuard(secret?: string): YorkieSignatureGuard {
  const config = {
    get: (key: string) =>
      key === 'YORKIE_SECRET_KEY' ? secret : undefined,
  } as unknown as ConfigService;
  return new YorkieSignatureGuard(config);
}

function contextFor(
  rawBody: Buffer | undefined,
  signature: string | undefined,
): ExecutionContext {
  const req = {
    rawBody,
    header: (name: string) =>
      name.toLowerCase() === 'x-signature-256' ? signature : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('YorkieSignatureGuard', () => {
  const body = Buffer.from(
    JSON.stringify({
      type: 'DocumentRootChanged',
      attributes: { key: 'sheet-1', issuedAt: '2026-07-10T00:00:00.000Z' },
    }),
  );

  it('accepts a correctly signed request', () => {
    const guard = makeGuard(SECRET);
    expect(guard.canActivate(contextFor(body, sign(body, SECRET)))).toBe(true);
  });

  it('rejects a signature computed with the wrong key', () => {
    const guard = makeGuard(SECRET);
    expect(() =>
      guard.canActivate(contextFor(body, sign(body, 'wrong-key'))),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when the body was tampered with after signing', () => {
    const guard = makeGuard(SECRET);
    const sig = sign(body, SECRET);
    const tampered = Buffer.from(body.toString().replace('sheet-1', 'sheet-2'));
    expect(() => guard.canActivate(contextFor(tampered, sig))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing signature header', () => {
    const guard = makeGuard(SECRET);
    expect(() => guard.canActivate(contextFor(body, undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the raw body was not captured', () => {
    const guard = makeGuard(SECRET);
    expect(() =>
      guard.canActivate(contextFor(undefined, sign(body, SECRET))),
    ).toThrow(UnauthorizedException);
  });

  it('refuses to authenticate when no secret is configured', () => {
    const guard = makeGuard(undefined);
    expect(() =>
      guard.canActivate(contextFor(body, sign(body, SECRET))),
    ).toThrow(ServiceUnavailableException);
  });
});
