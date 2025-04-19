import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from './document.service';
import { Document as DocumentModel } from '@prisma/client';

@Controller('documents')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('/:id')
  async getDocumentById(
    @Param('id') id: string,
  ): Promise<DocumentModel | null> {
    const doc = await this.documentService.document({ id: Number(id) });
    if (!doc) {
      throw new NotFoundException(`document not found with id ${id}`);
    }
    return doc;
  }

  @Get('/')
  async getDocuments(): Promise<DocumentModel[]> {
    return this.documentService.documents({});
  }

  @Post('/')
  async createDocument(
    @Body() documentData: DocumentModel,
  ): Promise<DocumentModel> {
    return this.documentService.createDocument(documentData);
  }

  @Delete('/:id')
  async deleteDocument(@Param('id') id: string): Promise<DocumentModel> {
    const doc = await this.documentService.deleteDocument({ id: Number(id) });
    if (!doc) {
      throw new NotFoundException(`document not found with id ${id}`);
    }
    return doc;
  }
}
