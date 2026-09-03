import { YSON } from '@yorkie-js/sdk';
import {
  docsTreeToDocument,
  type Document as DocsDocument,
  type DocsTreeNode,
} from '@wafflebase/docs';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import type { Element, SlidesDocument } from '@wafflebase/slides';
import { boardToSlidesDocument } from '@wafflebase/board';
import type { YorkieBoardRoot } from '@/types/board-document';
import { unwrapYsonScalars } from './unwrap-yson';

/**
 * A revision snapshot is YSON: JSON plus constructor-wrapped CRDT values
 * (`Int(320)`, `Long(…)`, `Text([...])`, `Tree({...})`). For sheets, slides
 * and board the root is otherwise plain JSON — the backend's `read*Root`
 * helpers exist to unwrap *live* Yorkie proxies and have no job here.
 *
 * Parsing alone is **not** the whole conversion, though: `YSON.parse` hands
 * every scalar literal back as a tagged object (`Int(320)` →
 * `{type:'Int',value:320}`), so each adapter runs the result through
 * {@link unwrapYsonScalars} before it reaches an engine that types those
 * fields `number`. See that module for what went wrong without it.
 *
 * Through `@yorkie-js/sdk@0.7.18` this parser was a regex chain with two
 * defects, both measured against a real server: its patterns bottomed out at
 * three nested levels per type (so no docs `Tree` parsed at all — every
 * wafflebase docs document is `doc > block > inline > text`, depth 4), and
 * they were not string-aware, counting `{}`/`[]` inside string *values* as
 * structure (so a note containing an unmatched `]` threw, while balanced
 * brackets survived by accident).
 *
 * **`0.7.19` fixed both** — `preprocessYSON` is now a string-aware scanner —
 * which is what let docs preview ship and retired the note caveat. Callers
 * must still handle a throw: a malformed or truncated snapshot is always
 * possible. `RevisionPreview` turns it into a `role="alert"` rather than
 * rendering an empty document, because a blank render would read as "this
 * version was empty."
 */
export function parseSheetSnapshot(snapshot: string): SpreadsheetDocument {
  return unwrapYsonScalars<SpreadsheetDocument>(YSON.parse(snapshot));
}

export function parseSlidesSnapshot(snapshot: string): SlidesDocument {
  return unwrapYsonScalars<SlidesDocument>(YSON.parse(snapshot));
}

/**
 * A board *renders* as one synthetic slide, but it is not stored as one.
 * The persisted `board-<id>` root is `{meta, elements}` (`YorkieBoardRoot`);
 * the synthetic slide — along with the themes, masters and layouts the
 * slides renderer needs — is manufactured at read time by
 * `boardToSlidesDocument`, exactly as `YorkieBoardStore.read()` does for the
 * live document.
 *
 * Aliasing this to {@link parseSlidesSnapshot} therefore produced a
 * `SlidesDocument` with no `slides` at all — and, because that is a missing
 * key rather than a parse error, it rendered as a blank canvas under a
 * banner naming a date instead of raising anything the preview could report.
 */
export function parseBoardSnapshot(snapshot: string): SlidesDocument {
  const root = unwrapYsonScalars<Partial<YorkieBoardRoot>>(YSON.parse(snapshot));
  return boardToSlidesDocument({
    // Mirrors `YorkieBoardStore.read()`'s defaults: a board that was never
    // edited has no `meta` at all (a viewer attaches with an empty initial
    // root — see `boardInitialRootForRole`).
    meta: {
      title: root.meta?.title ?? 'Untitled board',
      unit: root.meta?.unit,
      recentColors: root.meta?.recentColors,
    },
    // Unwrapped above, so these are already the plain `Element` objects the
    // model wants — every `frame` number a number, no proxy left to detach.
    elements: (root.elements ?? []) as unknown as Element[],
  });
}

/**
 * A note's whole content is one `Text` CRDT, which {@link unwrapYsonScalars}
 * passes through by reference — unwrapping it would destroy the very thing
 * `YSON.textToString` needs. The walk still runs, so any scalar a future note
 * root gains alongside `content` is normalised like every other type's.
 */
export function parseNoteSnapshot(snapshot: string): string {
  const root = unwrapYsonScalars<{ content?: YSON.Text }>(YSON.parse(snapshot));
  return root.content ? YSON.textToString(root.content) : '';
}

/**
 * One `YSON.parse`d tree node in the shape `@wafflebase/docs` reads.
 *
 * The snapshot dialect and the live-proxy dialect disagree twice, and
 * **neither disagreement throws** — left unhandled they produce a document
 * whose every block falls back to `paragraph` with no style and no table,
 * which renders as plausible content that is not what the user wrote. That is
 * the failure this whole feature is built to avoid, so the conversion is
 * explicit rather than a cast:
 *
 * 1. **`attrs`, not `attributes`.** `postprocessTreeNode` whitelists
 *    `{type, value, attrs, children}`; the live proxy emits `attributes`.
 * 2. **Values stay JSON-encoded.** The server writes `"align": "\"center\""`.
 *    The live path decodes each one (`parseObjectValues` = `JSON.parse` per
 *    value); `YSON.parse` assigns the map verbatim. Without the decode
 *    `align` compares as `"center"` *including the quotes* and every style
 *    lookup misses.
 *
 * A value that is not valid JSON is passed through as the raw string rather
 * than dropped: it is not what this writer produces, but a readable
 * approximation beats losing the attribute.
 */
function normalizeYsonTreeNode(node: YsonTreeNode): DocsTreeNode {
  const normalized: DocsTreeNode = { type: node.type };
  if (node.value !== undefined) normalized.value = node.value;
  if (node.attrs) {
    const attributes: Record<string, string> = {};
    for (const [key, raw] of Object.entries(node.attrs)) {
      try {
        const decoded = JSON.parse(raw) as unknown;
        attributes[key] =
          typeof decoded === 'string' ? decoded : String(decoded);
      } catch {
        attributes[key] = raw;
      }
    }
    normalized.attributes = attributes;
  }
  if (node.children) {
    normalized.children = node.children.map(normalizeYsonTreeNode);
  }
  return normalized;
}

type YsonTreeNode = {
  type: string;
  value?: string;
  attrs?: Record<string, string>;
  children?: YsonTreeNode[];
};

/**
 * A docs body is a `Tree`, so unlike the other four types this one needs a
 * real converter — the walk in `@wafflebase/docs`'s `docsTreeToDocument`,
 * which the backend's `readDocsRoot` calls too so the two readers cannot
 * drift.
 *
 * This was unreachable until `@yorkie-js/sdk@0.7.19`: `preprocessYSON` was a
 * regex chain that bottomed out at three nested levels per type, and every
 * wafflebase docs document is `doc > block > inline > text`, which is four
 * (tables go deeper still). 0.7.19 replaced it with a string-aware scanner,
 * which also retired the note caveat — a note whose text held an unmatched
 * `]` used to throw here.
 *
 * `pageSetup` is plain JSON in a snapshot, so it needs no proxy walk of its
 * own; the scalar unwrap above has already turned its `Int`s back into
 * numbers.
 */
export function parseDocsSnapshot(snapshot: string): DocsDocument {
  const root = unwrapYsonScalars<{
    content?: { type: 'Tree'; root: YsonTreeNode };
    pageSetup?: DocsDocument['pageSetup'];
    stylesJson?: string;
  }>(YSON.parse(snapshot));

  if (!root.content?.root) return { blocks: [] };

  const doc = docsTreeToDocument(normalizeYsonTreeNode(root.content.root), {
    stylesJson: root.stylesJson,
  });
  if (root.pageSetup) doc.pageSetup = root.pageSetup;
  return doc;
}
