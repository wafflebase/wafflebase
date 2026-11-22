import { describe, expect, it } from "vitest";

import { WEBHOOK_EVENT_TYPES } from "@/api/webhooks";
import {
  DEFAULT_PRESET,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_PRESETS,
  describeEvents,
  eventsFromSelection,
  presetFor,
  selectionFromEvents,
} from "../webhook-events";

const preset = (id: string) => WEBHOOK_PRESETS.find((p) => p.id === id)!;

describe("webhook presets", () => {
  it("map to the design's use cases", () => {
    expect(preset("channel").events).toEqual([
      "document.created",
      "document.moved",
      "document.trashed",
    ]);
    expect([...preset("backup").events].sort()).toEqual(
      [
        "document.content_updated",
        "document.deleted",
        "document.renamed",
        "document.restored",
        "document.trashed",
      ].sort(),
    );
    expect(preset("members").events).toEqual([
      "member.joined",
      "member.removed",
    ]);
    expect(preset("everything").events).toEqual(WEBHOOK_EVENT_TYPES);
  });

  it("default to Everything", () => {
    expect(DEFAULT_PRESET).toBe("everything");
  });

  it("are recognised from the checked set, and a custom mix is none", () => {
    expect(presetFor(new Set(preset("members").events))).toBe("members");
    expect(presetFor(new Set(WEBHOOK_EVENT_TYPES))).toBe("everything");
    expect(presetFor(new Set(["member.joined"]))).toBeNull();
  });

  it("only use event types the grouped list offers", () => {
    const listed = new Set(
      WEBHOOK_EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.type)),
    );
    expect(listed).toEqual(new Set(WEBHOOK_EVENT_TYPES));
    for (const p of WEBHOOK_PRESETS) {
      for (const e of p.events) expect(listed.has(e)).toBe(true);
    }
  });

  it("carry content_updated's latency in its label", () => {
    const content = WEBHOOK_EVENT_GROUPS.flatMap((g) => g.events).find(
      (e) => e.type === "document.content_updated",
    );
    expect(content?.hint).toMatch(/about a minute after editing pauses/);
    expect(content?.hint).toMatch(/at most 5 minutes/);
  });
});

describe("events filter", () => {
  it("sends every box checked as the empty list, so new types arrive too", () => {
    expect(eventsFromSelection(new Set(WEBHOOK_EVENT_TYPES))).toEqual([]);
  });

  it("sends a partial selection in catalog order", () => {
    expect(
      eventsFromSelection(new Set(["member.removed", "document.created"])),
    ).toEqual(["document.created", "member.removed"]);
  });

  it("reads the empty list back as every event", () => {
    expect(selectionFromEvents([])).toEqual(new Set(WEBHOOK_EVENT_TYPES));
    expect(selectionFromEvents(["member.joined"])).toEqual(
      new Set(["member.joined"]),
    );
  });

  it("describes a stored filter for a list row", () => {
    expect(describeEvents([])).toBe("All events");
    expect(describeEvents(["member.joined", "member.removed"])).toBe(
      "Sync members",
    );
    expect(describeEvents(["member.joined"])).toBe("1 event");
    expect(describeEvents(["member.joined", "folder.created"])).toBe(
      "2 events",
    );
  });
});
