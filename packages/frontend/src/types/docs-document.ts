import { Tree } from '@yorkie-js/sdk';
import type { DocsRangeAnchor, Thread } from '@/types/comments.ts';

/**
 * Yorkie document root for the docs (rich-text) editor.
 *
 * - `content`: yorkie.Tree holding the block/inline structure
 * - `pageSetup`: document-level metadata (paper size, margins)
 * - `stylesJson`: named-style overrides registry (`DocStyles`) serialized as
 *   a JSON string. A tiny, rarely-concurrent registry — whole-blob LWW is
 *   acceptable and a scalar string avoids Yorkie proxy double-encoding.
 *   Existing documents without the field resolve to built-in styles.
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
  stylesJson?: string;
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
 *
 * `comments` is initialized to an empty map for the same reason it must
 * be created once: Yorkie resolves concurrent assignment of the same
 * object key by LWW. If the container were instead lazily created on
 * first comment (`if (!root.comments) root.comments = {}`), two users
 * adding the first comment concurrently would each create a fresh map
 * and one would be discarded wholesale, losing a thread. Seeding it at
 * bootstrap means all replicas share one container and concurrent
 * inserts only set distinct keys, which merge cleanly.
 */
export function initialDocsRoot(): Partial<YorkieDocsRoot> {
  return {
    comments: {},
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
