import { describe, expect, it } from "vitest";
import { planCommentNotifications } from "@/components/comments/notify";
import type { Comment, Thread } from "@/types/comments";

const DOC = "doc-1";

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    author: { userId: "1", username: "author" },
    body: "hello",
    createdAt: 1,
    ...over,
  };
}

function thread(comments: Comment[]): Thread {
  return {
    id: "t1",
    anchor: { kind: "sheet-cell", tabId: "s1", rowId: "r1", colId: "c1" },
    comments,
    resolved: false,
    createdAt: 1,
  };
}

describe("planCommentNotifications", () => {
  it("notifies each mentioned user when a thread is opened", () => {
    const c = comment({ body: "hi @[bo](2) and @[cho](3)" });

    const plans = planCommentNotifications({
      event: "thread",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([c]),
      comment: c,
    });

    expect(plans).toEqual([
      {
        type: "comment_mention",
        documentId: DOC,
        threadId: "t1",
        commentId: "c1",
        recipientUserIds: [2, 3],
        preview: "hi @bo and @cho",
      },
    ]);
  });

  it("plans nothing for a new thread that mentions nobody", () => {
    const c = comment({ body: "just a note" });

    expect(
      planCommentNotifications({
        event: "thread",
        documentId: DOC,
        actorUserId: "1",
        thread: thread([c]),
        comment: c,
      }),
    ).toEqual([]);
  });

  it("notifies earlier participants of a reply", () => {
    const first = comment({ id: "c1", author: { userId: "2", username: "bo" } });
    const reply = comment({
      id: "c2",
      author: { userId: "1", username: "me" },
      body: "on it",
    });

    const plans = planCommentNotifications({
      event: "reply",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([first, reply]),
      comment: reply,
    });

    expect(plans).toEqual([
      {
        type: "comment_reply",
        documentId: DOC,
        threadId: "t1",
        commentId: "c2",
        recipientUserIds: [2],
        preview: "on it",
      },
    ]);
  });

  it("does not notify a mentioned user twice for one reply", () => {
    const first = comment({ id: "c1", author: { userId: "2", username: "bo" } });
    const reply = comment({
      id: "c2",
      author: { userId: "1", username: "me" },
      body: "@[bo](2) done",
    });

    const plans = planCommentNotifications({
      event: "reply",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([first, reply]),
      comment: reply,
    });

    expect(plans).toEqual([
      {
        type: "comment_mention",
        documentId: DOC,
        threadId: "t1",
        commentId: "c2",
        recipientUserIds: [2],
        preview: "@bo done",
      },
    ]);
  });

  it("never notifies the acting user about their own comment", () => {
    const first = comment({ id: "c1", author: { userId: "1", username: "me" } });
    const reply = comment({
      id: "c2",
      author: { userId: "1", username: "me" },
      body: "@[me](1) note to self",
    });

    expect(
      planCommentNotifications({
        event: "reply",
        documentId: DOC,
        actorUserId: "1",
        thread: thread([first, reply]),
        comment: reply,
      }),
    ).toEqual([]);
  });

  it("plans nothing when the acting user is anonymous", () => {
    // A share-link visitor has no User row, so nothing they do can be
    // authorized — reporting it would only earn a 401.
    const c = comment({
      author: { userId: "anonymous", username: "guest" },
      body: "hi @[bo](2)",
    });

    expect(
      planCommentNotifications({
        event: "thread",
        documentId: DOC,
        actorUserId: "anonymous",
        thread: thread([c]),
        comment: c,
      }),
    ).toEqual([]);
  });

  it("notifies every participant when a thread is resolved", () => {
    const first = comment({ id: "c1", author: { userId: "2", username: "bo" } });
    const second = comment({
      id: "c2",
      author: { userId: "3", username: "cho" },
      body: "agreed",
    });

    const plans = planCommentNotifications({
      event: "resolve",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([first, second]),
    });

    expect(plans).toEqual([
      {
        type: "thread_resolved",
        documentId: DOC,
        threadId: "t1",
        recipientUserIds: [2, 3],
        preview: "hello",
      },
    ]);
  });

  it("carries no comment id on a resolve, which has no comment of its own", () => {
    const first = comment({ author: { userId: "2", username: "bo" } });

    const [plan] = planCommentNotifications({
      event: "resolve",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([first]),
    });

    expect(plan.commentId).toBeUndefined();
  });

  it("ignores authors whose id is not a numeric user id", () => {
    const first = comment({
      author: { userId: "anonymous", username: "guest" },
    });
    const reply = comment({
      id: "c2",
      author: { userId: "1", username: "me" },
    });

    expect(
      planCommentNotifications({
        event: "reply",
        documentId: DOC,
        actorUserId: "1",
        thread: thread([first, reply]),
        comment: reply,
      }),
    ).toEqual([]);
  });

  it("truncates a long preview so the request cannot carry a whole essay", () => {
    const c = comment({ body: `@[bo](2) ${"x".repeat(500)}` });

    const [plan] = planCommentNotifications({
      event: "thread",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([c]),
      comment: c,
    });

    expect(plan.preview).toHaveLength(200);
  });

  it("deduplicates a participant who commented more than once", () => {
    const first = comment({ id: "c1", author: { userId: "2", username: "bo" } });
    const second = comment({
      id: "c2",
      author: { userId: "2", username: "bo" },
    });
    const reply = comment({
      id: "c3",
      author: { userId: "1", username: "me" },
    });

    const [plan] = planCommentNotifications({
      event: "reply",
      documentId: DOC,
      actorUserId: "1",
      thread: thread([first, second, reply]),
      comment: reply,
    });

    expect(plan.recipientUserIds).toEqual([2]);
  });
});
