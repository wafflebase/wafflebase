import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { ApiWriterIdentity } from './webhook-event.service';

/**
 * The API key behind the current request, for the `content_updated` loop
 * guard. `/api/v1` has some forty content routes that reach
 * `YorkieService.withDocument`; carrying the key in async context lets that
 * one call site record it, instead of threading a parameter through every
 * controller (and silently missing the next route someone adds).
 */
const storage = new AsyncLocalStorage<ApiWriterIdentity>();

/** The API key the current request authenticated with, if any. */
export function currentApiWriter(): ApiWriterIdentity | undefined {
  return storage.getStore();
}

/** Run `fn` as `writer` (tests, and the interceptor below). */
export function runAsApiWriter<T>(writer: ApiWriterIdentity, fn: () => T): T {
  return storage.run(writer, fn);
}

/**
 * The identity an API-key request carries, read off what `ApiKeyStrategy`
 * puts on `req.user`. Undefined for a JWT session — a person in the editor is
 * not the integration the loop guard exists for.
 */
export function apiWriterOf(user: unknown): ApiWriterIdentity | undefined {
  const u = user as
    | { isApiKey?: boolean; apiKeyId?: unknown; id?: unknown }
    | undefined;
  if (!u?.isApiKey || typeof u.apiKeyId !== 'string') return undefined;
  const userId = Number(u.id);
  if (!Number.isSafeInteger(userId)) return undefined;
  return { apiKeyId: u.apiKeyId, userId };
}

/**
 * Runs an API-key request's handler inside {@link currentApiWriter}'s
 * context. Interceptors run after guards, so `req.user` is already set; a
 * request without an API key passes through untouched.
 */
@Injectable()
export class ApiWriterInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ user?: unknown }>();
    const writer = apiWriterOf(req?.user);
    if (!writer) return next.handle();
    // `next.handle()` must be *called* inside the context: Nest binds the
    // handler's async context when it is, not when the result is subscribed.
    return new Observable((subscriber) =>
      storage.run(writer, () => next.handle().subscribe(subscriber)),
    );
  }
}
