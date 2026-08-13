import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateBigQuerySourceDto,
  TestBigQueryConnectionDto,
  UpdateBigQuerySourceDto,
} from './bigquery.dto';

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

const validCredentials = JSON.stringify({
  type: 'service_account',
  project_id: 'my-project',
  client_email: 'sa@my-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});

describe('CreateBigQuerySourceDto', () => {
  const valid = {
    name: 'analytics-readonly',
    projectId: 'my-project',
    dataset: 'analytics',
    location: 'US',
    credentials: validCredentials,
    maximumBytesBilled: 10_000_000_000,
  };

  it('accepts a fully-formed connection payload', async () => {
    expect(await errorsFor(CreateBigQuerySourceDto, valid)).toHaveLength(0);
  });

  it('accepts a payload without the optional fields', async () => {
    const { dataset, location, maximumBytesBilled, ...required } = valid;
    void dataset;
    void location;
    void maximumBytesBilled;
    expect(await errorsFor(CreateBigQuerySourceDto, required)).toHaveLength(0);
  });

  it('passes ValidationPipe through with decorators present (regression for forbidUnknownValues path)', async () => {
    const errs = await errorsFor(CreateBigQuerySourceDto, valid);
    expect(
      errs.some((e) => e.constraints && 'unknownValue' in e.constraints),
    ).toBe(false);
  });

  it('rejects credentials that are not valid JSON', async () => {
    expect(
      await errorsFor(CreateBigQuerySourceDto, {
        ...valid,
        credentials: 'not-json',
      }),
    ).not.toHaveLength(0);
  });

  it('rejects a non-positive maximumBytesBilled', async () => {
    expect(
      await errorsFor(CreateBigQuerySourceDto, {
        ...valid,
        maximumBytesBilled: 0,
      }),
    ).not.toHaveLength(0);
  });

  it('accepts an explicit null maximumBytesBilled (means "no ceiling")', async () => {
    expect(
      await errorsFor(CreateBigQuerySourceDto, {
        ...valid,
        maximumBytesBilled: null,
      }),
    ).toHaveLength(0);
  });

  it('rejects unknown properties (no privilege smuggling via extra fields)', async () => {
    expect(
      await errorsFor(CreateBigQuerySourceDto, { ...valid, isAdmin: true }),
    ).not.toHaveLength(0);
  });

  it('rejects a missing projectId', async () => {
    const { projectId, ...withoutProjectId } = valid;
    void projectId;
    expect(
      await errorsFor(CreateBigQuerySourceDto, withoutProjectId),
    ).not.toHaveLength(0);
  });
});

describe('UpdateBigQuerySourceDto', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    expect(await errorsFor(UpdateBigQuerySourceDto, {})).toHaveLength(0);
  });

  it('accepts a partial update', async () => {
    expect(
      await errorsFor(UpdateBigQuerySourceDto, { name: 'renamed' }),
    ).toHaveLength(0);
  });

  it('accepts an explicit null maximumBytesBilled (clears an existing ceiling)', async () => {
    expect(
      await errorsFor(UpdateBigQuerySourceDto, { maximumBytesBilled: null }),
    ).toHaveLength(0);
  });

  it('rejects an oversized name', async () => {
    expect(
      await errorsFor(UpdateBigQuerySourceDto, { name: 'x'.repeat(500) }),
    ).not.toHaveLength(0);
  });
});

describe('TestBigQueryConnectionDto', () => {
  const valid = {
    projectId: 'my-project',
    dataset: 'analytics',
    location: 'US',
    credentials: validCredentials,
  };

  it('accepts a connection payload without a name', async () => {
    expect(await errorsFor(TestBigQueryConnectionDto, valid)).toHaveLength(0);
  });

  it('rejects a name, which the create payload owns', async () => {
    expect(
      await errorsFor(TestBigQueryConnectionDto, {
        ...valid,
        name: 'analytics-readonly',
      }),
    ).not.toHaveLength(0);
  });

  it('rejects a missing credentials', async () => {
    const { credentials, ...withoutCredentials } = valid;
    void credentials;
    expect(
      await errorsFor(TestBigQueryConnectionDto, withoutCredentials),
    ).not.toHaveLength(0);
  });

  it('rejects maximumBytesBilled, which testConfig() never applies to a dry run', async () => {
    expect(
      await errorsFor(TestBigQueryConnectionDto, {
        ...valid,
        maximumBytesBilled: 5_000_000_000,
      }),
    ).not.toHaveLength(0);
  });
});
