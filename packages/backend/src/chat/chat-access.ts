import { ChannelKind } from './chat.types';

/**
 * Who may do what in a chat channel, as pure functions over facts the caller
 * has already loaded. Keeping the policy free of Prisma lets every rule be
 * table-tested, and keeps the services from growing their own variants of it.
 * See `docs/design/chat.md` § Authorization.
 */
export interface AccessContext {
  kind: ChannelKind;
  archived: boolean;
  isWorkspaceMember: boolean;
  isChannelMember: boolean;
}

/**
 * Workspace membership first, always: a channel membership row that outlives
 * the workspace membership grants nothing. Public channels are then readable
 * by every member; private channels and DMs only by their own members.
 */
export function canRead(ctx: AccessContext): boolean {
  if (!ctx.isWorkspaceMember) return false;
  return ctx.kind === 'public' || ctx.isChannelMember;
}

/** Reading stays open on an archived channel; posting does not. */
export function canPost(ctx: AccessContext): boolean {
  return canRead(ctx) && !ctx.archived;
}

/**
 * Rename, set the topic, archive. A public channel: its creator or a
 * workspace owner. A private channel: any of its members. Nobody outside a
 * private channel can see it, so if only its creator or an owner could
 * archive it, a last member who is neither could neither leave (the last
 * member is refused) nor archive it — a dead end nobody could clear.
 */
export function canManage(
  ctx: AccessContext & { isCreator: boolean; isWorkspaceOwner: boolean },
): boolean {
  if (!canRead(ctx)) return false;
  if (ctx.kind === 'private') return true;
  return ctx.isCreator || ctx.isWorkspaceOwner;
}

/**
 * What a mention does for the mentioned user. A channel member is notified;
 * a workspace member outside a public channel is notified too, with the
 * preview being their way in (they can read it and join). Anyone who cannot
 * read the channel gets nothing — a notification must not leak a private
 * channel or a DM to somebody outside it.
 */
export function mentionOutcome(
  ctx: AccessContext,
): 'notify' | 'notify-preview' | 'none' {
  if (!canRead(ctx)) return 'none';
  return ctx.isChannelMember ? 'notify' : 'notify-preview';
}
