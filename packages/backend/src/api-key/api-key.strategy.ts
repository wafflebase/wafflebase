import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { ApiKeyService } from './api-key.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private apiKeyService: ApiKeyService) {
    super();
  }

  async validate(req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer wfb_')) {
      return false;
    }

    const token = authHeader.slice('Bearer '.length);
    const apiKey = await this.apiKeyService.validateKey(token);

    return {
      id: apiKey.createdBy,
      workspaceId: apiKey.workspaceId,
      scopes: apiKey.scopes,
      isApiKey: true,
    };
  }
}
