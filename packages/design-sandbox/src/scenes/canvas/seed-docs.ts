/**
 * seed-docs.ts — CP4.3's fixture content for the `docs-editor` canvas scene.
 *
 * `initialDocsRoot()` (called by `docs-detail.tsx` itself, unmodified)
 * already constructs a valid non-empty Tree — one paragraph block with an
 * empty inline child — because the docs engine's own undo-safety
 * requirements need SOME block to exist from the first commit (see that
 * function's own comment on `yorkie-js-sdk` PR #1238). That default has no
 * TEXT in it, though, so this replaces `root.content` outright with a
 * richer tree: several real paragraphs, so a design review actually
 * exercises text rendering, not just an empty caret.
 *
 * The block/inline/text three-level shape below is not invented here — it
 * is copied from `yorkie-doc-store.ts`'s own tree-building code
 * (`{type:'inline', attributes: serializeInlineStyle(...), children:
 * [{type:'text', value}]}`), which is the shape the docs renderer actually
 * expects. `initialDocsRoot()`'s own literal is the same shape one level
 * shallower (an empty inline, no text child).
 *
 * Exported as a plain function and imported DIRECTLY by `yorkie-offline.tsx`
 * — see that file's `CANVAS_SEEDS` comment for why the dependency runs that
 * direction and not the other way.
 *
 * `Tree` MUST come from `@yorkie-js/sdk` — the same realm as the `Document`
 * `yorkie-offline.tsx` constructs. See that file's ONE-REALM INVARIANT note
 * for the full reasoning; the short version is that `@yorkie-js/react`'s dist
 * bundles its own SDK copy, so its `Tree` is a different class, and the SDK's
 * `buildCRDTElement` silently degrades an unrecognized value to a plain
 * `CRDTObject` instead of throwing. `docs-view.tsx#ensureTree` then sees a
 * `root.content` with no `getRootTreeNode` and REPLACES it with an empty
 * document — so getting this import wrong wipes the fixture rather than
 * erroring. (An earlier draft imported through `__wb-real` to avoid a
 * theoretical circular import; that reasoning was sound but the realm cost
 * was not, and the circularity it avoided was never actually a problem —
 * `Tree` is only touched inside a function body.)
 */
import { Tree } from "@yorkie-js/sdk";
import type { Document, ElementNode } from "@yorkie-js/sdk";

/** Mirrors `initialDocsRoot()`'s own per-block attribute defaults. */
function blockAttrs(id: string) {
  return {
    id,
    type: "paragraph",
    alignment: "left",
    lineHeight: "1.5",
    marginTop: "0",
    marginBottom: "8",
    textIndent: "0",
    marginLeft: "0",
  };
}

function paragraph(id: string, text: string): ElementNode {
  return {
    type: "block",
    attributes: blockAttrs(id),
    children: [
      {
        type: "inline",
        attributes: {},
        children: text ? [{ type: "text", value: text }] : [],
      },
    ],
  } as unknown as ElementNode;
}

const PARAGRAPHS = [
  "Design review notes — spring platform refresh, week 12",
  "The new sidebar collapses correctly on narrow viewports, and the " +
    "header title now truncates instead of wrapping onto a second line.",
  "Open question: should the comment thread indicator move to the left " +
    "gutter, matching the margin-note pattern used elsewhere in the app?",
];

/** Registered under docKey `doc-fixture` in `yorkie-offline.tsx#CANVAS_SEEDS`. */
export function seedDocsFixture(doc: Document<never, never>): void {
  doc.update((root) => {
    // `ElementNode`/`TextNode` is a deeply recursive discriminated union
    // (`type` must be the exact literal each variant expects); hand-authored
    // fixture literals are cast rather than fought into perfect structural
    // agreement with it — this is dev-only sandbox data, and its correctness
    // is validated by whether Yorkie accepts it and the engine renders it,
    // not by satisfying the type checker.
    (root as unknown as { content: unknown }).content = new Tree({
      type: "doc",
      children: PARAGRAPHS.map((text, i) => paragraph(`block-fixture-${i}`, text)),
    } as unknown as ElementNode);
  });
}
