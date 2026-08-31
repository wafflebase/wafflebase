import { Command } from 'commander';
import type { Document } from '@wafflebase/docs';
import type { SlidesDocument } from '@wafflebase/slides/node';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import type {
  ApiResponse,
  HttpClient,
  NoteContent,
} from '../client/http-client.js';

/**
 * The write half of `docs content` / `slides content` / `notes content`.
 *
 * All three verbs are the same request — `PUT /documents/:id/content` — and
 * the backend picks the writer from the document's *persisted* type, not
 * from the URL (`packages/backend/src/api/v1/docs-content.controller.ts`).
 * A payload whose shape does not match that type comes back as a 400
 * (`Body shape '<sniffed>' does not match document type '<stored>'`), and a
 * spreadsheet comes back as a 409 `TYPE_MISMATCH`. Both are relayed verbatim
 * by `forwardUpstreamError`, so this file deliberately validates nothing
 * beyond "is it JSON": the controller owns the shape contract, and a second
 * copy of it here would drift from it.
 *
 * The three commands therefore differ only in which typed client method they
 * reach for and in the noun their errors use — hence one shared builder
 * rather than three near-identical handlers.
 *
 * The response is the request body echoed back (the controller returns what
 * it stored rather than re-reading Yorkie), so `output()` prints the content
 * that is now live on the document.
 */
interface SetContentSpec {
  /** `docs` / `slides` / `notes` — used only in help and error text. */
  noun: string;
  description: string;
  /**
   * The typed client method for this document kind. Every one of them is
   * `PUT /documents/:id/content` with the body verbatim, which is what lets
   * the single dry-run preview below stand in for all three.
   */
  send(
    client: HttpClient,
    docId: string,
    body: unknown,
  ): Promise<ApiResponse<unknown>>;
}

const DOCS_SPEC: SetContentSpec = {
  noun: 'document',
  description: 'Replace document content from JSON (stdin or --data)',
  send: (client, docId, body) => client.putDocContent(docId, body as Document),
};

const SLIDES_SPEC: SetContentSpec = {
  noun: 'deck',
  description: 'Replace deck content from JSON (stdin or --data)',
  send: (client, docId, body) =>
    client.putSlidesContent(docId, body as SlidesDocument),
};

const NOTES_SPEC: SetContentSpec = {
  noun: 'note',
  description: 'Replace note content from JSON (stdin or --data)',
  send: (client, docId, body) =>
    client.putNoteContent(docId, body as NoteContent),
};

function registerSetContent(parent: Command, spec: SetContentSpec) {
  parent
    .command('set-content <doc-id>')
    .description(spec.description)
    // NOTE: `--format` is intentionally not redeclared here, for the same
    // reason it is not on the read-side `content` command — the global
    // `--format` (declared in `createProgram`) catches the user's value and
    // `parseOutputFormat` validates it. Unlike the read side there is no
    // md/text rendering to route to: the response is the stored JSON.
    .option('--data <json>', 'Content as a JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { data: dataStr } = this.opts<{ data?: string }>();

      // Parse inside a try: a malformed `--data`/stdin payload is user
      // input, and the message has to name which one it came from.
      // `runCli` would envelope an uncaught `SyntaxError` anyway, but
      // as a bare "Unexpected token …" with no mention of `--data` or
      // stdin, and it has to be caught here to add that.
      let content: unknown;
      try {
        let raw: string;
        if (dataStr) {
          raw = dataStr;
        } else {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          raw = Buffer.concat(chunks).toString('utf-8');
        }
        content = JSON.parse(raw) as unknown;
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON ${spec.noun} content${
              dataStr ? ' in --data' : ' on stdin'
            }: ${e instanceof Error ? e.message : String(e)}`,
          ),
          this,
        );
        return;
      }

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/content`,
            content,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await spec.send(getClient(opts), docId, content);
        // Surfaces a backend-shaped error (e.g., TYPE_MISMATCH for a
        // spreadsheet, or the body-shape/type mismatch 400) verbatim so
        // agents reading stderr can act on its `code`; anything else throws
        // and comes back out through `outputError`.
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

/** Mount `docs set-content` on the `docs` group. */
export function registerDocsSetContentCommand(doc: Command) {
  registerSetContent(doc, DOCS_SPEC);
}

/** Mount `slides set-content` on the `slides` group. */
export function registerSlidesSetContentCommand(slides: Command) {
  registerSetContent(slides, SLIDES_SPEC);
}

/** Mount `notes set-content` on the `notes` group. */
export function registerNotesSetContentCommand(notes: Command) {
  registerSetContent(notes, NOTES_SPEC);
}
