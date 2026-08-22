import type { LakehouseSource } from '@/types/lakehouse';
import type { TabMeta } from '@/types/worksheet';
import { getUniqueTabName } from './tab-name';

/**
 * Resolves the table URI a tab points at, mirroring the backend's tablePath:
 * a bucket-scoped source prepends its storage scheme, an absolute basePath is
 * used as-is. Persisted to Yorkie so collaborators open the same table.
 */
function lakehouseMetadataUri(source: LakehouseSource): string {
  const basePath = source.basePath.trim();
  if (!source.bucket || basePath.includes('://')) return basePath;
  const scheme =
    source.storage === 'azure' ? 'az' : source.storage === 'gcs' ? 'gcs' : 's3';
  return `${scheme}://${source.bucket}/${basePath.replace(/^\/+/, '')}`;
}

export function createLakehouseTabMeta(
  tabs: Record<string, TabMeta>,
  tabId: string,
  source: LakehouseSource,
): TabMeta {
  return {
    id: tabId,
    name: getUniqueTabName(tabs, source.name, 'Lakehouse'),
    type: 'lakehouse',
    lakehouseSourceId: source.id,
    lakehouseRef: { metadataUri: lakehouseMetadataUri(source) },
  };
}
