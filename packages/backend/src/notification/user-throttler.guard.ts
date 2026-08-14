import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * A throttler keyed on the authenticated caller rather than their address.
 *
 * `ThrottlerGuard`'s default tracker uses `req.ip`, which is the wrong unit
 * for `POST /notifications/comment`: it is the one endpoint a client calls on
 * its own initiative, so the limit needs to bound *a user*. IP keying both
 * makes colleagues behind one NAT share a bucket and leaves an attacker with
 * several source addresses effectively uncapped.
 *
 * Falls back to the address when there is no authenticated user, so an
 * unauthenticated request is still bounded (it is rejected by the JWT guard
 * anyway).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: unknown } | undefined;
    const id = user?.id;
    if (typeof id === 'number' || (typeof id === 'string' && id !== '')) {
      return Promise.resolve(`user:${id}`);
    }
    return Promise.resolve(typeof req.ip === 'string' ? req.ip : 'unknown');
  }
}
