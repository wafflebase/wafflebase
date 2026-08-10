// @ts-check
/**
 * stamp.mjs — the dev-only `data-wb-node` transform.
 *
 * THE THIRD CONSUMER of `jsx-nodes.mjs`. The extractor emits paths with
 * `walkJsx()`, the injector resolves anchors with it, and this stamps the DOM
 * with it. Three implementations of "which child is index 2" would drift, and
 * the drift would surface as a click selecting the wrong node — so the numbering
 * is imported, never re-derived.
 *
 * WHY TWO ATTRIBUTES, AND WHY `fp` IS THE IMPORTANT ONE.
 *
 * The DOM a designer clicks is the PATCHED tree — the scene module is served
 * with the staged plan already applied, because that is the only way a
 * `layout-insert` can be previewed at all. But every intent is expressed in the
 * BASELINE frame (what is on disk, what `design-metadata.json` describes). So a
 * path read off the patched tree is in the wrong frame the moment any staged
 * insert or remove sits above the node, and using it as an anchor would write
 * to a sibling.
 *
 * `data-wb-fp` closes that gap, and it works precisely because of what `fpOf`
 * leaves out. The fingerprint excludes className CONTENT and the child tag
 * SEQUENCE (see `jsx-nodes.mjs`), so a node keeps its fingerprint across its own
 * class edit and across an insert into its parent — which makes it a
 * frame-independent key. The host resolves a click by matching it against the
 * baseline metadata with the same unique-match rules the server uses, so:
 *
 *   - exactly one baseline match  → the anchor, in the baseline frame;
 *   - several matches             → refuse, and offer the candidates;
 *   - no match                    → the node was CREATED by a staged insert, so
 *                                   it has no baseline anchor by construction.
 *                                   The client edits it through the parent
 *                                   insert's `raw` payload, exactly as the CP2
 *                                   invariant requires.
 *
 * `data-wb-node` (`<root>:<path>`) is kept as the cheap grouping key: it is what
 * lets the host highlight all N rendered rows of one `.map()` source node, and
 * what the runtime `clickSelectable` check reads back out of the DOM.
 *
 * WHY THERE IS ALSO A `data-wb-file`.
 *
 * `<root>:<path>` is not unique within a frame. A scene mounted inside the app
 * shell renders `Layout`, `AppSidebar`, `NavUser` AND the page into one
 * document, all of them stamped, and `Page` / `default` are ordinary root names
 * — two files contributing `Page:0.1` is normal, not exotic. Worse, the host
 * needs the file to know WHICH metadata tree to resolve the click against;
 * guessing by root name would silently anchor an edit in the wrong file. The
 * attribute is verbose in dev HTML and that is the right trade: this transform
 * never runs outside the sandbox's own dev server.
 *
 * WHAT IT DOES NOT DO. It never runs against the frontend's own dev server or
 * production build — it is registered only by the sandbox's Vite config, and
 * only for modules carrying the `?wbFrame=` query. The one-way dependency and
 * the `verify:frontend:chunks` budget are untouched.
 */
import { findJsxRoots, isReturnsRoot, ts, walkJsx, parse } from './jsx-nodes.mjs';

/**
 * Insert `data-wb-node` / `data-wb-fp` / `data-wb-file` on every JSX element.
 *
 * @param {string} text  Source of a `.tsx` file — the PATCHED text, not disk.
 * @param {string} [file]  Repo-relative path, emitted as `data-wb-file`. Omitted
 *   only by tests that assert the numbering; a frame always passes it, because
 *   without it a click cannot be attributed to a source file.
 * @returns {{text: string, stamped: string[]}} the rewritten source and the
 *   `<root>:<path>` ids it wrote, so a caller can assert them against metadata.
 */
export function stampSource(text, file) {
  // Repo-relative POSIX paths contain nothing that needs escaping inside a
  // double-quoted JSX attribute; refuse rather than emit broken JSX if that ever
  // stops being true.
  const fileAttr = file && !/["<>&]/.test(file) ? ` data-wb-file="${file}"` : '';
  const sf = parse(text, 'scene.tsx');
  const { roots } = findJsxRoots(sf);

  /** @type {{offset: number, attrs: string}[]} */
  const edits = [];
  /** @type {string[]} */
  const stamped = [];
  // One node can only belong to one root (a nested function's JSX is its own
  // root and is not reachable from the outer one), but guard anyway: stamping
  // twice would produce a duplicate attribute and a parse error.
  const seen = new Set();

  for (const [rootName, root] of Object.entries(roots)) {
    for (const entry of walkJsx(sf, root)) {
      if (isReturnsRoot(entry.node)) continue; // no source element to stamp
      const node = /** @type {ts.Node} */ (entry.node);
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null;
      if (!opening) continue; // a fragment has no attribute list

      // `attributes.pos` sits after the tag name AND after any type arguments
      // (`<Select<T> …>`), which `tagName.end` does not — inserting at the
      // latter would splice between the tag and its type args.
      const offset = opening.attributes.pos;
      if (seen.has(offset)) continue;
      seen.add(offset);

      const id = `${rootName}:${entry.path.join('.')}`;
      stamped.push(id);
      // Values are an identifier, digits/dots, and hex — nothing that needs
      // escaping inside a double-quoted JSX attribute.
      edits.push({
        offset,
        attrs: ` data-wb-node="${id}" data-wb-fp="${entry.fp}"${fileAttr}`,
      });
    }
  }

  // Highest offset first, so earlier offsets stay valid — the same discipline
  // every multi-splice path in `inject.mjs` follows.
  edits.sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of edits) out = out.slice(0, e.offset) + e.attrs + out.slice(e.offset);

  return { text: out, stamped };
}
