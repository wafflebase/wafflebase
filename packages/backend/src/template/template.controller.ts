import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Document as DocumentModel } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import {
  TemplateBrowsePage,
  TemplateListingView,
  TemplateService,
} from './template.service';
import {
  BrowseTemplatesDto,
  PublishTemplateDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './template.dto';

/**
 * The template gallery (docs/design/template-gallery.md).
 *
 * Guards are per-route rather than on the controller because `GET
 * /templates/:id` is deliberately **public**: an unlisted or public listing
 * must be readable by a logged-out visitor, which is what makes the landing
 * page work before sign-in. Every mutating route requires a session.
 */
@Controller()
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  /** Publish (or re-publish) a document as a template. Manager-gated. */
  @Post('documents/:id/template')
  @UseGuards(JwtAuthGuard)
  async publish(
    @Param('id') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: PublishTemplateDto,
  ): Promise<TemplateListingView> {
    return this.templateService.publish(documentId, Number(req.user.id), body);
  }

  /** The listing attached to a document, or `null` — the Share dialog's tab. */
  @Get('documents/:id/template')
  @UseGuards(JwtAuthGuard)
  async findByDocument(
    @Param('id') documentId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TemplateListingView | null> {
    return this.templateService.findByDocument(documentId, Number(req.user.id));
  }

  @Patch('templates/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateTemplateDto,
  ): Promise<TemplateListingView> {
    return this.templateService.update(id, Number(req.user.id), body);
  }

  /** Unpublish. The listing and its preview link go; the document stays. */
  @Delete('templates/:id')
  @UseGuards(JwtAuthGuard)
  async unpublish(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ deleted: true }> {
    return this.templateService.unpublish(id, Number(req.user.id));
  }

  /**
   * Browse listings — the collection behind the workspace Templates tab, the
   * New-from-template picker, and (Phase 3) the public gallery.
   *
   * Optional auth for the same reason `GET /templates/:id` has it: the public
   * scope must serve a logged-out visitor, while `scope=workspace` needs the
   * caller's identity and is refused without it.
   *
   * Declared **before** `GET /templates/:id` so `/templates` is not swallowed
   * by the parameterized route.
   */
  @Get('templates')
  @UseGuards(OptionalJwtAuthGuard)
  async browse(
    @Query() query: BrowseTemplatesDto,
    @Req() req: Request & { user?: { id: number } },
  ): Promise<TemplateBrowsePage> {
    const userId = req.user ? Number(req.user.id) : undefined;
    return this.templateService.browse(query, userId);
  }

  /**
   * What `/t/:id` renders, signed in or not. The `previewToken` it returns is
   * what the read-only viewer mounts on.
   *
   * `OptionalJwtAuthGuard` rather than no guard at all: an anonymous visitor
   * must reach an unlisted or public listing, while a signed-in member must
   * additionally reach their own workspace's listings and be told whether they
   * can manage one.
   */
  @Get('templates/:id')
  @UseGuards(OptionalJwtAuthGuard)
  async find(
    @Param('id') id: string,
    @Req() req: Request & { user?: { id: number } },
  ): Promise<TemplateListingView> {
    const userId = req.user ? Number(req.user.id) : undefined;
    return this.templateService.findForViewer(id, userId);
  }

  /** Start a new document from this template, in a workspace the caller owns. */
  @Post('templates/:id/use')
  @UseGuards(JwtAuthGuard)
  async use(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UseTemplateDto,
  ): Promise<DocumentModel> {
    return this.templateService.use(id, Number(req.user.id), body);
  }
}
