import { Tree } from '@yorkie-js/sdk';
import type { DocsRangeAnchor, Thread } from '@/types/comments.ts';

/**
 * Yorkie document root for the docs (rich-text) editor.
 *
 * - `content`: yorkie.Tree holding the block/inline structure
 * - `pageSetup`: document-level metadata (paper size, margins)
 * - `comments`: threaded comments keyed by thread id, materialized on
 *   first insertion. Existing documents without the field stay valid.
 */
export type YorkieDocsRoot = {
  content: Tree;
  pageSetup?: {
    paperSize: { name: string; width: number; height: number };
    orientation: 'portrait' | 'landscape';
    margins: { top: number; bottom: number; left: number; right: number };
  };
  comments?: { [threadId: string]: Thread<DocsRangeAnchor> };
};

/**
 * Initial Yorkie document root for a new docs document.
 *
 * The Tree CRDT is created here so that `client.attach({ initialRoot })`
 * runs the setup inside the SDK and clears the undo stack right after
 * (yorkie-js-sdk PR #1238). If we instead call `doc.update` after
 * attach to populate the Tree, the setup ends up on the undo stack —
 * a long enough Cmd+Z sequence then unwinds it and destroys the
 * initial block, crashing `text-editor.handleInput` with "Block not
 * found".
 */
export function initialDocsRoot(): Partial<YorkieDocsRoot> {
  return {
    content: new Tree({
      type: 'doc',
      children: [
        {
          type: 'block',
          attributes: {
            id: `block-${Date.now()}-0`,
            type: 'paragraph',
            alignment: 'left',
            lineHeight: '1.5',
            marginTop: '0',
            marginBottom: '8',
            textIndent: '0',
            marginLeft: '0',
          },
          children: [{ type: 'inline', children: [] }],
        },
      ],
    }),
  };
}
