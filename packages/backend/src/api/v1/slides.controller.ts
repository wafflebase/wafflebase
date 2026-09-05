import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { DocumentService } from '../../document/document.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';
import {
  SlidesYorkieRoot,
  readSlidesRoot,
} from '../../yorkie/slides-tree';
import {
  LayoutSummary,
  SlideArrayLike,
  SlideOpResult,
  addSlide,
  applySlideChange,
  deleteSlide,
  duplicateSlide,
  listLayouts,
  moveSlide,
} from '../../yorkie/slide-ops';
import { BUILT_IN_LAYOUTS } from '@wafflebase/slides';

const SLIDES_KEY_PREFIX = YORKIE_DOC_KEY_PREFIXES.slides;

/**
 * Per-slide editing and the layout catalog for a `slides` document.
 *
 * `PUT .../content` can replace a whole deck, and that is all the API offered
 * before this controller: adding a slide meant reading the deck, hand-building
 * a slide with placeholder elements seeded from the master's styles, and
 * writing the entire document back — with every concurrent edit in between
 * lost. These four verbs instead land a **single granular change** on
 * `root.slides` (one `splice`, or the CRDT array's in-place reorder for a
 * move), so a collaborator's concurrent edit to any other slide survives; and
 * the layout list is what makes `layoutId` guessable rather than folklore.
 *
 * Positions are 1-based, matching the row/column endpoints, and out-of-range
 * values clamp rather than fail: "put it at the end" is a legitimate thing to
 * mean by a number past the end.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1SlidesController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieService: YorkieService,
  ) {}

  private async assertSlidesDocument(workspaceId: string, documentId: string) {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (meta.type !== 'slides') {
      throw new BadRequestException(
        `Slide operations are only available on slides documents; ` +
          `"${documentId}" is a "${meta.type}" document.`,
      );
    }
    return meta;
  }

  @Get('layouts')
  async layouts(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<{ layouts: LayoutSummary[] }> {
    await this.assertSlidesDocument(workspaceId, documentId);
    const layouts = await this.yorkieService.withDocument<
      LayoutSummary[],
      SlidesYorkieRoot
    >(
      documentId,
      (doc) => listLayouts(readSlidesRoot(doc.getRoot()), BUILT_IN_LAYOUTS),
      { docKeyPrefix: SLIDES_KEY_PREFIX, syncMode: 'readonly' },
    );
    return { layouts };
  }

  @Post('slides')
  async add(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    await this.assertSlidesDocument(workspaceId, documentId);
    const input = asObject(body);
    const layoutId =
      input.layoutId === undefined ? 'blank' : requireString(input, 'layoutId');
    const index = optionalPosition(input.index);

    return this.apply(documentId, (document) =>
      addSlide(document, layoutId, index),
    );
  }

  @Post('slides/:slideId/duplicate')
  async duplicate(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('slideId') slideId: string,
  ) {
    await this.assertSlidesDocument(workspaceId, documentId);
    return this.apply(documentId, (document) =>
      duplicateSlide(document, slideId),
    );
  }

  @Post('slides/:slideId/move')
  async move(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('slideId') slideId: string,
    @Body() body: unknown,
  ) {
    await this.assertSlidesDocument(workspaceId, documentId);
    const index = optionalPosition(asObject(body).index);
    if (index === undefined) {
      throw new BadRequestException("'index' must be a positive integer");
    }
    return this.apply(documentId, (document) =>
      moveSlide(document, slideId, index),
    );
  }

  @Delete('slides/:slideId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('slideId') slideId: string,
  ) {
    await this.assertSlidesDocument(workspaceId, documentId);
    return this.apply(documentId, (document) =>
      deleteSlide(document, slideId),
    );
  }

  /**
   * Read the deck, decide one slide operation, and land it on `root.slides`
   * as a **granular** change.
   *
   * The operation runs *outside* `doc.update` on a detached copy of the deck,
   * so a failure (an unknown slide id) leaves the document untouched instead
   * of half-edited. What is then written is a single `splice` — or, for a move,
   * the CRDT array's own in-place reorder — never an assignment of a whole
   * array: `root.slides = <array>` is last-write-wins across the entire deck,
   * so it would discard any element or text edit a collaborator committed
   * between the read and the write, which is precisely the lost update these
   * verbs exist to avoid. See `slide-ops.ts#applySlideChange`.
   */
  private async apply(
    documentId: string,
    op: (document: ReturnType<typeof readSlidesRoot>) => SlideOpResult,
  ): Promise<{ id?: string; index?: number; slideCount: number }> {
    return this.yorkieService.withDocument<
      { id?: string; index?: number; slideCount: number },
      SlidesYorkieRoot
    >(
      documentId,
      (doc) => {
        const result = op(readSlidesRoot(doc.getRoot()));
        if (!result.ok) {
          if (result.reason === 'not_found') {
            throw new NotFoundException('Slide not found');
          }
          throw new ConflictException(
            'A presentation must keep at least one slide; delete the document ' +
              'instead of its last slide.',
          );
        }
        let index: number | undefined;
        let slideCount = 0;
        doc.update((root) => {
          if (!root.slides) root.slides = [];
          const slides = root.slides as unknown as SlideArrayLike;
          index = applySlideChange(slides, result.change);
          slideCount = slides.length;
        });
        return { id: result.id, index, slideCount };
      },
      { docKeyPrefix: SLIDES_KEY_PREFIX },
    );
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`'${key}' must be a non-empty string`);
  }
  return value.trim();
}

function optionalPosition(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException(
      "'index' must be a positive integer (1 = first slide)",
    );
  }
  return value;
}
