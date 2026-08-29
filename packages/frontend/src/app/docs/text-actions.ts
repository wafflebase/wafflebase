import {
  serializeMarkdown,
  serializeText,
  type Document as DocsDocument,
} from "@wafflebase/docs";
import { downloadBlob, safeFilename } from "./export-utils";

/**
 * Text-stream exports (Markdown / plain text).
 *
 * Both serializers ship in `@wafflebase/docs` and are what the CLI's
 * `wafflebase docs content --format md|text` already prints; these two
 * wrappers put the same output behind the editor's Export menu. They are
 * synchronous and take no `onProgress` — the whole document is walked in one
 * pass, so there is nothing to report — but they stay `async` to match the
 * `ExportAction` shape the DOCX and PDF entries share.
 */

/** UTF-8 is stated explicitly so a downloaded file opens as UTF-8, not as the reader's locale codepage. */
const MARKDOWN_MIME = "text/markdown;charset=utf-8";
const TEXT_MIME = "text/plain;charset=utf-8";

/**
 * Export the given Document as GitHub-Flavoured Markdown and trigger a
 * browser download.
 *
 * `inlineImages: true` — unlike the CLI, which prints to a terminal and
 * replaces `data:` images with an `[image]` placeholder, a downloaded `.md`
 * file is meant to render, so the image source is kept.
 *
 * The serializer is lossy by design (alignment, indent, color, font, sup/sub,
 * underline, table merges and nested tables are dropped) and header/footer
 * are page chrome that has no place in a single linear stream, so they are
 * left out — the same default the CLI uses.
 */
export async function exportMarkdownAndDownload(
  doc: DocsDocument,
  title: string,
): Promise<void> {
  const text = serializeMarkdown(doc, { inlineImages: true });
  downloadBlob(
    new Blob([text], { type: MARKDOWN_MIME }),
    safeFilename(title, "md"),
  );
}

/**
 * Export the given Document as plain text and trigger a browser download.
 * All formatting is dropped; tables become tab-separated rows.
 */
export async function exportTextAndDownload(
  doc: DocsDocument,
  title: string,
): Promise<void> {
  const text = serializeText(doc);
  downloadBlob(new Blob([text], { type: TEXT_MIME }), safeFilename(title, "txt"));
}
