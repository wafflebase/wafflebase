import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SentryServerErrorFilter } from './sentry-exception.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

// The parent's `catch` writes the HTTP response, which is not what is under
// test here and needs a real host to do. Stub it out so the assertions are
// about the capture decision alone.
const superCatch = jest
  .spyOn(
    Object.getPrototypeOf(SentryServerErrorFilter.prototype) as {
      catch: (e: unknown, h: ArgumentsHost) => void;
    },
    'catch',
  )
  .mockImplementation(() => {});

const host = {} as ArgumentsHost;

describe('SentryServerErrorFilter', () => {
  let filter: SentryServerErrorFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new SentryServerErrorFilter();
  });

  /**
   * The whole reason this subclass exists. `@sentry/nestjs`'s own
   * `isExpectedError()` does not read the status code — it returns true for
   * any `HttpException` — so the stock filter drops these, and an unreachable
   * Miro API or a downed database would never appear in Sentry.
   */
  it.each([
    ['InternalServerErrorException', new InternalServerErrorException('miro unreachable')],
    ['ServiceUnavailableException', new ServiceUnavailableException('database unreachable')],
    ['a bare 5xx HttpException', new HttpException('gateway timeout', 504)],
  ])('reports %s', (_label, exception) => {
    filter.catch(exception, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(exception);
  });

  /**
   * The half the stock behavior gets right: a refusal is a decision, not a
   * failure, and reporting them would bury the real crashes.
   */
  it.each([
    ['NotFoundException', new NotFoundException()],
    ['ForbiddenException', new ForbiddenException()],
    ['BadRequestException', new BadRequestException()],
  ])('does not report %s', (_label, exception) => {
    filter.catch(exception, host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('leaves non-HttpException reporting to the parent, without double-reporting', () => {
    const boom = new TypeError('genuinely unhandled');
    filter.catch(boom, host);
    // The parent captures this one; capturing here too would duplicate it.
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(superCatch).toHaveBeenCalledWith(boom, host);
  });

  it('still delegates the HTTP response to the parent for a 5xx', () => {
    const exception = new ServiceUnavailableException();
    filter.catch(exception, host);
    expect(superCatch).toHaveBeenCalledWith(exception, host);
  });
});
