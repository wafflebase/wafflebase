import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDocumentDto,
  CreateDocumentInWorkspaceDto,
} from './document.dto';

async function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
) {
  const instance = plainToInstance(cls, payload);
  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

const VALID_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const VALID_FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf';

describe('CreateDocumentDto', () => {
  it('accepts a valid fileId', async () => {
    expect(
      await errorsFor(CreateDocumentDto, {
        title: 'My Doc',
        fileId: VALID_FILE_ID,
      }),
    ).toHaveLength(0);
  });

  it('rejects a path-traversal fileId', async () => {
    const errs = await errorsFor(CreateDocumentDto, {
      title: 'My Doc',
      fileId: '../etc/passwd',
    });
    expect(errs).not.toHaveLength(0);
    expect(errs.some((e) => e.property === 'fileId')).toBe(true);
  });

  it('rejects a malformed (non-UUID) fileId', async () => {
    const errs = await errorsFor(CreateDocumentDto, {
      title: 'My Doc',
      fileId: 'not-a-uuid',
    });
    expect(errs).not.toHaveLength(0);
    expect(errs.some((e) => e.property === 'fileId')).toBe(true);
  });

  it('accepts omitting fileId (optional)', async () => {
    expect(
      await errorsFor(CreateDocumentDto, { title: 'My Doc' }),
    ).toHaveLength(0);
  });
});

describe('CreateDocumentInWorkspaceDto', () => {
  it('accepts a valid fileId', async () => {
    expect(
      await errorsFor(CreateDocumentInWorkspaceDto, {
        title: 'My Doc',
        workspaceId: VALID_WORKSPACE_ID,
        fileId: VALID_FILE_ID,
      }),
    ).toHaveLength(0);
  });

  it('rejects a path-traversal fileId', async () => {
    const errs = await errorsFor(CreateDocumentInWorkspaceDto, {
      title: 'My Doc',
      workspaceId: VALID_WORKSPACE_ID,
      fileId: '../etc/passwd',
    });
    expect(errs).not.toHaveLength(0);
    expect(errs.some((e) => e.property === 'fileId')).toBe(true);
  });

  it('rejects a malformed (non-UUID) fileId', async () => {
    const errs = await errorsFor(CreateDocumentInWorkspaceDto, {
      title: 'My Doc',
      workspaceId: VALID_WORKSPACE_ID,
      fileId: 'not-a-uuid',
    });
    expect(errs).not.toHaveLength(0);
    expect(errs.some((e) => e.property === 'fileId')).toBe(true);
  });

  it('accepts omitting fileId (optional)', async () => {
    expect(
      await errorsFor(CreateDocumentInWorkspaceDto, {
        title: 'My Doc',
        workspaceId: VALID_WORKSPACE_ID,
      }),
    ).toHaveLength(0);
  });
});
