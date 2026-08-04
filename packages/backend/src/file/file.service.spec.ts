import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';
import { IMPORT_KEY_PREFIX, MAX_IMAGE_UPLOAD_BYTES } from './file.constants';

function makeService(): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
    'file.allowedMimeTypes': [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'text/csv',
      'text/tab-separated-values',
    ],
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

describe('FileService.upload validation', () => {
  it('rejects a disallowed mime type', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'application/zip'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over the size cap', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(svc.upload(tooBig, 'application/pdf')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('FileService.upload image support', () => {
  it('rejects an image over the 25 MB cap even though Multer allows 50 MB', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    await expect(svc.upload(tooBig, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown mime type not in the allow-list', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** Swap in a fake S3 so an accepted upload does not need a live bucket. */
function withFakeS3(svc: FileService): jest.Mock {
  // An empty response is enough: these assert the key each call resolves to,
  // not what comes back through it.
  const send = jest.fn().mockResolvedValue({});
  (svc as unknown as { s3: { send: jest.Mock } }).s3 = { send };
  return send;
}

describe('FileService.upload data files', () => {
  it('accepts a .csv whose declared type the browser got wrong', async () => {
    const svc = makeService();
    const send = withFakeS3(svc);
    // Browsers disagree on `.csv`: some send `text/csv`, some this, some an
    // empty type. The extension decides when the claim is unrecognized.
    const { id } = await svc.upload(
      Buffer.from('a,b\n1,2'),
      'application/vnd.ms-excel',
      'sales.csv',
      { category: 'data', workspaceId: 'ws1' },
    );
    expect(id).toMatch(/\.csv$/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not let that fallback admit a binary .xls', async () => {
    const svc = makeService();
    withFakeS3(svc);
    // Same unreliable type, but an extension nothing here can read. Only the
    // extension is honoured, never the browser's claim.
    await expect(
      svc.upload(Buffer.from('x'), 'application/vnd.ms-excel', 'sales.xls', {
        category: 'data',
        workspaceId: 'ws1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores and reads a data blob under the expiring imports/ prefix', async () => {
    const svc = makeService();
    const send = withFakeS3(svc);
    const { id } = await svc.upload(Buffer.from('a,b'), 'text/csv', 'a.csv', {
      category: 'data',
      workspaceId: 'ws1',
    });
    // The id itself stays unprefixed — the document DTOs validate its bare
    // shape — so every access has to resolve to the same prefixed key.
    expect(id).not.toContain(IMPORT_KEY_PREFIX);
    expect(send.mock.calls[0][0].input.Key).toBe(
      `${IMPORT_KEY_PREFIX}ws1/${id}`,
    );
    await svc.getObject(id, 'ws1');
    expect(send.mock.calls[1][0].input.Key).toBe(
      `${IMPORT_KEY_PREFIX}ws1/${id}`,
    );
    await svc.delete(id, 'ws1');
    expect(send.mock.calls[2][0].input.Key).toBe(
      `${IMPORT_KEY_PREFIX}ws1/${id}`,
    );
  });

  // The category is what a route states, not what the payload claims. Without
  // it a lying `Content-Type` chose which rules applied: this upload was stored
  // as `<uuid>.png` at the bucket root, outside the expiring `imports/` prefix,
  // after being buffered against the 200 MB data limit and then measured
  // against the 25 MB image cap.
  it('ignores a declared type that contradicts a data upload', async () => {
    const svc = makeService();
    const send = withFakeS3(svc);

    const { id } = await svc.upload(
      Buffer.from('a,b\n1,2'),
      'image/png',
      'sales.csv',
      { category: 'data', workspaceId: 'ws1' },
    );

    expect(id).toMatch(/\.csv$/);
    expect(send.mock.calls[0][0].input.Key).toBe(
      `${IMPORT_KEY_PREFIX}ws1/${id}`,
    );
  });

  // `POST /files` has no workspace check and shares this service, so it must
  // not be a second way into the import prefix.
  it('refuses a data file on the document category', async () => {
    const svc = makeService();
    withFakeS3(svc);

    await expect(
      svc.upload(Buffer.from('a,b\n1,2'), 'text/csv', 'sales.csv'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves a pdf at the bucket root', async () => {
    const svc = makeService();
    const send = withFakeS3(svc);
    const { id } = await svc.upload(Buffer.from('%PDF'), 'application/pdf');
    expect(send.mock.calls[0][0].input.Key).toBe(id);
  });

  it('rejects a null byte as not text/csv', async () => {
    const svc = makeService();
    withFakeS3(svc);
    await expect(
      svc.upload(Buffer.from([0x61, 0x00, 0x62]), 'text/csv', 'sales.csv', {
        category: 'data',
        workspaceId: 'ws1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Excel's own "Unicode Text" export pairs every ASCII byte with a 0x00 one,
  // which the null-byte binary check above would otherwise reject outright —
  // making a well-formed CSV succeed under the client's papaparse path and
  // fail only once it is large enough to route through this one.
  it('accepts a UTF-16 CSV carrying its BOM', async () => {
    const svc = makeService();
    const send = withFakeS3(svc);
    const utf16 = Buffer.from('a,b\r\n1,2\r\n', 'utf16le');
    const bom = Buffer.from([0xff, 0xfe]);
    const { id } = await svc.upload(
      Buffer.concat([bom, utf16]),
      'text/csv',
      'sales.csv',
      { category: 'data', workspaceId: 'ws1' },
    );
    expect(id).toMatch(/\.csv$/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/** The rule an operator put on the bucket, which boot must not disturb. */
const FOREIGN_RULE = {
  ID: 'abort-incomplete-multipart',
  Status: 'Enabled',
  Filter: { Prefix: '' },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
};

/**
 * Fake S3 that answers per command name, so a boot can be replayed: the bucket
 * probe, the lifecycle read, and the lifecycle write all land here.
 */
function withScriptedS3(
  svc: FileService,
  onLifecycleRead: () => unknown,
): jest.Mock {
  const send = jest.fn((command: { constructor: { name: string } }) => {
    if (command.constructor.name === 'GetBucketLifecycleConfigurationCommand') {
      return Promise.resolve(onLifecycleRead());
    }
    return Promise.resolve({});
  });
  (svc as unknown as { s3: { send: jest.Mock } }).s3 = { send };
  return send;
}

function lifecyclePut(send: jest.Mock) {
  return send.mock.calls.find(
    (call) =>
      (call[0] as { constructor: { name: string } }).constructor.name ===
      'PutBucketLifecycleConfigurationCommand',
  );
}

function s3Error(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe('FileService import expiry rule', () => {
  // `PutBucketLifecycleConfiguration` replaces the whole configuration, so
  // writing our rule alone would delete the operator's on every boot.
  it('keeps the rules already on the bucket', async () => {
    const svc = makeService();
    const send = withScriptedS3(svc, () => ({ Rules: [FOREIGN_RULE] }));

    await svc.onModuleInit();

    const rules = lifecyclePut(send)![0].input.LifecycleConfiguration.Rules;
    expect(rules).toEqual([
      FOREIGN_RULE,
      expect.objectContaining({ ID: 'expire-staged-imports' }),
    ]);
  });

  it('replaces its own rule rather than appending a duplicate', async () => {
    const svc = makeService();
    const send = withScriptedS3(svc, () => ({
      Rules: [
        FOREIGN_RULE,
        { ID: 'expire-staged-imports', Status: 'Disabled' },
      ],
    }));

    await svc.onModuleInit();

    const rules = lifecyclePut(send)![0].input.LifecycleConfiguration.Rules;
    expect(rules).toHaveLength(2);
    expect(rules[1]).toEqual(
      expect.objectContaining({
        ID: 'expire-staged-imports',
        Status: 'Enabled',
      }),
    );
  });

  it('writes the rule on a bucket that has no configuration yet', async () => {
    const svc = makeService();
    const send = withScriptedS3(svc, () => {
      throw s3Error('NoSuchLifecycleConfiguration');
    });

    await svc.onModuleInit();

    const rules = lifecyclePut(send)![0].input.LifecycleConfiguration.Rules;
    expect(rules).toEqual([
      expect.objectContaining({ ID: 'expire-staged-imports' }),
    ]);
  });

  // The dangerous case: a read that fails for any *other* reason says nothing
  // about what is on the bucket, so writing would wipe it.
  it('does not write when the existing configuration could not be read', async () => {
    const svc = makeService();
    const send = withScriptedS3(svc, () => {
      throw s3Error('AccessDenied');
    });

    await svc.onModuleInit();

    expect(lifecyclePut(send)).toBeUndefined();
  });
});
