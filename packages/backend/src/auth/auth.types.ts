import { User } from '@prisma/client';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: User & {
    isApiKey?: boolean;
    workspaceId?: string;
    scopes?: string[];
  };
}
