import { describe, expect, it } from 'vitest';
import { createLakehouseTabMeta } from '@/app/documents/lakehouse-tab';
import type { LakehouseSource } from '@/types/lakehouse';
import type { TabMeta } from '@/types/worksheet';

const source: LakehouseSource = {
  id: 'source-1',
  name: 'Orders',
  format: 'iceberg',
  storage: 's3-compatible',
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'fixtures',
  basePath: 'orders/metadata/v3.metadata.json',
  credentials: '********',
  workspaceId: 'workspace-1',
};

describe('createLakehouseTabMeta', () => {
  it('stores the source id, table ref, and a unique display name', () => {
    const tabs: Record<string, TabMeta> = {
      existing: {
        id: 'existing',
        name: 'Orders',
        type: 'sheet',
      },
    };

    expect(createLakehouseTabMeta(tabs, 'lakehouse-1', source)).toEqual({
      id: 'lakehouse-1',
      name: 'Orders (2)',
      type: 'lakehouse',
      lakehouseSourceId: 'source-1',
      lakehouseRef: {
        metadataUri: 's3://fixtures/orders/metadata/v3.metadata.json',
      },
    });
  });

  it('keeps an absolute basePath as the metadata URI', () => {
    expect(
      createLakehouseTabMeta({}, 'lakehouse-1', {
        ...source,
        bucket: null,
        basePath: 's3://elsewhere/orders',
      }).lakehouseRef,
    ).toEqual({ metadataUri: 's3://elsewhere/orders' });
  });

  it('uses the storage scheme for azure and gcs buckets', () => {
    expect(
      createLakehouseTabMeta({}, 't', {
        ...source,
        storage: 'azure',
        basePath: 'orders',
      }).lakehouseRef,
    ).toEqual({ metadataUri: 'az://fixtures/orders' });
    expect(
      createLakehouseTabMeta({}, 't', {
        ...source,
        storage: 'gcs',
        basePath: 'orders',
      }).lakehouseRef,
    ).toEqual({ metadataUri: 'gcs://fixtures/orders' });
  });
});
