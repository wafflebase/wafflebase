import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';

/**
 * `comments` — threaded comments on a document.
 *
 * Comments live entirely inside the Yorkie CRDT: no table, no service, and
 * until the class-B work no route either, which is why nothing outside the
 * editor could read or write them. The document type decides where a thread
 * is stored and what it is anchored to, and that shows up in one place only:
 * what `add` needs.
 *
 * - **sheet** — `--tab` and `--ref` (an A1 cell). The stored anchor is the
 *   cell's stable row/column ids, so the thread follows the cell when rows are
 *   inserted above it; `list` reports the current `ref` back, and `null` there
 *   means the row or column it was anchored to is gone.
 * - **pdf** — `--page` (0-based) and `--rect` (`x,y,w,h` in 0..1 units of the
 *   page, so it is zoom-independent).
 * - **doc** — cannot be created here. A text-range anchor is a pair of CRDT
 *   tree positions that only an editor session can mint. Listing, replying,
 *   resolving and deleting a doc's threads all work.
 *
 * The author of everything written here is the authenticated caller — for an
 * API key, the user who minted it.
 */
export function registerCommentsCommand(program: Command) {
  const comments = program
    .command('comments')
    .alias('comment')
    .description('Read and write comment threads on a document');

  comments
    .command('list <doc-id>')
    .description('List every comment thread on a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        // Inside the try: the preview path is built from an id and `seg()`
        // refuses a `.` / `..` one, so that refusal has to reach
        // `outputError` as the error envelope rather than escape the handler.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/comments`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listComments(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  comments
    .command('add <doc-id> <body>')
    .description(
      'Open a thread: on a sheet cell (--tab/--ref) or a PDF page region (--page/--rect)',
    )
    .option('--tab <tab-id>', 'Sheet tab holding the cell', 'tab-1')
    .option('--ref <a1>', 'Anchor cell as an A1 reference (sheet documents)')
    .option('--page <n>', 'Page index, 0-based (PDF documents)')
    .option(
      '--rect <x,y,w,h>',
      'Page-relative rectangle in 0..1 units (PDF documents)',
    )
    .action(async function (this: Command, docId: string, body: string) {
      const opts = getGlobalOpts(this);
      const {
        tab,
        ref,
        page,
        rect: rectStr,
      } = this.opts<{
        tab: string;
        ref?: string;
        page?: string;
        rect?: string;
      }>();

      // The anchor is resolved before the dry-run branch, for the usual
      // reason: a preview of a request the server rejects is worse than none.
      let payload: Record<string, unknown>;
      if (ref) {
        payload = { body, tabId: tab, ref };
      } else if (page !== undefined || rectStr !== undefined) {
        const pageIndex = Number(page);
        if (page === undefined || !Number.isInteger(pageIndex) || pageIndex < 0) {
          outputError(
            new Error('--page must be a non-negative integer (0 = first page).'),
            this,
          );
          return;
        }
        const parts = (rectStr ?? '').split(',').map((p) => Number(p.trim()));
        if (
          parts.length !== 4 ||
          parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
        ) {
          outputError(
            new Error(
              '--rect must be four numbers between 0 and 1: x,y,w,h (page-relative).',
            ),
            this,
          );
          return;
        }
        const [x, y, w, h] = parts;
        payload = { body, pageIndex, rect: { x, y, w, h } };
      } else {
        outputError(
          new Error(
            'An anchor is required: --ref <A1> for a sheet cell, or --page and --rect for a PDF region.',
          ),
          this,
        );
        return;
      }

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/comments`,
            payload,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).createCommentThread(docId, payload);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  comments
    .command('reply <doc-id> <thread-id> <body>')
    .description('Add a reply to an existing thread')
    .action(async function (
      this: Command,
      docId: string,
      threadId: string,
      body: string,
    ) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/comments/${seg(threadId)}/replies`,
            { body },
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).replyToComment(docId, threadId, body);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  // Two leaves rather than a `--resolved <bool>` flag: which one an agent
  // means is then in the command it chose, not in a value it has to spell.
  for (const [name, resolved, description] of [
    ['resolve', true, 'Mark a thread resolved'],
    ['unresolve', false, 'Reopen a resolved thread'],
  ] as const) {
    comments
      .command(`${name} <doc-id> <thread-id>`)
      .description(description)
      .action(async function (this: Command, docId: string, threadId: string) {
        const opts = getGlobalOpts(this);
        try {
          if (opts.dryRun) {
            printDryRun(
              getConfig(opts),
              'PATCH',
              `/documents/${seg(docId)}/comments/${seg(threadId)}`,
              { resolved },
            );
            return;
          }
          const fmt = parseOutputFormat(opts.format);
          const res = await getClient(opts).setCommentResolved(
            docId,
            threadId,
            resolved,
          );
          if (!res.ok) return forwardUpstreamError(res, this);
          output(res.data, fmt);
        } catch (e) {
          outputError(e, this);
        }
      });
  }

  comments
    .command('delete <doc-id> <thread-id>')
    .description('Delete a whole thread and every comment in it')
    .action(async function (this: Command, docId: string, threadId: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'DELETE',
            `/documents/${seg(docId)}/comments/${seg(threadId)}`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteCommentThread(docId, threadId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  comments
    .command('delete-comment <doc-id> <thread-id> <comment-id>')
    .description(
      'Delete one comment; deleting the opening comment deletes the thread',
    )
    .action(async function (
      this: Command,
      docId: string,
      threadId: string,
      commentId: string,
    ) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'DELETE',
            `/documents/${seg(docId)}/comments/${seg(threadId)}/comments/${seg(commentId)}`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteComment(
          docId,
          threadId,
          commentId,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
