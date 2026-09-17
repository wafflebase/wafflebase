import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

/**
 * `SentryGlobalFilter`, except that server errors are actually reported.
 *
 * The stock filter asks `isExpectedError()` whether to capture, and that
 * helper does **not look at the status code**: it returns true for anything
 * carrying `getStatus`/`getResponse`/`initMessage`, which is every
 * `HttpException` (`@sentry/nestjs/build/cjs/helpers.js`). So a
 * `ServiceUnavailableException` or `InternalServerErrorException` is
 * classified exactly like a 404 and never reaches Sentry.
 *
 * That is the wrong half to drop here. This backend throws 5xx
 * `HttpException`s for real, external failures — an unreachable or
 * rate-limiting Miro API (`miro.service.ts`), DuckDB unavailable
 * (`lakehouse.service.ts`), Yorkie unreachable (`template.service.ts`,
 * `yorkie-signature.guard.ts`), the database down (`health.controller.ts`).
 * Those are precisely the crashes error tracking exists to surface, and the
 * stock filter would have hidden every one of them while still faithfully
 * reporting, say, an unhandled `TypeError`.
 *
 * 4xx stays unreported, which is the part the stock behavior gets right: the
 * 404s and 403s this codebase throws for ordinary refusals are decisions, not
 * failures, and reporting them would bury the real crashes.
 *
 * Capturing here rather than after `super.catch()` is deliberate — the parent
 * still decides the HTTP response, and it will not double-report, because its
 * own `isExpectedError()` check skips every `HttpException` including this
 * one.
 */
@Catch()
export class SentryServerErrorFilter extends SentryGlobalFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException && exception.getStatus() >= 500) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
