import { describe, expect, it } from "vitest";
import { chatLayout } from "@/app/chat/chat-layout";

describe("chatLayout", () => {
  describe("desktop", () => {
    it("shows the list and an empty conversation slot with no channel", () => {
      expect(
        chatLayout({ isMobile: false, channelId: null, threadId: null }).show,
      ).toEqual(["list", "conversation"]);
    });

    it("shows the list and the conversation for a channel", () => {
      expect(
        chatLayout({ isMobile: false, channelId: "c1", threadId: null }).show,
      ).toEqual(["list", "conversation"]);
    });

    it("adds the thread column for a thread", () => {
      expect(
        chatLayout({ isMobile: false, channelId: "c1", threadId: "t1" }).show,
      ).toEqual(["list", "conversation", "thread"]);
    });

    it("ignores a thread without a channel", () => {
      expect(
        chatLayout({ isMobile: false, channelId: null, threadId: "t1" }).show,
      ).toEqual(["list", "conversation"]);
    });
  });

  describe("mobile", () => {
    it("shows only the list with no channel", () => {
      expect(
        chatLayout({ isMobile: true, channelId: null, threadId: null }).show,
      ).toEqual(["list"]);
    });

    it("shows only the conversation for a channel", () => {
      expect(
        chatLayout({ isMobile: true, channelId: "c1", threadId: null }).show,
      ).toEqual(["conversation"]);
    });

    it("shows only the thread when one is open — deepest wins", () => {
      expect(
        chatLayout({ isMobile: true, channelId: "c1", threadId: "t1" }).show,
      ).toEqual(["thread"]);
    });

    it("falls back to the list for a thread without a channel", () => {
      expect(
        chatLayout({ isMobile: true, channelId: null, threadId: "t1" }).show,
      ).toEqual(["list"]);
    });
  });
});
