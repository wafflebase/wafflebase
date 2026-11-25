import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
  type Block,
  type DocRange,
} from "@wafflebase/docs";

import {
  docsSendToChatAnchor,
  type DocsSendSource,
} from "@/app/docs/docs-chat-anchor";

function block(id: string, text: string): Block {
  return {
    id,
    type: "paragraph",
    style: { ...DEFAULT_BLOCK_STYLE },
    inlines: [{ text, style: { ...DEFAULT_INLINE_STYLE } }],
  } as Block;
}

const blocks = [block("b1", "First paragraph"), block("b2", "Second one")];

/** An editor double over `blocks`, with `sel` selected and `hit` under the pointer. */
function editor(
  sel: DocRange | null,
  hit: { blockId: string; offset: number } | null = null,
): DocsSendSource & { positionAtClientPoint: ReturnType<typeof vi.fn> } {
  return {
    getActiveSelection: () => sel,
    getDoc: () =>
      ({
        document: { blocks },
        findBlock: (id: string) => blocks.find((b) => b.id === id),
      }) as unknown as ReturnType<DocsSendSource["getDoc"]>,
    positionAtClientPoint: vi.fn(() => hit),
  } as unknown as DocsSendSource & {
    positionAtClientPoint: ReturnType<typeof vi.fn>;
  };
}

describe("docsSendToChatAnchor", () => {
  it("anchors a selection at its first block, with what was selected", () => {
    const e = editor({
      anchor: { blockId: "b2", offset: 7 },
      focus: { blockId: "b1", offset: 6 },
    });
    expect(docsSendToChatAnchor(e, { x: 1, y: 2 })).toEqual({
      blockId: "b1",
      excerpt: "paragraph Second",
      label: "paragraph Second",
    });
    // With a selection, the pointer is not consulted.
    expect(e.positionAtClientPoint).not.toHaveBeenCalled();
  });

  it("anchors a caret at the block under the pointer, with its whole text", () => {
    const e = editor(null, { blockId: "b2", offset: 3 });
    expect(docsSendToChatAnchor(e, { x: 10, y: 20 })).toEqual({
      blockId: "b2",
      excerpt: "Second one",
      label: "Second one",
    });
    expect(e.positionAtClientPoint).toHaveBeenCalledWith(10, 20);
  });

  it("sends document-level when the pointer is on no block", () => {
    expect(docsSendToChatAnchor(editor(null, null), { x: 0, y: 0 })).toBeNull();
    expect(
      docsSendToChatAnchor(editor(null, { blockId: "gone", offset: 0 }), { x: 0, y: 0 }),
    ).toBeNull();
  });
});
