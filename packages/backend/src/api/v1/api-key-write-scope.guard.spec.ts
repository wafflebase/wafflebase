import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { ApiV1DocsContentController } from './docs-content.controller';
import { ApiV1DocumentsController } from './documents.controller';
import { ApiV1FilesController } from './files.controller';
import { ApiV1ImagesController } from './images.controller';
import { ApiV1TabsController } from './tabs.controller';
import { ApiV1CellsController } from './cells.controller';

function ctx(method: string, user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyWriteScopeGuard', () => {
  const guard = new ApiKeyWriteScopeGuard();

  const apiKey = (scopes?: string[]) => ({ isApiKey: true, scopes });
  const jwt = { id: 7, isApiKey: false };

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses a read-scoped API key on %s',
    (method) => {
      expect(() => guard.canActivate(ctx(method, apiKey(['read'])))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('refuses an API key with no scopes at all on a mutating request', () => {
    expect(() => guard.canActivate(ctx('PUT', apiKey(undefined)))).toThrow(
      ForbiddenException,
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows a write-scoped API key on %s',
    (method) => {
      expect(guard.canActivate(ctx(method, apiKey(['read', 'write'])))).toBe(
        true,
      );
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows a read-scoped API key on %s',
    (method) => {
      expect(guard.canActivate(ctx(method, apiKey(['read'])))).toBe(true);
    },
  );

  it('never applies to a JWT caller — their authority is workspace role, not scopes', () => {
    expect(guard.canActivate(ctx('DELETE', jwt))).toBe(true);
  });

  // The gap this guard closes was a *missing* per-handler check on
  // `PUT /content` while two sibling handlers had one. Enumerating the
  // controllers here is what stops the next v1 controller from
  // reintroducing it: a new mutating route is covered the moment its
  // controller carries the guard, and this test fails if one does not.
  describe('is mounted on every v1 controller', () => {
    it.each([
      ['docs-content', ApiV1DocsContentController],
      ['documents', ApiV1DocumentsController],
      ['files', ApiV1FilesController],
      ['images', ApiV1ImagesController],
      ['tabs', ApiV1TabsController],
      ['cells', ApiV1CellsController],
    ])('%s', (_name, controller) => {
      const guards: unknown[] =
        (Reflect.getMetadata('__guards__', controller) as unknown[]) ?? [];
      expect(guards).toContain(ApiKeyWriteScopeGuard);
    });
  });
});
