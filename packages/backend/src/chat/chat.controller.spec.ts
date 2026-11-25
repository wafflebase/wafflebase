import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserThrottlerGuard } from '../notification/user-throttler.guard';
import { ChatController } from './chat.controller';

/**
 * Every route that writes a message — post, edit, delete — is bounded per
 * user at the same pace. An edit is not cheaper than a post: it rewrites
 * bell previews and can add a mention (`syncChatMessage`), so an unthrottled
 * edit loop that toggles a mention out and back in would ping a peer as
 * fast as the client can send.
 */
describe('ChatController throttling', () => {
  const proto = ChatController.prototype as unknown as Record<
    string,
    () => unknown
  >;

  it.each(['post', 'edit', 'remove'])(
    '%s is throttled per user at the post pace',
    (handler) => {
      const fn = proto[handler];
      const guards = Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[];
      expect(guards).toContain(UserThrottlerGuard);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', fn)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', fn)).toBe(10_000);
    },
  );
});
