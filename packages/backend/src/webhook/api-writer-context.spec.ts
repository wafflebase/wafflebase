import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import {
  ApiWriterInterceptor,
  apiWriterOf,
  currentApiWriter,
} from './api-writer-context';

function httpContext(user: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

/** A handler that reports the writer it ran as, after an async hop. */
const handler: CallHandler = {
  handle: () =>
    defer(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return currentApiWriter();
    }),
};

describe('apiWriterOf', () => {
  it('reads the key id and minter off an API-key request user', () => {
    expect(
      apiWriterOf({ isApiKey: true, apiKeyId: 'k1', id: 7, scopes: [] }),
    ).toEqual({ apiKeyId: 'k1', userId: 7 });
  });

  it('is undefined for a session, or a key without an id', () => {
    expect(apiWriterOf({ id: 7, username: 'ada' })).toBeUndefined();
    expect(apiWriterOf({ isApiKey: true, id: 7 })).toBeUndefined();
    expect(apiWriterOf(undefined)).toBeUndefined();
  });
});

describe('ApiWriterInterceptor', () => {
  const interceptor = new ApiWriterInterceptor();

  it('runs an API-key request inside its writer context', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        httpContext({ isApiKey: true, apiKeyId: 'k1', id: 7 }),
        handler,
      ),
    );
    expect(result).toEqual({ apiKeyId: 'k1', userId: 7 });
    // Nothing leaks out of the request.
    expect(currentApiWriter()).toBeUndefined();
  });

  it('passes a session request through without one', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(httpContext({ id: 7 }), handler),
    );
    expect(result).toBeUndefined();
  });
});
