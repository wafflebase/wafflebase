import { describe, expect, it } from "vitest";
import {
  applyRead,
  nextUnreadCount,
} from "@/components/notifications/read-state";
import type { Notification } from "@/api/notifications";

const READ_AT = "2026-08-10T12:00:00.000Z";

function n(id: string, readAt: string | null = null): Notification {
  return {
    id,
    type: "comment_mention",
    actor: null,
    document: null,
    threadId: null,
    commentId: null,
    preview: null,
    readAt,
    createdAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("applyRead", () => {
  it("stamps every unread row when no ids are given", () => {
    const out = applyRead([n("a"), n("b")], undefined, READ_AT);
    expect(out.map((x) => x.readAt)).toEqual([READ_AT, READ_AT]);
  });

  it("stamps only the named rows", () => {
    const out = applyRead([n("a"), n("b")], ["b"], READ_AT);
    expect(out.map((x) => x.readAt)).toEqual([null, READ_AT]);
  });

  it("leaves an already-read row untouched", () => {
    const earlier = "2026-08-09T00:00:00.000Z";
    const out = applyRead([n("a", earlier)], undefined, READ_AT);
    expect(out[0].readAt).toBe(earlier);
  });
});

describe("nextUnreadCount", () => {
  it("drops to zero when everything is marked", () => {
    expect(nextUnreadCount(25, [n("a")], undefined)).toBe(0);
  });

  it("decrements rather than recounting a page that holds only 20 of 25", () => {
    // The dropdown holds one page; recounting it would report 19 unread for a
    // user who actually has 24 left.
    const page = Array.from({ length: 20 }, (_, i) => n(`n${i}`));
    expect(nextUnreadCount(25, page, ["n0"])).toBe(24);
  });

  it("ignores ids that are already read", () => {
    expect(nextUnreadCount(3, [n("a", READ_AT)], ["a"])).toBe(3);
  });

  it("ignores ids that are not on the current page", () => {
    expect(nextUnreadCount(3, [n("a")], ["not-here"])).toBe(3);
  });

  it("never goes negative", () => {
    expect(nextUnreadCount(0, [n("a")], ["a"])).toBe(0);
  });

  it("treats an unknown previous count as zero", () => {
    expect(nextUnreadCount(undefined, [n("a")], ["a"])).toBe(0);
  });
});
