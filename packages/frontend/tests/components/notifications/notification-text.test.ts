import { describe, expect, it } from "vitest";
import {
  notificationHref,
  notificationSentence,
} from "@/components/notifications/notification-text";
import type { Notification } from "@/api/notifications";

function build(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "comment_mention",
    actor: { id: 7, username: "jinho", photo: null },
    document: { id: "doc-1", title: "Q3 Plan", type: "sheet" },
    workspace: { id: "ws-1", name: "Acme" },
    threadId: "t1",
    commentId: "c1",
    preview: "can you check this",
    readAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    ...over,
  };
}

describe("notificationSentence", () => {
  it("names the actor and the document for a mention", () => {
    expect(notificationSentence(build())).toBe(
      "jinho mentioned you in Q3 Plan",
    );
  });

  it("describes a reply", () => {
    expect(notificationSentence(build({ type: "comment_reply" }))).toBe(
      "jinho replied to your comment in Q3 Plan",
    );
  });

  it("describes a resolve", () => {
    expect(notificationSentence(build({ type: "thread_resolved" }))).toBe(
      "jinho resolved your comment in Q3 Plan",
    );
  });

  it("names the workspace on a join, which has no document to name it by", () => {
    expect(
      notificationSentence(
        build({ type: "workspace_member_joined", document: null }),
      ),
    ).toBe("jinho joined Acme");
  });

  it("falls back to a generic workspace when the relation is missing", () => {
    expect(
      notificationSentence(
        build({
          type: "workspace_member_joined",
          document: null,
          workspace: null,
        }),
      ),
    ).toBe("jinho joined the workspace");
  });

  it("falls back to a generic actor when the acting user was deleted", () => {
    expect(notificationSentence(build({ actor: null }))).toBe(
      "Someone mentioned you in Q3 Plan",
    );
  });

  it("falls back to a generic document name when the title is missing", () => {
    expect(
      notificationSentence(
        build({ document: { id: "doc-1", title: "", type: "sheet" } }),
      ),
    ).toBe("jinho mentioned you in a document");
  });

  it("never renders a raw type for an unknown kind", () => {
    expect(
      notificationSentence(build({ type: "something_new" as never })),
    ).toBe("jinho sent you a notification");
  });
});

describe("notificationHref", () => {
  it("routes to the document editor for its type", () => {
    expect(notificationHref(build())).toBe("/s/doc-1");
    expect(
      notificationHref(
        build({ document: { id: "d2", title: "Doc", type: "doc" } }),
      ),
    ).toBe("/d/d2");
    expect(
      notificationHref(
        build({ document: { id: "d3", title: "Deck", type: "slides" } }),
      ),
    ).toBe("/p/d3");
  });

  it("opens the member list for a workspace join, which has no document", () => {
    expect(
      notificationHref(
        build({ type: "workspace_member_joined", document: null }),
      ),
    ).toBe("/w/ws-1/settings");
  });

  it("has nowhere to go for a join whose workspace is gone", () => {
    expect(
      notificationHref(
        build({
          type: "workspace_member_joined",
          document: null,
          workspace: null,
        }),
      ),
    ).toBeNull();
  });

  // A reviewer is on a global allowlist, not in the publishing workspace, so
  // the document this row carries is one they cannot open.
  it("opens the review queue for a queued template, not its document", () => {
    expect(notificationHref(build({ type: "template_review_queued" }))).toBe(
      "/admin/templates",
    );
  });

  it("still opens the document for a publisher-facing template decision", () => {
    expect(notificationHref(build({ type: "template_approved" }))).toBe(
      "/s/doc-1",
    );
  });

  it("has nowhere to go when a document notification lost its document", () => {
    expect(notificationHref(build({ document: null }))).toBeNull();
  });

  // The default arm is the contract for a backend that learns a type ahead of
  // this client: open what it is about rather than nothing.
  it("opens the document for a type this client does not know", () => {
    expect(notificationHref(build({ type: "something_new" as never }))).toBe(
      "/s/doc-1",
    );
  });
});

// Chat rows carry no document: the channel id rides in `threadId` and the
// message id in `commentId`.
describe("chat notifications", () => {
  const chat = (type: Notification["type"], over: Partial<Notification> = {}) =>
    build({
      type,
      document: null,
      threadId: "ch-1",
      commentId: "m-1",
      ...over,
    });

  it("describes a chat mention", () => {
    expect(notificationSentence(chat("chat_mention"))).toBe(
      "jinho mentioned you in chat",
    );
  });

  it("describes a thread reply", () => {
    expect(notificationSentence(chat("chat_thread_reply"))).toBe(
      "jinho replied to a thread you're in",
    );
  });

  it("opens the channel with the message focused", () => {
    expect(notificationHref(chat("chat_mention"))).toBe(
      "/w/ws-1/chat/ch-1?message=m-1",
    );
    expect(notificationHref(chat("chat_thread_reply"))).toBe(
      "/w/ws-1/chat/ch-1?message=m-1",
    );
  });

  it("has nowhere to go when the workspace is gone", () => {
    expect(
      notificationHref(chat("chat_mention", { workspace: null })),
    ).toBeNull();
    expect(
      notificationHref(chat("chat_thread_reply", { workspace: null })),
    ).toBeNull();
  });

  it("has nowhere to go without a channel", () => {
    expect(
      notificationHref(chat("chat_mention", { threadId: null })),
    ).toBeNull();
  });

  it("opens the channel alone when the message id is missing", () => {
    expect(notificationHref(chat("chat_mention", { commentId: null }))).toBe(
      "/w/ws-1/chat/ch-1",
    );
  });
});

describe("webhook notifications", () => {
  const hook = (
    type: "webhook_failing" | "webhook_disabled",
    over: Partial<Notification> = {},
  ) =>
    build({
      type,
      actor: null,
      document: null,
      threadId: "wh-1",
      commentId: null,
      preview: "Zapier: failing",
      ...over,
    });

  it("says a webhook is about to be turned off, naming the workspace", () => {
    expect(notificationSentence(hook("webhook_failing"))).toBe(
      "A webhook in Acme has been failing and will be turned off soon",
    );
  });

  it("says a webhook was turned off", () => {
    expect(notificationSentence(hook("webhook_disabled"))).toBe(
      "A webhook in Acme was turned off",
    );
  });

  it("opens the webhook's detail page from the id in threadId", () => {
    expect(notificationHref(hook("webhook_failing"))).toBe(
      "/w/ws-1/settings/webhooks/wh-1",
    );
    expect(notificationHref(hook("webhook_disabled"))).toBe(
      "/w/ws-1/settings/webhooks/wh-1",
    );
  });

  it("falls back to the settings section without a webhook id", () => {
    expect(notificationHref(hook("webhook_disabled", { threadId: null }))).toBe(
      "/w/ws-1/settings#webhooks",
    );
  });

  it("has nowhere to go when the workspace is gone", () => {
    expect(
      notificationHref(hook("webhook_disabled", { workspace: null })),
    ).toBeNull();
  });
});
