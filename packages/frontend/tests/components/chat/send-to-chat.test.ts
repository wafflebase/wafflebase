import { describe, expect, it } from "vitest";

import { decodeAnchor, encodeAnchor } from "@/components/chat/document-link";
import {
  clip,
  docChatAnchor,
  slidesChatAnchor,
} from "@/components/chat/send-to-chat";

describe("clip", () => {
  it("collapses whitespace and keeps short text whole", () => {
    expect(clip("  a\n\tb  ", 10)).toBe("a b");
  });

  it("cuts to the limit, ellipsis included", () => {
    const out = clip("x".repeat(300), 80);
    expect(out).toHaveLength(80);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("docChatAnchor", () => {
  it("carries the first block, the excerpt, and a shorter label", () => {
    const text = "word ".repeat(100);
    const anchor = docChatAnchor("b1", text);
    expect(anchor.blockId).toBe("b1");
    expect(anchor.excerpt!.length).toBeLessThanOrEqual(200);
    expect(anchor.label!.length).toBeLessThanOrEqual(80);
    // Survives the round trip a card link makes.
    expect(decodeAnchor(encodeAnchor(anchor), "doc")).toEqual(anchor);
  });

  it("is block-only without text", () => {
    expect(docChatAnchor("b1", " \n ")).toEqual({ blockId: "b1" });
  });
});

describe("slidesChatAnchor", () => {
  it("labels the slide by its 1-based position", () => {
    const anchor = slidesChatAnchor("s9", 3);
    expect(anchor).toEqual({ slideId: "s9", label: "Slide 4" });
    expect(decodeAnchor(encodeAnchor(anchor), "slides")).toEqual(anchor);
  });
});
