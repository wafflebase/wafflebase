import { BadRequestException } from '@nestjs/common';
import type { Document } from '@prisma/client';
import type { DocumentService } from '../../document/document.service';

/**
 * The v1 sheet surface — tabs, cells, rows/columns, worksheet settings,
 * styles, dimensions, rules, charts, filter/pivot — is only meaningful on a
 * `sheet` document, and every family has to say so *before* it opens a Yorkie
 * document.
 *
 * The check is not cosmetic. `YorkieService.withDocument` defaults to the
 * `sheet-` docKey prefix, so a `doc` / `note` / `slides` / blob id reaching
 * one of these handlers does not open ITS document — it attaches an empty one
 * under `sheet-<id>` that no editor will ever open. A write verb additionally
 * passes `initialRoot`, which Yorkie applies to any *empty* document, so
 * without this guard a write seeded a canonical spreadsheet root, stored the
 * cell in it and answered `200`, leaving a permanent phantom `sheet-<id>`
 * document beside the real `doc-<id>` one that later reads on the same id then
 * served back — self-consistent, and invisible to the editor that owns the id.
 * A read creates nothing, but still described a wrong *document* as a missing
 * *tab*, which sends a client retrying `tabId`s that were never the problem.
 *
 * `400`, not `404`: the request is well-formed, it is the document that cannot
 * take it. Nine controllers carried a private copy of this method that differed
 * only in the noun leading the message; the copies are what let the cells one
 * go missing until #1019, so the logic lives here once and each controller
 * supplies only its `subject`.
 *
 * @param documentService resolves the document and enforces workspace scope —
 *   an id outside the workspace is `404 Document not found`, raised by
 *   `getDocumentOrThrow` before the type is ever looked at.
 * @param subject the plural noun phrase that leads the message, e.g. `Tabs`.
 *   It is API surface: clients read it, and the CLI forwards it verbatim.
 *   `sheet-document.util.spec.ts` pins every family's wording.
 */
export async function assertSheetDocument(
  documentService: Pick<DocumentService, 'getDocumentOrThrow'>,
  subject: string,
  documentId: string,
  workspaceId: string,
): Promise<Document> {
  const doc = await documentService.getDocumentOrThrow({
    id: documentId,
    workspaceId,
  });
  if (doc.type !== 'sheet') {
    throw new BadRequestException(
      `${subject} are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
    );
  }
  return doc;
}
