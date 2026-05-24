import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateInviteDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from './workspace.dto';

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

describe('CreateWorkspaceDto', () => {
  it('accepts a valid name', async () => {
    expect(
      await errorsFor(CreateWorkspaceDto, { name: 'Marketing' }),
    ).toHaveLength(0);
  });

  it('rejects an empty name', async () => {
    const errs = await errorsFor(CreateWorkspaceDto, { name: '' });
    expect(errs).not.toHaveLength(0);
  });

  it('rejects unknown properties', async () => {
    const errs = await errorsFor(CreateWorkspaceDto, {
      name: 'ok',
      role: 'owner',
    });
    expect(errs).not.toHaveLength(0);
  });
});

describe('UpdateWorkspaceDto', () => {
  it('accepts a valid slug', async () => {
    expect(
      await errorsFor(UpdateWorkspaceDto, { slug: 'acme-team' }),
    ).toHaveLength(0);
  });

  it('rejects a slug starting with a hyphen', async () => {
    const errs = await errorsFor(UpdateWorkspaceDto, { slug: '-acme' });
    expect(errs).not.toHaveLength(0);
  });

  it('rejects a slug with uppercase characters', async () => {
    const errs = await errorsFor(UpdateWorkspaceDto, { slug: 'Acme' });
    expect(errs).not.toHaveLength(0);
  });
});

describe('CreateInviteDto', () => {
  it('accepts role=member', async () => {
    expect(
      await errorsFor(CreateInviteDto, { role: 'member' }),
    ).toHaveLength(0);
  });

  it('accepts role=owner', async () => {
    expect(
      await errorsFor(CreateInviteDto, { role: 'owner' }),
    ).toHaveLength(0);
  });

  it('rejects an arbitrary role string (no privilege smuggling)', async () => {
    const errs = await errorsFor(CreateInviteDto, { role: 'superadmin' });
    expect(errs).not.toHaveLength(0);
  });

  it('rejects expiration formats the service cannot parse', async () => {
    expect(
      await errorsFor(CreateInviteDto, { expiration: '7days' }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateInviteDto, { expiration: 'forever' }),
    ).not.toHaveLength(0);
  });

  it('accepts expiration like 7d / 12h', async () => {
    expect(
      await errorsFor(CreateInviteDto, { expiration: '7d' }),
    ).toHaveLength(0);
    expect(
      await errorsFor(CreateInviteDto, { expiration: '12h' }),
    ).toHaveLength(0);
  });
});
