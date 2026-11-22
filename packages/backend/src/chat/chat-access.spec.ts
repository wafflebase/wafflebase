import {
  AccessContext,
  canManage,
  canRemove,
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

      it('canManage: private → any member; public → creator or owner; dm → nobody', () => {
        const as = (isCreator: boolean, isWorkspaceOwner: boolean) =>
          canManage({ ...ctx, isCreator, isWorkspaceOwner });
        // A DM has no name, topic or archive to manage.
        const managed = kind !== 'dm' && read;
        expect(as(true, false)).toBe(managed);
        expect(as(false, true)).toBe(managed);
        expect(as(true, true)).toBe(managed);
        // A private channel is managed by its members collectively: otherwise
        // a last member who is neither creator nor owner could neither leave
        // nor archive it, and nobody outside it can see it to help.
        expect(as(false, false)).toBe(kind === 'private' && read);
      });

      it('canRemove: creator or owner on any channel they can read; never a DM; owners only by owners', () => {
        const as = (
          isCreator: boolean,
          isWorkspaceOwner: boolean,
          targetIsWorkspaceOwner = false,
        ) =>
          canRemove({
            ...ctx,
            isCreator,
            isWorkspaceOwner,
            targetIsWorkspaceOwner,
          });
        const removable = kind !== 'dm' && read;
        expect(as(true, false)).toBe(removable);
        expect(as(false, true)).toBe(removable);
        // Unlike archiving, removing evicts a person, so a plain member of a
        // private channel cannot do it: leaving and archiving stay theirs.
        expect(as(false, false)).toBe(false);
        // A creator who is not an owner cannot evict an owner; an owner can.
        expect(as(true, false, true)).toBe(false);
        expect(as(false, true, true)).toBe(removable);
      });
    },
  );
});
