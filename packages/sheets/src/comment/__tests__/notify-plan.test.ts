import { describe, it, expect } from 'vitest';
import { planCommentNotifications, commentPreview } from '../notify-plan';
import type { Comment } from '../types';

function comment(id: string, userId: string, body = 'hi'): Comment {
  return {
    id,
    author: { userId, username: `u${userId}` },
    body,
    createdAt: 1,
  };
}

const thread = (comments: Comment[]) => ({ id: 't1', comments });

describe('planCommentNotifications', () => {
  it('notifies mentioned users on a new thread, never the actor', () => {
    const c = comment('c1', '7', 'hey @[bob](9) and @[me](7)');
    const plans = planCommentNotifications({
      event: 'thread',
      documentId: 'd1',
      actorUserId: '7',
      thread: thread([c]),
      comment: c,
    });
    expect(plans).toEqual([
      {
        type: 'comment_mention',
        documentId: 'd1',
        threadId: 't1',
        commentId: 'c1',
        recipientUserIds: [9],
        preview: 'hey @bob and @me',
      },
    ]);
  });

  it('notifies a reply’s earlier participants, minus anyone it mentions', () => {
    const earlier = [comment('c1', '9'), comment('c2', '11')];
    const reply = comment('c3', '7', 'thanks @[u9](9)');
    const plans = planCommentNotifications({
      event: 'reply',
      documentId: 'd1',
      actorUserId: '7',
      thread: thread([...earlier, reply]),
      comment: reply,
    });
    // 9 is mentioned, so it is notified once (as a mention) and dropped from
    // the reply's recipients; 11 only participated, so it gets the reply.
    expect(plans.map((p) => [p.type, p.recipientUserIds])).toEqual([
      ['comment_mention', [9]],
      ['comment_reply', [11]],
    ]);
  });

  it('notifies the participants on a resolve, with the opening excerpt', () => {
    const plans = planCommentNotifications({
      event: 'resolve',
      documentId: 'd1',
      actorUserId: '7',
      thread: thread([comment('c1', '9', 'ping @[bob](11)'), comment('c2', '7')]),
    });
    expect(plans).toEqual([
      {
        type: 'thread_resolved',
        documentId: 'd1',
        threadId: 't1',
        recipientUserIds: [9],
        preview: 'ping @bob',
      },
    ]);
  });

  it('plans nothing for an actor that is not a real user id', () => {
    // An anonymous share-link author: the backend could never authorize their
    // report, so firing one would be a guaranteed rejection.
    const c = comment('c1', 'anon-3', 'hi @[bob](9)');
    expect(
      planCommentNotifications({
        event: 'thread',
        documentId: 'd1',
        actorUserId: 'anon-3',
        thread: thread([c]),
        comment: c,
      }),
    ).toEqual([]);
  });
});

describe('commentPreview', () => {
  it('flattens mention markup and truncates at the backend’s cap', () => {
    expect(commentPreview('see @[grace](9)')).toBe('see @grace');
    expect(commentPreview('x'.repeat(500))).toHaveLength(200);
  });
});
