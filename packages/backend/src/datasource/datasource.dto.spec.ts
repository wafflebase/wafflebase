import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDataSourceDto,
  ExecuteQueryDto,
  UpdateDataSourceDto,
} from './datasource.dto';

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

describe('CreateDataSourceDto', () => {
  const valid = {
    name: 'prod-readonly',
    host: 'db.example.com',
    port: 5432,
    database: 'wafflebase',
    username: 'readonly',
    password: 'sekret',
    sslEnabled: true,
  };

  it('accepts a fully-formed connection payload', async () => {
    expect(await errorsFor(CreateDataSourceDto, valid)).toHaveLength(0);
  });

  it('passes ValidationPipe through with decorators present (regression for forbidUnknownValues path)', async () => {
    // Without decorators, class-validator v0.14+ returns
    // `unknownValue: 'an unknown value was passed'`; that bug used to
    // make every datasource write 400 under the global pipe. This test
    // exists so re-adding an undecorated DTO class breaks CI.
    const errs = await errorsFor(CreateDataSourceDto, valid);
    expect(
      errs.some((e) => e.constraints && 'unknownValue' in e.constraints),
    ).toBe(false);
  });

  it('rejects a port outside the 1..65535 range', async () => {
    expect(
      await errorsFor(CreateDataSourceDto, { ...valid, port: 70000 }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateDataSourceDto, { ...valid, port: 0 }),
    ).not.toHaveLength(0);
  });

  it('rejects a non-boolean sslEnabled', async () => {
    expect(
      await errorsFor(CreateDataSourceDto, { ...valid, sslEnabled: 'yes' }),
    ).not.toHaveLength(0);
  });

  it('rejects unknown properties (no privilege smuggling via extra fields)', async () => {
    expect(
      await errorsFor(CreateDataSourceDto, { ...valid, isAdmin: true }),
    ).not.toHaveLength(0);
  });
});

describe('UpdateDataSourceDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    expect(await errorsFor(UpdateDataSourceDto, {})).toHaveLength(0);
  });

  it('accepts a partial update', async () => {
    expect(
      await errorsFor(UpdateDataSourceDto, { name: 'renamed' }),
    ).toHaveLength(0);
  });

  it('rejects an oversized name', async () => {
    expect(
      await errorsFor(UpdateDataSourceDto, { name: 'x'.repeat(500) }),
    ).not.toHaveLength(0);
  });
});

describe('ExecuteQueryDto', () => {
  it('accepts a SELECT statement', async () => {
    expect(
      await errorsFor(ExecuteQueryDto, { query: 'SELECT * FROM users' }),
    ).toHaveLength(0);
  });

  it('rejects a missing query', async () => {
    expect(await errorsFor(ExecuteQueryDto, {})).not.toHaveLength(0);
  });

  it('rejects a non-string query', async () => {
    expect(
      await errorsFor(ExecuteQueryDto, { query: 42 }),
    ).not.toHaveLength(0);
  });
});
