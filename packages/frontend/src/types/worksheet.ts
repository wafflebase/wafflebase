export type {
  ChartType,
  SheetChart,
  WorksheetFilterState,
  Worksheet,
  TimeTravelPoint,
  LakehouseTableRef,
  TabType,
  SheetKind,
  TabMeta,
  SpreadsheetDocument,
} from '@wafflebase/sheets';

export {
  DEFAULT_TAB_ID,
  DEFAULT_TAB_NAME,
  createWorksheet,
  createSpreadsheetDocument,
  initialSpreadsheetDocument,
} from '@wafflebase/sheets';

import { initialSpreadsheetDocument as seedSpreadsheet } from '@wafflebase/sheets';
import type { SpreadsheetDocument as Doc } from '@wafflebase/sheets';

/**
 * The root a share-link visitor should attach with, given their role.
 *
 * The Yorkie SDK writes every `initialRoot` key the document does not already
 * have, on each attach — so a viewer opening a never-edited document creates
 * these keys from their own client, before any read-only machinery exists.
 * Only the viewer role is exempt; every other role still seeds, so the
 * concurrency argument for seeding at bootstrap is untouched.
 *
 * Lives here rather than in `@wafflebase/sheets` because a share-link role
 * is a frontend concept the engine knows nothing about.
 *
 * Unlike notes and board, a viewer reaching an unseeded spreadsheet has
 * nothing to render — a workbook with no tabs is not a blank grid, it is no
 * grid. `SharedDocumentLayout` handles that explicitly; until this stopped
 * seeding, the viewer manufacturing `Sheet1` on their own client is what
 * hid the case.
 */
export function sheetsInitialRootForRole(role: string): Partial<Doc> {
  return role === 'viewer' ? {} : seedSpreadsheet();
}
