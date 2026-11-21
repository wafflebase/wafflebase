import {
  AccessContext,
  canManage,
  canPost,
  canRead,
  mentionOutcome,
} from './chat-access';
import { ChannelKind } from './chat.types';

type Row = [
  kind: ChannelKind,
  archived: boolean,
  isWorkspaceMember: boolean,
  isChannelMember: boolean,
  read: boolean,
  post: boolean,
  mention: 'notify' | 'notify-preview' | 'none',
];

/**
 * kind × archived × workspace member × channel member. A channel member who
 * is no longer a workspace member is a real state for the instant between a
 * removal and its cleanup, so it is covered rather than assumed away.
 */
const rows: Row[] = [
  ['public', false, true, true, true, true, 'notify'],
  ['public', false, true, false, true, true, 'notify-preview'],
  ['public', false, false, true, false, false, 'none'],
  ['public', false, false, false, false, false, 'none'],
  ['public', true, true, true, true, false, 'notify'],
  ['public', true, true, false, true, false, 'notify-preview'],
  ['private', false, true, true, true, true, 'notify'],
  ['private', false, true, false, false, false, 'none'],
  ['private', false, false, true, false, false, 'none'],
  ['private', true, true, true, true, false, 'notify'],
  ['private', true, true, false, false, false, 'none'],
  ['dm', false, true, true, true, true, 'notify'],
  ['dm', false, true, false, false, false, 'none'],
  ['dm', false, false, true, false, false, 'none'],
  ['dm', true, true, true, true, false, 'notify'],
];

describe('chat access policy', () => {
  describe.each(rows)(
    '%s archived=%s workspaceMember=%s channelMember=%s',
    (
      kind,
      archived,
      isWorkspaceMember,
      isChannelMember,
      read,
      post,
      mention,
    ) => {
      const ctx: AccessContext = {
        kind,
        archived,
        isWorkspaceMember,
        isChannelMember,
      };

      it(`canRead → ${read}`, () => {
        expect(canRead(ctx)).toBe(read);
      });

      it(`canPost → ${post}`, () => {
        expect(canPost(ctx)).toBe(post);
      });

      it(`mentionOutcome → ${mention}`, () => {
        expect(mentionOutcome(ctx)).toBe(mention);
      });

      it('canManage needs canRead plus creator or owner', () => {
        const as = (isCreator: boolean, isWorkspaceOwner: boolean) =>
          canManage({ ...ctx, isCreator, isWorkspaceOwner });
        expect(as(true, false)).toBe(read);
        expect(as(false, true)).toBe(read);
        expect(as(true, true)).toBe(read);
        expect(as(false, false)).toBe(false);
      });
    },
  );
});
