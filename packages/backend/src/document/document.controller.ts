import {
  Req,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from './document.service';
import { Document as DocumentModel } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('/:id')
  async getDocumentById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentModel | null> {
    const doc = await this.documentService.document({
      id: Number(id),
    });
    if (!doc || doc.authorID !== Number(req.user.id)) {
      throw new ForbiddenException('You do not have access to this document');
    }
    return doc;
  }

  @Get('/')
  async getDocuments(
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentModel[]> {
    return this.documentService.documents({
      where: {
        authorID: Number(req.user.id),
      },
    });
  }

  @Post('/')
  async createDocument(
    @Req() req: AuthenticatedRequest,
    @Body() doc: DocumentModel,
  ): Promise<DocumentModel> {
    doc.authorID = Number(req.user.id);
    return this.documentService.createDocument(doc);
  }

  @Delete('/:id')
  async deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DocumentModel> {
    const doc = await this.documentService.deleteDocument({
      id: Number(id),
      authorID: Number(req.user.id),
    });
    if (!doc) {
      throw new NotFoundException(`document not found with id ${id}`);
    }
    return doc;
  }
}
