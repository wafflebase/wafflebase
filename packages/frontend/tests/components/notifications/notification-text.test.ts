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

  it("describes a workspace join, which has no document", () => {
    expect(
      notificationSentence(
        build({ type: "workspace_member_joined", document: null }),
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

  it("has nowhere to go when there is no document", () => {
    expect(
      notificationHref(
        build({ type: "workspace_member_joined", document: null }),
      ),
    ).toBeNull();
  });
});
