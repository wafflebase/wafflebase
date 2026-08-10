import { describe, expect, it } from "vitest";
import { parseSummaryEvent } from "@/components/notifications/notification-stream";

describe("parseSummaryEvent", () => {
  it("reads a well-formed summary", () => {
    expect(parseSummaryEvent('{"unreadCount":3,"latestId":"n1"}')).toEqual({
      unreadCount: 3,
      latestId: "n1",
    });
  });

  it("accepts a null latestId, which an empty inbox sends", () => {
    expect(parseSummaryEvent('{"unreadCount":0,"latestId":null}')).toEqual({
      unreadCount: 0,
      latestId: null,
    });
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseSummaryEvent("not json")).toBeNull();
  });

  it("returns null when the count is missing", () => {
    expect(parseSummaryEvent('{"latestId":"n1"}')).toBeNull();
  });

  it("returns null when the count is not a number", () => {
    expect(parseSummaryEvent('{"unreadCount":"3","latestId":"n1"}')).toBeNull();
  });

  it("returns null for a JSON payload that is not an object", () => {
    expect(parseSummaryEvent("42")).toBeNull();
    expect(parseSummaryEvent("null")).toBeNull();
  });

  it("rejects a negative count, which would render a nonsense badge", () => {
    expect(parseSummaryEvent('{"unreadCount":-1,"latestId":null}')).toBeNull();
  });
});
